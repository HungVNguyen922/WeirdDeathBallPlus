// NET - online play, client side. Load after input.js and before main.js.
// Online, the server owns the simulation. This file (1) sends my key presses, (2) buffers the snapshots the server sends (about 30 a second), and (3) every frame replays them
// through the game's own renderer: it interpolates between two snapshots a short moment in the past, loads the result into the game's globals with loadState(), and fires
// the one-off effects (goals, impacts, bat hits, trails) at the right moment. update() is never called online, so nothing here can disagree with the server about the game.
// The price of that is a little delay: you see the world NET_DELAY_MS late, and your own moves show up after a round trip. Client-side prediction is the later fix for that.
//
// Start it with  ?room=NAME  in the page URL, or the "Play online" button. Optional  &server=host:port  points at a different game server.
const NET_BITS = { l: 1, r: 2, up: 4, dn: 8, z: 16, x: 32, sp: 64, sp2: 128 }; // must match server/server.js
const NET_DELAY_MS = 100; // how far in the past we draw to start with; it then adapts to the connection (below)
const NET_DELAY_MIN = 70, NET_DELAY_MAX = 260; // limits for the adaptive delay (ms): about two snapshots at the least, a quarter second at the most
const NET_CLOCK_WINDOW = 150; // snapshots (about 5 s) the clock estimate looks back over
const NET_PING_MS = 500; // how often we measure the round trip
const NET_TELEPORT = 150; // a body that moved further than this between two snapshots was reset / respawned: do not slide it across the arena

// ---- interpolation ----
const netWrap = a => Math.atan2(Math.sin(a), Math.cos(a));
function netMix(a, b, u, key) { // blend two pieces of plain data: numbers slide, everything else (flags, strings, null) switches at the halfway point
    if (typeof a === 'number' && typeof b === 'number')
        return key && /ang$/i.test(key) ? a + netWrap(b - a) * u : a + (b - a) * u; // angles take the short way round
    if (Array.isArray(b))
        return Array.isArray(a) && a.length === b.length ? b.map((x, i) => netMix(a[i], x, u)) : u < 0.5 ? a : b;
    if (b && typeof b === 'object' && a && typeof a === 'object') {
        const o = {};
        for (const k in b)
            o[k] = k in a ? netMix(a[k], b[k], u, k) : b[k];
        return o;
    }
    return u < 0.5 ? a : b;
}
function netMixBody(a, b, u) { // a player, the ball, a decoy, a peg or an arrow
    if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) > NET_TELEPORT)
        return u < 0.5 ? a : b;
    return netMix(a, b, u);
}
const netMixList = (la, lb, u) => (la.length === lb.length ? lb.map((b, i) => netMixBody(la[i], b, u)) : u < 0.5 ? la : lb); // (still used for players, which are indexed by seat)

// Match items by identity instead of list position. The list follows whichever snapshot is nearer in time (so the player's `tball` index
// into the decoy list stays valid); an item the other snapshot lacks just appears / disappears at the halfway point.
function netMixKeyed(la, lb, u, key) {
    if (la.some(x => key(x) === undefined) || lb.some(x => key(x) === undefined))
        return netMixList(la, lb, u); // old server without ids
    const near = u < 0.5, base = near ? la : lb, other = new Map((near ? lb : la).map(x => [key(x), x]));
    return base.map(x => {
        const o = other.get(key(x));
        return !o ? x : near ? netMixBody(x, o, u) : netMixBody(o, x, u);
    });
}
const NET_KEYS = {
    decoys: d => d.owner,                         // one decoy per player
    pegs: q => q.owner + ':' + q.x + ':' + q.y,   // pegs never move
    projectiles: p => p.id,
};
function netMixState(a, b, u) { // two saveState() snapshots -> one in between. Score, timers and flags come from whichever is nearer in time.
    if (a === b || u <= 0)
        return a;
    const s = u < 0.5 ? a : b;
    return { ...s, players: netMixList(a.players, b.players, u), ball: netMixBody(a.ball, b.ball, u), decoys: netMixList(a.decoys, b.decoys, u), pegs: netMixList(a.pegs, b.pegs, u), projectiles: netMixKeyed(a.projectiles || [], b.projectiles || [], u, NET_KEYS.projectiles), saw: netMix(a.saw, b.saw, u), };
}

function netClearAI() { // online every seat is a person: the offline AI flags must not carry over (they kept drawing "AI" tags and let the computer steer predicted players)
    if (typeof ai === 'undefined')
        return;
    for (let i = 0; i < ai.length; i++)
        if (typeof setAI === 'function')
            setAI(i, false); // (also resets the AI toggle buttons; has to run before net.on is set, setAI ignores calls while online)
        else
            ai[i].on = false;
}

function netApplyDelta(base, d) { // a player from the keyframe + the fields that changed (the result is read-only: never edit it, it shares values with the keyframe)
    const o = { ...base, ...(d.d || {}) };
    if (d.x)
        for (const k of d.x)
            delete o[k];
    return o;
}

const net = {
    on: false, slot: -1, ws: null, room: '', running: false, rtt: 0, status: '', lobby2v2: false, ranked: false,
    members: [], you: 0,
    keys: noKeys(), seq: 0, ack: 0, pendingSpecial: null, pendingSpecial2: null,
    dtMs: 1000 / 120, snapEvery: 4,
    clk: [], buf: [], evq: [], off: 0, lastSnapAt: 0, cur: null, shown: null, shape: null, skipEvent: null, jit: 0, delayMs: NET_DELAY_MS,
    setStatus(t) {
        this.status = t;
        const el = document.getElementById('netstatus');
        if (el)
            el.textContent = t;
    },
    describe() {
        if (!this.ws || this.ws.readyState > 1)
            return 'Disconnected. Reload the page to reconnect.';
        const me = this.members.find(m => m.c === this.you), team = me ? me.team : -1;
        const mates = this.members.filter(m => m.team === team && m.slot >= 0).sort((a, b) => a.slot - b.slot), nth = mates.findIndex(m => m.c === this.you);
        const who = this.slot >= 0 ? 'you are ' + (team === 0 ? 'Blue' : 'Red') + (nth > 0 ? ' ' + (nth + 1) : '') : 'spectating';
        const seated = this.members.filter(m => m.slot >= 0).length;
        const state = !this.running ? (this.lobby2v2 ? ` - 2v2 lobby: waiting for players (${seated}/4)...` : this.slot >= 0 ? ' - waiting for an opponent...' : ' - waiting for players...') : '';
        return `Online${this.ranked ? ' (ranked)' : ''}, room "${this.room}": ${who}${state}${this.rtt ? ` (ping ${Math.round(this.rtt)} ms${this.tps ? `, server ${this.tps} ticks/s` : ''}${this.extra ? ', ' + this.extra() : ''}, buffer ${Math.round(this.delayMs)} ms)` : ''}`;
    },
    join(room, server) {
        if (this.ws)
            return;
        netClearAI();
        this.on = true;
        this.room = room;
        const url = server || netServerUrl();
        this.setStatus('Connecting to ' + url + '...');
        const ws = this.ws = new WebSocket(url);
        ws.onopen = () => {
            const want2v2 = typeof location !== 'undefined' && new URLSearchParams(location.search).get('2v2') === '1'; // ?room=NAME&2v2=1 opens a new room as a 2v2 lobby
            const me = allPlayers[0] || {};
            Promise.resolve(typeof account !== 'undefined' ? account.freshToken() : null).catch(() => null).then(token => { // signed in? the server uses the token to know who you are
                if (ws.readyState === 1)
                    ws.send(JSON.stringify({ t: 'join', room, special: me.special, special2: me.special2, lobby2v2: want2v2, delta: true, token: token || undefined, skin: typeof skinMy === 'function' ? skinMy() : undefined }));
            });
            this.pingTimer = setInterval(() => this.ws && this.ws.readyState === 1 && this.ws.send(JSON.stringify({ t: 'ping', c: performance.now() })), NET_PING_MS);
        };
        ws.onmessage = e => { try { this.onMessage(JSON.parse(e.data)); } catch (err) { console.error('bad message', err); } };
        ws.onclose = () => { clearInterval(this.pingTimer); this.setStatus(this.describe()); };
        ws.onerror = () => this.setStatus('Could not reach the game server at ' + url + '. Is it running? (node server/server.js)');
        const btn = document.getElementById('online');
        if (btn) {
            btn.textContent = 'Online: On';
            btn.classList.add('on');
        }
    },
    onMessage(m) {
        if (m.t === 'welcome') {
            this.slot = m.slot;
            this.dtMs = 1000 / m.hz;
            this.snapEvery = m.snapEvery;
            if (typeof setTimeout === 'function')
                for (const d of [0, 120, 240, 360]) // measure the round trip now, not 500 ms from now: until the first pong the predictor runs with rtt = 0
                    setTimeout(() => this.ws && this.ws.readyState === 1 && this.ws.send(JSON.stringify({ t: 'ping', c: performance.now() })), d);
            this.setStatus(this.describe());
        } else if (m.t === 'slot') { // the host moved me: new seat, so forget the old seat's keys and prediction
            this.slot = m.slot;
            this.pendingSpecial = null;
            this.pendingSpecial2 = null;
            Object.assign(this.keys, noKeys());
            if (typeof pred !== 'undefined') {
                pred.state = null;
                pred.log = [];
            }
            this.setStatus(this.describe());
        } else if (m.t === 'roster') {
            this.running = m.running;
            this.lobby2v2 = !!m.lobby2v2;
            this.flex = !!m.flex;
            this.ranked = !!m.ranked;
            this.host = !!m.host;
            this.members = m.members || [];
            this.you = m.you;
            this.setStatus(this.describe());
            if (typeof gameMenu !== 'undefined')
                gameMenu.refresh();
        } else if (m.t === 'snap') {
            this.onSnapshot(m);
        } else if (m.t === 'pong') {
            const sample = performance.now() - m.c;
            this.rtt = this.rtt ? this.rtt + (sample - this.rtt) * 0.2 : sample; // smoothed: one slow packet must not make the prediction lurch ahead
            this.tps = m.tps || 0;
            this.setStatus(this.describe());
        } else if (m.t === 'chat') {
            if (typeof chat !== 'undefined')
                chat.receive(m);
        } else if (m.t === 'error')
            this.setStatus('Server: ' + m.msg);
    },
    onSnapshot(m) {
        const now = performance.now(), last = this.buf[this.buf.length - 1];
        if (last && m.tick < last.tick) { // the tick counter went backwards: a new match started
            this.reset();
            events.onNewRound();
        }
        if (m.pd) { // a delta: rebuild the players from the keyframe we hold
            const base = this.kf && this.kf.id === m.kf ? this.kf.players : (last ? last.s.players : []); // (the fallback never happens on an ordered connection: the keyframe always arrives first)
            m.s.players = base.map((bp, i) => { const d = m.pd[i]; return d === 0 ? bp : d === null ? null : 'f' in d ? d.f : netApplyDelta(bp, d); });
        } else if (m.kf !== undefined)
            this.kf = { id: m.kf, players: m.s.players }; // a keyframe: remember its players
        if (this.buf.length && m.tick === this.buf[this.buf.length - 1].tick) { // the same tick again (a paused room re-sends its board): refresh it, but it says nothing about the connection, so keep it out of the clock and jitter estimates
            this.buf[this.buf.length - 1].s = m.s;
            for (const e of m.ev)
                this.evq.push(e);
            this.ack = m.ack;
            return;
        }
        const sample = now - m.tick * this.dtMs; // how long after "server time zero" this packet arrived; the smallest recent value is the best clock estimate
        this.clk.push(sample); // the best clock estimate is the smallest arrival offset over the last NET_CLOCK_WINDOW snapshots. The old "minimum that creeps up 0.5 ms a second" stayed wrong for minutes after any server hiccup (a stall pushes every later sample up for good): that inflated the buffer to its maximum and made the predictor run too far ahead, so my own player was corrected on every snapshot
        if (this.clk.length > NET_CLOCK_WINDOW)
            this.clk.shift();
        this.off = Math.min(...this.clk);
        const queue = Math.max(0, sample - this.off); // how much later than the best packet this one arrived: the jitter
        this.jit += (queue - this.jit) * (queue > this.jit ? 0.3 : 0.02); // reacts fast to a spike, recovers slowly
        this.delayMs += (Math.min(NET_DELAY_MAX, Math.max(NET_DELAY_MIN, 40 + 2 * this.jit)) - this.delayMs) * 0.05; // the buffer we draw behind: just enough for the jitter we measure
        this.lastSnapAt = now;
        this.buf.push({ tick: m.tick, s: m.s });
        if (this.buf.length > 80)
            this.buf.shift();
        for (const e of m.ev)
            this.evq.push(e);
        this.ack = m.ack;
    },
    reset() {
        this.clk = [];
        this.buf = [];
        this.evq = [];
        this.cur = null;
        this.kf = null;
    },
    // ---- sending ----
    sendKeys() {
        let bits = 0;
        for (const k in NET_BITS)
            if (this.keys[k])
                bits |= NET_BITS[k];
        if (this.ws && this.ws.readyState === 1 && this.slot >= 0)
            this.ws.send(JSON.stringify({ t: 'in', n: ++this.seq, k: bits }));
    },
    setSpecial(id, slot = 0) { // slot 0 = first special, 1 = second
        this.pendingAt = performance.now();
        if (slot)
            this.pendingSpecial2 = id;
        else
            this.pendingSpecial = id;
        if (this.ws && this.ws.readyState === 1)
            this.ws.send(JSON.stringify({ t: 'sp', s: id, slot }));
    },
    setTwoSpecials(v) { // host only (the server checks)
        if (this.ws && this.ws.readyState === 1)
            this.ws.send(JSON.stringify({ t: 'two', v: !!v }));
    },
    // you can't change you special in the middle of a match, but the server still needs to know what you want for the next match
    setFixed(v) {
        if (this.ws && this.ws.readyState === 1)
            this.ws.send(JSON.stringify({ t: 'fixed', v: !!v }));
    },
    setSwap(v) { // host only (the server checks): turn the side swap on or off
        if (this.ws && this.ws.readyState === 1)
            this.ws.send(JSON.stringify({ t: 'swap', v: !!v }));
    },
    setLobby2v2(v) { // host only (the server checks): make the room a 2v2 lobby, or turn that off
        if (this.ws && this.ws.readyState === 1)
            this.ws.send(JSON.stringify({ t: 'lobby2v2', v: !!v }));
    },
    setFlex(v) { // host only (the server checks)
        if (this.ws && this.ws.readyState === 1)
            this.ws.send(JSON.stringify({ t: 'flex', v: !!v }));
    },
    setRanked(v) { // host only (the server checks): rate this match (needs everyone signed in) or play it casually. Restarts the match.
        if (this.ws && this.ws.readyState === 1)
            this.ws.send(JSON.stringify({ t: 'ranked', v: !!v }));
    },
    async refreshIdentity() { // my name or skin changed: a signed-in player has the server look their account up again, a guest just sends the skin
        if (!this.ws || this.ws.readyState !== 1)
            return;
        const token = typeof account !== 'undefined' ? await account.freshToken().catch(() => null) : null;
        if (!this.ws || this.ws.readyState !== 1)
            return;
        if (token)
            this.ws.send(JSON.stringify({ t: 'refresh', token }));
        else if (typeof skinMy === 'function')
            this.ws.send(JSON.stringify({ t: 'skin', skin: skinMy() }));
    },
    sendChat(text) { // returns false when there is no open connection (chat.js then tells the player)
        if (!this.ws || this.ws.readyState !== 1)
            return false;
        this.ws.send(JSON.stringify({ t: 'chat', text }));
        return true;
    },
    assign(cid, to) {
        if (this.ws && this.ws.readyState === 1)
            this.ws.send(JSON.stringify({ t: 'assign', c: cid, to }));
    },
    // ---- drawing: called once per rendered frame instead of update() ----
    frame(now) {
        const buf = this.buf;
        if (!buf.length)
            return;
        const newest = buf[buf.length - 1].tick;
        let target = (now - this.off - this.delayMs) / this.dtMs; // the server tick we should be showing right now
        if (target > newest)
            target = newest; // starved (or the match is paused): hold on the newest snapshot
        if (this.cur === null || Math.abs(target - this.cur) > 240)
            this.cur = Math.floor(target) - 1;
        for (let n = 0; this.cur + 1 <= target && n < 24; n++)
            this.applyTick(++this.cur); // one step per sim tick, so trails and effects see the same cadence as offline play
        while (buf.length > 2 && buf[1].tick <= this.cur)
            buf.shift();
    },
    show(st) { // load a state into the game's globals for drawing (also used to put the drawn world back after the predictor borrowed them)
        this.shown = st;
        loadState(st);
        if (this.slot >= 0) { // my own side shows what I am pressing right now, not what the server heard a round trip ago
            Object.assign(allPlayers[this.slot].keys, this.keys);
            if ((this.pendingSpecial || this.pendingSpecial2) && performance.now() - (this.pendingAt || 0) > 1500)
                this.pendingSpecial = this.pendingSpecial2 = null; // the server never confirmed it (it refuses changes on pick screens): stop forcing the display
            if (this.pendingSpecial) {
                if (allPlayers[this.slot].special === this.pendingSpecial)
                    this.pendingSpecial = null;
                else
                    allPlayers[this.slot].special = this.pendingSpecial;
            }
            if (this.pendingSpecial2) {
                if (allPlayers[this.slot].special2 === this.pendingSpecial2)
                    this.pendingSpecial2 = null;
                else
                    allPlayers[this.slot].special2 = this.pendingSpecial2;
            }
        }
    },
    applyTick(t) {
        const buf = this.buf;
        let i = 0;
        while (i + 1 < buf.length && buf[i + 1].tick <= t)
            i++;
        const a = buf[i], b = buf[i + 1] || a;
        const u = b.tick > a.tick && b.tick - a.tick <= 3 * this.snapEvery ? Math.min(1, Math.max(0, (t - a.tick) / (b.tick - a.tick))) : 0;
        this.show(this.shape ? this.shape(netMixState(a.s, b.s, u)) : netMixState(a.s, b.s, u)); // this.shape: net/predict.js overlays my predicted player
        while (this.evq.length && this.evq[0][1] <= t)
            this.fire(this.evq.shift());
        if (pause > 0)
            trailMelt();
        else {
            for (const p of players)
                if (p.alive)
                    events.onBodyStep(p);
            events.onBodyStep(ball);
            for (const d of decoys)
                events.onBodyStep(d);
        }
    },
    fire(e) { // the renderer's hooks, driven by what the server's simulation reported
        if (this.skipEvent && this.skipEvent(e)) // my own effects were already shown at predicted time
            return;
        const ref = r => (r === 'b' ? ball : r[0] === 'p' ? allPlayers[+r.slice(1)] : decoys[+r.slice(1)] || ball);
        if (e[0] === 'pt')
            events.onPoint(e[2], e[3]);
        else if (e[0] === 'nr')
            events.onNewRound();
        else if (e[0] === 'im')
            events.onImpact(allPlayers[e[2]], e[3], e[4], e[5], e[6], e[7]);
        else if (e[0] === 'bt')
            events.onBatHit(allPlayers[e[2]], ref(e[3]), e[4], e[5], e[6], e[7], e[8]);
    },
};

function netServerUrl() {
    const q = new URLSearchParams(location.search).get('server'), tls = location.protocol === 'https:';
    if (q)
        return q.includes('://') ? q : (tls ? 'wss://' : 'ws://') + q;
    if (!IS_LOCAL)
        return 'wss://' + GAME_HOST;
    return (tls ? 'wss://' : 'ws://') + (location.host || 'localhost:8080');
}

// ---- keyboard while online: both players' layouts drive MY seat (arrows + X / C / Z, or WASD + F / G / H) ----
const NET_KEYMAP = {};
function refreshNetKeymap() { // (again whenever the keys are rebound on the Controls tab)
    for (const k in NET_KEYMAP)
        delete NET_KEYMAP[k];
    Object.assign(NET_KEYMAP, bindings[0][1], bindings[1][1]);
}
refreshNetKeymap();
if (typeof keybinds !== 'undefined')
    keybinds.listeners.push(refreshNetKeymap); // (after input.js's own listener, which refills `bindings` first)
function netKeyEvent(e, v) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key, act = NET_KEYMAP[typeof keyToken === 'function' ? keyToken(e) : key] || (typeof keyToken === 'function' ? undefined : NET_KEYMAP[e.code]);
    if (act) {
        e.preventDefault();
        if (net.keys[act] !== v) {
            net.keys[act] = v;
            net.sendKeys();
        }
    }
    if (v && key === 'Escape')
        closeSpecialMenu();
}
window.addEventListener('blur', () => { // losing focus must not leave a key stuck down on the server
    if (net.on && Object.values(net.keys).some(Boolean)) {
        Object.assign(net.keys, noKeys());
        net.sendKeys();
    }
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden && net.on)
        window.dispatchEvent(new Event('blur'));
});

const onlineBtn = document.getElementById('online');
if (onlineBtn)
    onlineBtn.addEventListener('click', () => {
        if (net.on) {
            location.href = location.pathname; // simplest way back to offline play: a fresh page
            return;
        }
        const room = (prompt('Room name (letters, numbers, - and _). Share it with a friend so they join the same room:', 'test') || '').trim();
        if (/^[A-Za-z0-9_-]{1,24}$/.test(room))
            net.join(room);
        cv.focus();
    });
{
    const room = new URLSearchParams(location.search).get('room');
    if (room && /^[A-Za-z0-9_-]{1,24}$/.test(room))
        net.join(room);
}


