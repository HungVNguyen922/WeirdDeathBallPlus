// ROOM - one online match room, and the connection handler that feeds it. Shared by the Node server (js/server/server.js) and the browser's host Worker (js/host/host-worker.js),
// so a room hosted in a player's browser behaves exactly like one on the server.
// It knows nothing about sockets, files or the DOM. It is handed:
//     makeSim()     a function that returns a fresh simulation: { ctx, run(code) }  (Node: sim-node.js's loadSim. Worker: the Worker's own global scope)
//     skinClean     the skin validator from js/skin-data.js
//     accounts      optional: { enabled(), identify(token), recordMatch(...) }. Left out = no accounts (every player is a guest)
//     stats         optional: { bytes, snaps, since } counters for /health
//     snapEvery     ticks between snapshots (1, 2, 3, 4, 5, 6 or 8; default 6)    snapDecimals  decimals kept in snapshots (default 2)
// and talks to a connection through a tiny interface:  conn.send(string)  conn.close(code?)  conn.on('message', str => ...)  conn.on('close', () => ...)  conn.backlog()
//
// Teams: a connection is on Blue (team 0), on Red (team 1) or waiting / spectating (team -1). A team has at most TEAM_MAX players. Seats are player ids: Blue sits in 0 then 2, Red in
// 1 then 3, in the order they joined the team. The first player into a room goes to Blue, the second to Red; everybody after that waits until the HOST (the player who made the room,
// passed on if they leave) moves them. The match runs only while both teams have a player (1v1, 1v2 and 2v2 all work); any change to who is seated restarts it.
//
// Protocol: JSON text messages.
//   client -> server   {t:'join', room, special, lobby2v2, delta, token, skin, name}   join a room; lobby2v2 = true only counts for the player who creates the room (they become the host); delta = true: send me delta snapshots
//                        name only counts when the room has no accounts (a peer-to-peer room): it is shown as the player's name but is never trusted for ranking
//                      {t:'in', n, k}                      my keys changed. n = my input counter, k = bit mask: l1 r2 up4 dn8 z16 x32 sp64 sp2 128.   (z = grapple, x = weight, sp = special)
//                      {t:'sp', s, slot}                   equip special ability s in slot 0 or 1 (ignored while pick screens are on)
//                      {t:'two', v}                        host only: two specials per player on or off (restarts the match)
//                      {t:'fixed', v}                      host only: specials only on pick screens (true) or free swapping (false); restarts the match
//                      {t:'swap', v}                       host only: switch sides every 5 points (true) or never (false); restarts the match
//                      {t:'ranked', v}                     host only: rate this match (needs accounts and everyone signed in); restarts the match
//                      {t:'lobby2v2', v}                   host only: 2v2 lobby on (newcomers fill Blue, Red, Blue 2, Red 2 and the match waits for all four seats) or off
//                      {t:'flex', v}                       host only: Flex on (any 1-4 players on any teams, a team may be empty = sandbox) or off
//                      {t:'assign', c, to}                 host only: move member c to team 0 (Blue), 1 (Red) or -1 (waiting); restarts the match if seats change
//                      {t:'chat', text}                    say something to everybody in the room (trimmed, at most CHAT_MAX characters, rate limited)
//                      {t:'skin', skin}                    guests only: my skin changed
//                      {t:'ping', c}                       latency probe
//                      {t:'refresh', token}                I changed my name or skin on my account: look me up again (the token must belong to the same account) and send everyone a fresh roster
//   server -> client   {t:'welcome', room, slot, cid, tick, hz, snapEvery}   slot: 0..3 = a seat, -1 = waiting / spectating; cid = your member id
//                      {t:'slot', slot}                    your seat changed (the host moved you)
//                      {t:'roster', slots:[bool x4], spectators, running, lobby2v2, flex, ranked, host, you, members:[{c, team, slot, host, name, skin}]}   skin = a list of layers (see js/skin-data.js) or null
//                      {t:'snap', tick, ack, s, ev}         s = saveState(), ack = my last input counter the server has applied, ev = [[name, tick, ...args], ...]
//                        delta clients also get:  kf = keyframe id.  With no pd, s is complete and IS the keyframe (remember s.players under that id).
//                        With pd, s has no `players`; pd[i] describes player i against the keyframe's player i:  0 = unchanged, null = not in the match, {f: player} = replace,
//                        {d: {changed fields}, x: [removed fields]} = patch.
//                      {t:'chat', c, team, text}           somebody in the room said something (c = their member id, team = 0 Blue / 1 Red / -1 waiting); also sent back to the sender.  {t:'chat', sys:true, text} is a note from the server to one player
//                      {t:'pong', c, tick, tps}    {t:'error', msg}
//
// Bandwidth savers (they matter on Render's metered free tier, and cost a hosting browser CPU):
//   - Spectators / waiting players get every second snapshot.
//   - A room where nobody has pressed anything for IDLE_AFTER_MS, and where nothing moves, sends 1 snapshot a second.
//   - Delta encoding (clients that join with delta:true): every KF_EVERY snapshots is a KEYFRAME (the full world). In between, only the players' fields that differ from the keyframe are sent.
'use strict';

function createRoomKit(deps) {
    const { makeSim, skinClean } = deps;
    const accounts = deps.accounts || { enabled: () => false, recordMatch() {}, identify: async () => null };
    const STATS = deps.stats || { bytes: 0, snaps: 0, since: Date.now() };
    const TICK_HZ = 120, DT_MS = 1000 / TICK_HZ;
    const SNAP_EVERY = [1, 2, 3, 4, 5, 6, 8].includes(deps.snapEvery) ? deps.snapEvery : 6; // a snapshot every 6 ticks = 20 Hz. 4 = 30 Hz, 8 = 15 Hz (clients adapt, the value is sent in 'welcome')
    const IDLE_EVERY = 120;         // ticks between snapshots in an idle room (1 per second). Must be a multiple of every allowed SNAP_EVERY (120 is).
    const IDLE_AFTER_MS = 20000;    // a room is idle when nobody changed their keys for this long, no key is held, no event is waiting and the ball is (nearly) still
    const IDLE_BALL_V = 60;         // u/s: a ball faster than this keeps the room awake
    const KF_EVERY = 30;            // delta encoding: every this-many snapshots is a keyframe (full world). Keep it EVEN (spectators skip odd snapshots and must never miss a keyframe)
    const SNAP_BACKLOG = 48 * 1024; // a client with more than this still unsent skips snapshots (each one is the full world, so a skipped one costs nothing; a queue of stale ones makes it lag for seconds)
    const MAX_CATCHUP = 8;          // never run more than this many ticks in one go (after a stall, drop the debt instead of spiralling)
    const MAX_SPECTATORS = 8, MSG_PER_SEC = 400;
    const CHAT_MAX = 120, CHAT_BURST = 5, CHAT_WINDOW_MS = 5000; // chat: longest message, and at most CHAT_BURST messages per CHAT_WINDOW_MS per player
    const TEAM_MAX = 2;             // players per team (seats 0 / 2 are Blue, 1 / 3 are Red)
    const NAME_RE = /^[A-Za-z0-9_]{3,16}$/; // same rule as account names
    const SPECIAL_IDS = ['dash', 'plinko', 'marionette', 'decoy', 'arrow', 'bat', 'barbwire', 'warp', 'awakened', 'explode', 'hopper', 'boomerang', 'portal', 'swap', 'smoke', 'pong', 'mines', 'split', 'accelerator', 'fighter']; // the same ids as in render/special-menu.js and game/rules.js
    const SNAP_DEC = Number.isInteger(deps.snapDecimals) && deps.snapDecimals >= 0 && deps.snapDecimals <= 4 ? deps.snapDecimals : 2;
    const SNAP_Q = Math.pow(10, SNAP_DEC);

    // Code that runs INSIDE a room's sandbox: it captures the game's events (the renderer's hooks) into a list, and applies input bits to a player's keys.
    const ROOM_PRELUDE = `
var __ev = [], __tick = 0, __done = null; // __done: set when a point wins the match ({ score: [blue, red] }); the room reads it and clears it
const __ref = b => b === ball ? 'b' : b instanceof Player ? 'p' + b.id : 'd' + decoys.indexOf(b);
events.onPoint = (team, why) => { __ev.push(['pt', __tick, team, why]); if (score[team] >= WIN) __done = { score: [score[0], score[1]] }; };
events.onNewRound = () => __ev.push(['nr', __tick]);
events.onImpact = (p, x, y, ux, uy, v) => __ev.push(['im', __tick, p.id, x, y, ux, uy, v]);
events.onBatHit = (p, b, x, y, ux, uy, k) => __ev.push(['bt', __tick, p.id, __ref(b), x, y, ux, uy, k]);
function __ballSpeed() { return Math.hypot(ball.vx, ball.vy); } // read by Room.isActive(): no script is compiled per call
function __setKeys(i, bits) {
    const k = allPlayers[i].keys;
    k.l = !!(bits & 1); k.r = !!(bits & 2); k.up = !!(bits & 4); k.dn = !!(bits & 8); k.z = !!(bits & 16); k.x = !!(bits & 32); k.sp = !!(bits & 64); k.sp2 = !!(bits & 128);
}
`;

    // ---- delta encoding helpers ----
    function fieldStrings(p) { // a player's own fields as JSON text, one string per field (undefined fields are dropped, exactly as JSON would drop them)
        const o = {};
        for (const k in p) {
            const v = JSON.stringify(p[k]);
            if (v !== undefined)
                o[k] = v;
        }
        return o;
    }
    function playerDelta(p, base) { // JSON text: how player p differs from the keyframe's version of it (base = fieldStrings of that, or null)
        if (!p)
            return base ? 'null' : '0';
        if (!base)
            return '{"f":' + JSON.stringify(p) + '}';
        const cur = fieldStrings(p), parts = [], gone = [];
        for (const k in cur)
            if (base[k] !== cur[k])
                parts.push(JSON.stringify(k) + ':' + cur[k]);
        for (const k in base)
            if (!(k in cur))
                gone.push(k);
        if (!parts.length && !gone.length)
            return '0';
        return '{"d":{' + parts.join(',') + '}' + (gone.length ? ',"x":' + JSON.stringify(gone) : '') + '}';
    }
    function roundInPlace(v) { // rounds every number inside v (arrays and plain objects, nested). Only call it on a fresh copy, like saveState()'s result
        for (const k in v) {
            const x = v[k];
            if (typeof x === 'number')
                v[k] = Math.round(x * SNAP_Q) / SNAP_Q;
            else if (x && typeof x === 'object')
                roundInPlace(x);
        }
        return v;
    }

    class Room {
        constructor(name) {
            this.name = name;
            this.sim = makeSim();
            this.sim.run(ROOM_PRELUDE);
            this.conns = new Set(); // everyone in the room. Room sets on each: cid (member id), team (0 / 1 / -1), order, slot (seat 0..3 or -1), special, moved
            this.seats = [null, null, null, null]; // connections by seat (= player id)
            this.bits = [0, 0, 0, 0]; // latest key mask per seat
            this.seq = [0, 0, 0, 0]; // latest input counter per seat (echoed back as `ack`)
            this.nextCid = 1;
            this.nextOrder = 1;
            this.host = null; // the connection allowed to change room settings and move players
            this.fixed = false; // specials only on pick screens
            this.twoSpecials = false; // the host's "two specials per player" option
            this.swapSides = true; // the host's "switch sides every 5 points" option
            this.ranked = false; // the host's "Ranked" option: only a ranked match changes ratings. Needs everyone seated signed in (see rankedOk)
            this.lobby2v2 = false; // 2v2 lobby: newcomers fill all four seats automatically and the match waits until every seat is taken
            this.flex = false; // Flex: the host puts any 1 to 4 players on any teams; a team may be empty (then nothing is scored)
            this.tick = 0;
            this.running = false;
            this.acc = 0;
            this.last = performance.now();
            this.lastInput = Date.now(); // when anybody last changed their keys (idle rooms send fewer snapshots)
            this.snapN = 0;     // snapshots made since the match started (decides keyframes and which ones spectators skip)
            this.kfSeq = 0;     // keyframe ids handed out (never reused, so a stale client can never match a new keyframe)
            this.kfId = 0;      // id of the current keyframe
            this.kfBase = null; // the current keyframe's players, as fieldStrings per player (null = no keyframe yet)
            this.tps = 0; this.tpsN = 0; this.tpsT = performance.now(); // achieved sim ticks per second (should sit at 120)
        }
        get everyone() { return [...this.conns]; }
        get empty() { return this.conns.size === 0; }
        teamCount(t) { let n = 0; for (const c of this.conns) if (c.team === t) n++; return n; }
        openTeam() { // 2v2 lobby: the team a newcomer should take (the emptier one that still has a seat, Blue on a tie), or -1 when all seats are taken
            const open = [0, 1].filter(t => this.teamCount(t) < TEAM_MAX);
            return open.length ? open.reduce((a, b) => (this.teamCount(b) < this.teamCount(a) ? b : a)) : -1;
        }
        fillSeats() { // 2v2 lobby: whoever has been waiting longest takes any free seat
            if (!this.lobby2v2)
                return;
            for (const c of [...this.conns].filter(x => x.team < 0).sort((a, b) => a.order - b.order)) {
                const t = this.openTeam();
                if (t < 0)
                    break;
                c.team = t;
                c.order = this.nextOrder++;
            }
        }
        // Work out the seats from each connection's team: a team's members take its seats in the order they joined the team. Returns true if any seat changed.
        reseat() {
            const old = this.seats, seats = [null, null, null, null];
            if (this.flex) { // any seat on any team: a player keeps the seat they have, a new one takes the first free
                const want = [...this.conns].filter(c => c.team >= 0).sort((a, b) => a.order - b.order).slice(0, 4);
                for (const c of want)
                    if (old[c.slot] === c)
                        seats[c.slot] = c;
                for (const c of want)
                    if (!seats.includes(c))
                        seats[seats.indexOf(null)] = c;
            } else
                for (const t of [0, 1])
                    [...this.conns].filter(c => c.team === t).sort((a, b) => a.order - b.order).slice(0, TEAM_MAX).forEach((c, i) => { seats[2 * i + t] = c; });
            let changed = false;
            for (let i = 0; i < 4; i++)
                if (old[i] !== seats[i]) {
                    changed = true;
                    this.bits[i] = 0;
                    this.seq[i] = 0;
                }
            this.seats = seats;
            for (const c of this.conns) {
                const was = c.slot;
                c.slot = seats.indexOf(c); // -1 = waiting
                c.moved = was !== undefined && was !== c.slot;
            }
            return changed;
        }
        // After anything that may have changed who is seated: tell the people who moved, (re)start or pause the match, send the roster.
        settle(changed) {
            for (const c of this.conns)
                if (c.moved) {
                    c.moved = false;
                    c.send(JSON.stringify({ t: 'slot', slot: c.slot }));
                }
            if (this.ranked && !this.rankedOk()) {
                this.ranked = false;
                this.say('Ranked is off: everyone seated has to be signed in.');
            }
            const need = this.lobby2v2 ? TEAM_MAX : 1;
            const ready = this.flex ? this.seats.some(Boolean) : this.teamCount(0) >= need && this.teamCount(1) >= need; // Flex needs only one player: an empty team is allowed
            if (ready && (changed || !this.running))
                this.start();
            else if (!ready)
                this.running = false;
            this.roster();
            if (!this.running && this.tick > 0)
                this.snapshot(); // someone watching a paused room still gets to see the board
        }
        join(conn, special, special2) {
            let team = this.flex ? -1 : this.lobby2v2 ? this.openTeam() : [0, 1].find(t => this.teamCount(t) === 0);
            if (team === undefined)
                team = -1;
            if (team < 0 && [...this.conns].filter(c => c.team < 0).length >= MAX_SPECTATORS)
                return -2;
            conn.cid = this.nextCid++;
            conn.team = team;
            conn.order = this.nextOrder++;
            conn.special = SPECIAL_IDS.includes(special) ? special : 'dash';
            conn.special2 = SPECIAL_IDS.includes(special2) && special2 !== conn.special ? special2 : SPECIAL_IDS.find(s => s !== conn.special);
            this.conns.add(conn);
            if (!this.host)
                this.host = conn;
            this.lastInput = Date.now(); // somebody just arrived: wake the room
            const changed = this.reseat();
            conn.send(JSON.stringify({ t: 'welcome', room: this.name, slot: conn.slot, cid: conn.cid, tick: this.tick, hz: TICK_HZ, snapEvery: SNAP_EVERY }));
            this.settle(changed);
            return conn.slot;
        }
        leave(conn) {
            if (!this.conns.delete(conn))
                return;
            if (conn === this.host) // seated players first, then whoever has been waiting longest
                this.host = [...this.conns].sort((a, b) => (b.team >= 0) - (a.team >= 0) || a.order - b.order)[0] || null;
            this.fillSeats(); // 2v2 lobby: a free seat goes to whoever has waited longest
            this.settle(this.reseat());
        }
        assign(cid, to) { // the host moves a member: 0 = Blue, 1 = Red, -1 = waiting
            const c = [...this.conns].find(x => x.cid === cid);
            if (!c || ![0, 1, -1].includes(to) || c.team === to)
                return;
            if (to >= 0 && (this.flex ? c.team < 0 && [...this.conns].filter(x => x.team >= 0).length >= 4 : this.teamCount(to) >= TEAM_MAX))
                return; // full (Flex: four seats in total, any split)
            c.team = to;
            c.order = this.nextOrder++; // joins the end of that team's seat order
            this.settle(this.reseat());
        }
        start() {
            const sim = this.sim, ids = [], teams = [];
            this.seats.forEach((c, i) => {
                if (!c)
                    return;
                this.fixFighter(c);
                ids.push(i);
                teams.push(c.team);
                sim.run('allPlayers[' + i + '].special2 = ' + JSON.stringify(c.special2)); // was never applied, so a second special chosen on joining was ignored
                sim.run(`allPlayers[${i}].special = '${c.special}'`); // before the restart, so a pick screen opens with the right choice highlighted
            });
            sim.run(`pickFixed = ${this.fixed && !this.flex}`); // the pick screens only have room for two per team
            sim.run(`twoSpecials = ${this.twoSpecials}`);
            sim.run(`swapOn = ${this.swapSides}`);
            sim.run(`setRoster([${ids.join(',')}], [${teams.join(',')}])`); // exactly these players; also restarts the match (and opens the first pick screen when they are on)
            sim.ctx.__ev.length = 0;
            this.tick = 0;
            this.acc = 0;
            this.last = performance.now();
            this.lastInput = Date.now();
            this.snapN = 0;      // the first snapshot of a match is always a keyframe
            this.kfBase = null;
            this.running = true;
            this.snapshot(); // everyone sees the fresh board straight away
        }
        fixFighter(conn) { // Fighter takes both slots and only exists with two specials on; anything else turns back into plain specials
            if (conn.special !== 'fighter' && conn.special2 !== 'fighter')
                return;
            if (this.twoSpecials && conn.special === 'fighter' && conn.special2 === 'fighter')
                return;
            conn.special = 'dash';
            conn.special2 = 'plinko';
        }
        setSpecial(conn, id, slot = 0) {
            if (!SPECIAL_IDS.includes(id) || this.fixed)
                return;
            if (id === 'fighter') {
                if (!this.twoSpecials)
                    return;                                   // not available in one-special rooms
                conn.special = conn.special2 = 'fighter';     // takes both slots
            } else {
                const a = slot === 1 ? 'special2' : 'special', b = slot === 1 ? 'special' : 'special2';
                if (conn[b] === 'fighter')
                    conn[b] = SPECIAL_IDS.find(s => s !== 'fighter' && s !== id); // leaving Fighter frees the other slot
                else if (this.twoSpecials && conn[b] === id)
                    conn[b] = conn[a];                        // picking the one in the other slot swaps them
                conn[a] = id;
                if (conn.special2 === conn.special)
                    conn.special2 = SPECIAL_IDS.find(s => s !== conn.special && s !== 'fighter');
            }
            if (conn.slot >= 0)
                this.sim.run(`allPlayers[${conn.slot}].special = '${conn.special}'; allPlayers[${conn.slot}].special2 = '${conn.special2}'`);
        }
        setTwoSpecials(v) { // restarts the match
            this.twoSpecials = !!v;
            this.sim.run(`twoSpecials = ${this.twoSpecials}`);
            for (const c of this.conns)
                this.fixFighter(c);                           // turning two specials off turns any Fighter into Dash + Plinko
            if (this.running)
                this.start();
        }
        setFixed(v) { // the "pick screens" option: restarts the match so everyone starts from the first pick screen
            this.fixed = !!v;
            this.sim.run(`pickFixed = ${this.fixed}`);
            if (this.running)
                this.start();
        }
        setSwap(v) { // the "switch sides" option: restarts the match so everyone starts from the normal sides
            this.swapSides = !!v;
            this.sim.run(`swapOn = ${this.swapSides}`);
            if (this.running)
                this.start();
        }
        say(text, only) { // a note in everybody's chat (or just `only`'s)
            const msg = JSON.stringify({ t: 'chat', sys: true, text });
            for (const c of only ? [only] : this.conns)
                c.send(msg);
        }
        rankedOk() { // can the current match be rated? accounts on, both teams seated, everybody seated signed in with a name, nobody sitting twice
            if (this.flex) return false;
            if (!accounts.enabled())
                return false;
            const seated = this.seats.filter(Boolean), ids = seated.map(c => c.uid);
            return this.teamCount(0) >= 1 && this.teamCount(1) >= 1 && seated.every(c => c.uid && c.name) && new Set(ids).size === ids.length;
        }
        setRanked(conn, v) { // the host's Ranked switch. Either way it restarts the match, so a ranked match always starts at 0-0.
            if (v && this.flex) return this.say('Ranked is not available in Flex.', conn);
            v = !!v;
            if (v === this.ranked)
                return;
            if (v && !this.rankedOk())
                return this.say('Ranked needs everyone seated to be signed in with a name.', conn);
            this.ranked = v;
            this.say(v ? 'The host turned Ranked on: this match counts toward ratings. The match restarts.' : 'The host turned Ranked off: casual match. The match restarts.');
            if (this.running)
                this.start();
            this.roster(); // carries the new setting
        }
        setLobby2v2(v) { // the host's 2v2 switch. On: everyone already waiting takes the open seats and the match waits for all four. Off: back to host-placed teams; nobody is moved off a team.
            if (v && this.flex) { this.flex = false; this.trimTeams(); }
            this.lobby2v2 = !!v;
            this.fillSeats();
            this.settle(this.reseat());
        }
        trimTeams() { // back to normal teams: a team holds two players at most, the extras wait
            for (const t of [0, 1])
                [...this.conns].filter(c => c.team === t).sort((a, b) => a.order - b.order).slice(TEAM_MAX).forEach(c => { c.team = -1; });
        }
        setFlex(v) { // the host's Flex switch. Restarts the match.
            this.flex = !!v;
            if (this.flex) {
                this.lobby2v2 = false;
                if (this.ranked) {
                    this.ranked = false;
                    this.say('Ranked is off in Flex.');
                }
            } else
                this.trimTeams();
            this.reseat();
            this.settle(true);
        }
        chat(conn, raw) { // relay one chat message to everybody in the room (the sender included, so everyone sees the same order)
            if (typeof raw !== 'string')
                return;
            const text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
            if (!text)
                return;
            const now = Date.now();
            conn.chatAt = (conn.chatAt || []).filter(t => now - t < CHAT_WINDOW_MS);
            if (conn.chatAt.length >= CHAT_BURST)
                return conn.send(JSON.stringify({ t: 'chat', sys: true, text: 'Slow down: too many messages.' }));
            conn.chatAt.push(now);
            const msg = JSON.stringify({ t: 'chat', c: conn.cid, team: conn.team, text });
            for (const c of this.conns)
                c.send(msg);
        }
        roster() {
            const members = [...this.conns]
                .sort((a, b) => (a.slot < 0) - (b.slot < 0) || a.slot - b.slot || a.order - b.order) // seated by seat, then the waiting list in order
                .map(c => ({ c: c.cid, team: c.team, slot: c.slot, host: c === this.host, name: c.name || null, skin: c.skin && c.skin.length ? c.skin : null }));
            const base = { t: 'roster', slots: this.seats.map(Boolean), spectators: members.filter(m => m.slot < 0).length, running: this.running, lobby2v2: this.lobby2v2, flex: this.flex, ranked: this.ranked, members };
            for (const c of this.conns)
                c.send(JSON.stringify({ ...base, host: c === this.host, you: c.cid }));
        }
        isActive() { // should this room send snapshots at the full rate right now?
            // (the ball's speed comes from __ballSpeed(), defined in ROOM_PRELUDE)
            return this.bits.some(Boolean)                                   // somebody is holding a key
                || Date.now() - this.lastInput < IDLE_AFTER_MS               // or pressed one recently
                || this.sim.ctx.__ev.length > 0                              // or an effect (goal, impact, bat hit) is waiting to be sent
                || this.sim.ctx.__ballSpeed() > IDLE_BALL_V;                 // or the ball is still moving
        }
        advance(now) {
            if (!this.running) {
                this.last = now;
                return;
            }
            this.acc += now - this.last;
            this.last = now;
            const ctx = this.sim.ctx;
            let n = 0;
            while (this.acc >= DT_MS && n < MAX_CATCHUP) {
                for (let i = 0; i < 4; i++)
                    ctx.__setKeys(i, this.bits[i]);
                ctx.__tick = this.tick + 1; // events are tagged with the tick count at which their effect is first visible
                ctx.update();
                if (ctx.__done) { // a point just won the match: rate it
                    const done = ctx.__done;
                    ctx.__done = null;
                    this.matchOver(done);
                }
                this.tick++;
                n++;
                this.tpsN++;
                this.acc -= DT_MS;
                if (this.tick % SNAP_EVERY === 0 && (this.tick % IDLE_EVERY === 0 || this.isActive())) // idle rooms only snapshot once a second
                    this.snapshot();
            }
            if (this.acc > DT_MS * MAX_CATCHUP)
                this.acc = 0;
            if (now - this.tpsT >= 1000) {
                this.tps = Math.round(this.tpsN * 1000 / (now - this.tpsT));
                this.tpsN = 0;
                this.tpsT = now;
            }
        }
        snapshot() {
            const ctx = this.sim.ctx, state = ctx.saveState(), n = this.snapN++;
            roundInPlace(state); // saveState() is a fresh deep copy, so rounding it in place is safe
            if (state.pick && !state.pick.on)
                state.pick = { on: false, at: state.pick.at, go: 0, t: 0 }; // a closed pick screen: the arrays inside it mean nothing
            const evNew = ctx.__ev.slice();
            roundInPlace(evNew); // (the event arrays are cleared right below, so editing them in place is fine)
            ctx.__ev.length = 0;
            const evJson = JSON.stringify(evNew);
            const isKey = !this.kfBase || n % KF_EVERY === 0;     // a keyframe: the full world, and the base for the deltas that follow
            let fullStr = null, delta = null;
            const full = () => fullStr || (fullStr = JSON.stringify(state));
            const getDelta = () => delta || (delta = { // the world without its players, and the players as differences from the keyframe
                rest: JSON.stringify({ ...state, players: undefined }),
                pd: '[' + state.players.map((p, i) => playerDelta(p, this.kfBase[i])).join(',') + ']'
            });
            if (isKey) {
                this.kfId = ++this.kfSeq;
                this.kfBase = state.players.map(p => (p ? fieldStrings(p) : null));
            }
            const out = (c, ack, skip = false) => {
                if (skip || c.backlog() > SNAP_BACKLOG) { // not keeping up (or a spectator's skipped turn): keep its effects for the next one it gets
                    c.heldEv = (c.heldEv || []).concat(evNew).slice(-80);
                    return;
                }
                let ev = evJson;
                if (c.heldEv) {
                    ev = JSON.stringify(c.heldEv.concat(evNew));
                    c.heldEv = null;
                }
                let s, extra = '';
                if (c.delta && isKey) { // keyframe: full state, tagged so the client keeps its players
                    s = full();
                    extra = '"kf":' + this.kfId + ',';
                    c.kf = this.kfId;
                } else if (c.delta && c.kf === this.kfId) { // it holds the current keyframe: send only what differs
                    const d = getDelta();
                    s = d.rest;
                    extra = '"kf":' + this.kfId + ',"pd":' + d.pd + ',';
                } else
                    s = full(); // plain client, or one that missed the keyframe (it gets full snapshots until the next keyframe reaches it)
                const msg = '{"t":"snap","tick":' + this.tick + ',"ack":' + ack + ',' + extra + '"s":' + s + ',"ev":' + ev + '}';
                STATS.bytes += msg.length;
                STATS.snaps++;
                c.send(msg);
            };
            const half = n % 2 === 1 && !isKey; // spectators and waiting players get every second snapshot (never a keyframe: KF_EVERY is even)
            this.seats.forEach((c, i) => c && out(c, this.seq[i]));
            for (const c of this.conns)
                if (c.slot < 0)
                    out(c, 0, half);
        }
        matchOver(done) { // Blue sits in seats 0 and 2, Red in 1 and 3. Rated only if everyone seated is signed in (accounts.recordMatch checks that).
            if (!this.ranked || !accounts.enabled())
                return;
            const teams = [0, 1].map(t => this.seats.filter(c => c && c.team === t).map(c => c.uid || null));
            accounts.recordMatch({ teams, score: done.score });
        }
    }

    // The handler for one connection: parses its messages and drives the rooms. `rooms` is a Map name -> Room (the caller owns it, e.g. for /health).
    // fixedRoom: every join goes to this one room whatever name it asks for (a hosted room has exactly one).
    function makeConnectionHandler({ rooms, maxRooms = 50, fixedRoom = null }) {
        return function onConnection(conn) {
            let room = null, joining = false, gone = false, count = 0, since = Date.now();
            conn.on('message', async str => {
                const now = Date.now();
                if (now - since > 1000) { since = now; count = 0; }
                if (++count > MSG_PER_SEC)
                    return conn.close(1008); // flooding
                let m;
                try { m = JSON.parse(str); } catch (e) { return; }
                if (!m || typeof m.t !== 'string')
                    return;
                if (m.t === 'join' && !room && !joining) {
                    joining = true;
                    const id = m.token && accounts.enabled() ? await accounts.identify(m.token).catch(() => null) : null; // a bad or expired token just means guest
                    joining = false;
                    if (gone)
                        return;
                    conn.uid = id ? id.uid : null;
                    // A verified account name wins. Where there are no accounts at all (a peer-to-peer room, a LAN server) a player may just say what to call them: it is only a label.
                    conn.name = id && id.name ? id.name : (!accounts.enabled() && typeof m.name === 'string' && NAME_RE.test(m.name) ? m.name : null);
                    conn.skin = id ? id.skin : skinClean(m.skin); // an account's stored skin wins; a guest supplies their own (cleaned)
                    conn.delta = m.delta === true; // this client can apply delta snapshots (see the protocol notes at the top)
                    conn.kf = null;
                    const name = fixedRoom || (typeof m.room === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(m.room) ? m.room : 'lobby');
                    let r = rooms.get(name);
                    if (!r) {
                        if (rooms.size >= maxRooms)
                            return conn.send(JSON.stringify({ t: 'error', msg: 'server is full' }));
                        rooms.set(name, r = new Room(name));
                        r.lobby2v2 = m.lobby2v2 === true; // the creator can open the room as a 2v2 lobby from the start
                    }
                    if (r.join(conn, m.special, m.special2) === -2) {
                        if (r.empty)
                            rooms.delete(name);
                        return conn.send(JSON.stringify({ t: 'error', msg: 'room is full' }));
                    }
                    room = r;
                } else if (m.t === 'in' && room && conn.slot >= 0) { // (conn.slot follows the host moving people around)
                    if (Number.isInteger(m.k) && m.k >= 0 && m.k <= 255) {
                        if (m.k !== room.bits[conn.slot])
                            room.lastInput = Date.now(); // a real change of keys wakes an idle room
                        room.bits[conn.slot] = m.k;
                        if (Number.isInteger(m.n))
                            room.seq[conn.slot] = m.n;
                    }
                } else if (m.t === 'sp' && room)
                    room.setSpecial(conn, m.s, m.slot === 1 ? 1 : 0);
                else if (m.t === 'two' && room && room.host === conn)
                    room.setTwoSpecials(m.v);
                else if (m.t === 'fixed' && room && room.host === conn)
                    room.setFixed(m.v);
                else if (m.t === 'swap' && room && room.host === conn)
                    room.setSwap(m.v);
                else if (m.t === 'ranked' && room && room.host === conn)
                    room.setRanked(conn, m.v);
                else if (m.t === 'lobby2v2' && room && room.host === conn)
                    room.setLobby2v2(m.v);
                else if (m.t === 'flex' && room && room.host === conn)
                    room.setFlex(m.v);
                else if (m.t === 'assign' && room && room.host === conn)
                    room.assign(Number(m.c), Number(m.to));
                else if (m.t === 'chat' && room)
                    room.chat(conn, m.text);
                else if (m.t === 'skin' && room && !conn.uid) { // guests only; signed-in players use 'refresh', which reads their account
                    const now2 = Date.now();
                    if (now2 - (conn.skinAt || 0) < 500)
                        return; // each one re-sends the roster to the whole room, so keep it from being spammed
                    conn.skinAt = now2;
                    conn.skin = skinClean(m.skin);
                    room.roster();
                } else if (m.t === 'refresh' && room && conn.uid && typeof m.token === 'string') {
                    accounts.identify(m.token).then(id => { // only the same account may refresh its own seat; a different or bad token changes nothing
                        if (!id || id.uid !== conn.uid || gone)
                            return;
                        conn.name = id.name || conn.name;
                        conn.skin = id.skin;
                        room.roster();
                    }).catch(() => {});
                } else if (m.t === 'ping')
                    conn.send(JSON.stringify({ t: 'pong', c: Number(m.c) || 0, tick: room ? room.tick : 0, tps: room ? room.tps : 0 }));
            });
            conn.on('close', () => {
                gone = true;
                if (!room)
                    return;
                room.leave(conn);
                if (room.empty)
                    rooms.delete(room.name);
            });
        };
    }

    return { Room, makeConnectionHandler, TICK_HZ, STATS };
}

if (typeof module !== 'undefined' && module.exports)
    module.exports = { createRoomKit };
else
    self.createRoomKit = createRoomKit;
