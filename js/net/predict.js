// NET - client-side prediction + reconciliation for MY player and the things I affect. Load after net/client.js, before main.js.
//
// The server stays authoritative. Without prediction you see yourself ~100 ms interpolation delay + a round trip late. With it:
//   1. Every frame we run a private copy of the whole sim (the same update() the server runs) up to the tick the server will be at when my input arrives:
//        target = serverTickNow + rtt / tick-length.   My own inputs are applied at the tick they will reach the server (pt = next predicted tick).
//   2. Every snapshot (server tick T, ack = last input of mine the server had applied) we ROLL BACK: load the server's state at T, throw away inputs with seq <= ack
//      (the snapshot already contains them), and replay the rest, tick by tick, up to where we were. The replayed result is the new prediction.
//      Opponent keys are held at whatever the snapshot says (we cannot know better). If it was wrong, the replay differs a little: that difference is
//      smoothed away by an offset that decays over a few frames instead of snapping (a jump bigger than PRED_SNAP_DIST snaps).
//   3. Drawing: the opponent and everything of theirs stays on the interpolated (delayed) timeline. What comes from the prediction (the "predicted timeline"):
//        - my player,
//        - the death ball (PRED_WORLD): it is the thing my bat, arrows, grapple and crash shots act on, so it must live on MY timeline or my swing would land ~150 ms
//          after it is drawn, and the ball would pop between timelines every time I latch on / let go. Where the server disagrees (the opponent touched it) the correction is
//          blended in over a few frames,
//        - arrows and plinko pegs I made (they appear the instant I release),
//        - my bat-hit / impact effects, fired at predicted time; the server's later copy of the same event is dropped.
//      An opponent who is tethered to the ball gets their rope end moved onto the predicted ball so the rope never detaches from it.
//        - the OPPONENT's arrows, plinko pegs and boomerangs too (PRED_SHOTS). Their shots used to be drawn on the delayed timeline, so on a slow connection you saw an arrow
//          roughly ping + buffer late, while your own player (predicted, ahead of the server) was already about to be hit by it. Now a shot appears the moment the snapshot that
//          contains it arrives, already advanced to where it is on MY clock, which is where it will be when it reaches me. The price: a shot the opponent steers or deflects after
//          that can jump a little when the next snapshot corrects it. Add  ?predshots=0  to compare with the old behaviour.
//      Deaths / round changes are always the server's word. Add  ?predworld=0  to the page URL to go back to predicting only my own player.
const PRED_MAX_AHEAD = 90;   // never predict more than this many ticks past the last server state (spikes / stalls)
const PRED_SNAP_DIST = 120;  // a correction bigger than this (u) is a teleport (respawn, hatchet): show it at once
const PRED_BALL_SNAP = 220;  // same, for the ball (it is fast: a late opponent hit can legitimately move it far)
const PRED_ERR_DECAY = 0.86; // per rendered frame, share of the visual correction that is left
const PRED_EVENT_SLACK = 24; // a server event this many ticks from a predicted one of the same kind is the same event
const PRED_WORLD = !(typeof location !== 'undefined' && /[?&]predworld=0/.test(location.search || ''));

let PRED_SHOTS = PRED_WORLD && !(typeof location !== 'undefined' && /[?&]predshots=0/.test(location.search || '')); // opponent projectiles also come from the predicted world (see above)

const pred = { state: null, tick: 0, ack: 0, log: [], err: { x: 0, y: 0 }, errBall: { x: 0, y: 0 }, lastT: -1, lastFix: 0, visited: 0, fired: [] }; // state = saveState() at pred.tick; log = my inputs { seq, pt, bits }

function predBitsOf(keys) {
    let b = 0;
    for (const k in NET_BITS)
        if (keys[k])
            b |= NET_BITS[k];
    return b;
}
function predQuiet(fn, capture) { // run the sim without telling the renderer; with `capture`, my own bat hits and impacts are collected instead
    const saved = {};
    for (const k in events) {
        saved[k] = events[k];
        events[k] = () => {};
    }
    if (capture) {
        events.onBatHit = (p, b, x, y, ux, uy, k) => { if (p.id === net.slot) capture.push(['bt', pred.tick + 1, x, y, ux, uy, k, b.r]); };
        events.onImpact = (p, x, y, ux, uy, v) => { if (p.id === net.slot) capture.push(['im', pred.tick + 1, x, y, ux, uy, v]); };
    }
    try { return fn(); } finally { Object.assign(events, saved); }
}
function predBitsAt(t) { // my key mask at predicted tick t, from inputs the server has not confirmed yet (null = whatever the loaded state says)
    let b = null;
    for (const e of pred.log)
        if (e.seq > pred.ack && e.pt <= t)
            b = e.bits;
    return b;
}
function predStep() { // one tick of the private sim (the caller has loaded pred's world and muted the events)
    const b = predBitsAt(pred.tick + 1);
    if (b !== null) {
        const k = allPlayers[net.slot].keys;
        for (const n in NET_BITS)
            k[n] = !!(b & NET_BITS[n]);
    }
    update();
    pred.tick++;
}
const predNow = () => Math.floor((performance.now() - net.off) / net.dtMs + net.rtt / net.dtMs); // the server tick my input would land on, from the clock
function predPress(bits, seq, base = pred.state ? pred.tick : predNow()) { // my keys changed and were sent as input #seq: it will be applied by the server at the next predicted tick
    pred.log.push({ seq, pt: base + 1, bits });
    if (pred.log.length > 240)
        pred.log.shift();
}
function predFire(e) { // one of MY effects, at the moment the predicted world produced it (the server's copy is dropped later by predSkipServerEvent)
    const me = allPlayers[net.slot];
    pred.fired.push({ type: e[0], tick: e[1], used: false });
    if (pred.fired.length > 60)
        pred.fired.shift();
    if (e[0] === 'bt')
        events.onBatHit(me, { r: e[7] }, e[2], e[3], e[4], e[5], e[6]);
    else
        events.onImpact(me, e[2], e[3], e[4], e[5], e[6]);
}
function predSkipServerEvent(e) { // net.fire asks this for every server event
    if (!pred.state || (e[0] !== 'bt' && e[0] !== 'im') || e[2] !== net.slot)
        return false;
    for (const f of pred.fired)
        if (!f.used && f.type === e[0] && Math.abs(f.tick - e[1]) <= PRED_EVENT_SLACK) {
            f.used = true;
            return true;
        }
    return false;
}
function predAdvance(target) {
    if (!pred.state)
        return;
    target = Math.min(target, pred.lastT + PRED_MAX_AHEAD);
    if (target <= pred.tick)
        return;
    const cap = [];
    loadState(pred.state);
    predQuiet(() => { while (pred.tick < target) predStep(); }, cap);
    pred.state = saveState();
    for (const e of cap)
        if (e[1] > pred.visited) // a tick is only ever "new" once: rollbacks replay old ticks silently
            predFire(e);
    pred.visited = Math.max(pred.visited, pred.tick);
}
// A snapshot arrived: roll back to it and replay my unconfirmed inputs. Returns how far (u) my player moved compared with what we had predicted.
function predReconcile(T, s, ack) {
    const slot = net.slot, old = pred.state ? pred.state.players[slot] : null, oldBall = pred.state ? pred.state.ball : null, oldTick = pred.tick;
    const fresh = !pred.state || T < pred.lastT || pred.tick < T - 240; // first snapshot, or a new match began
    pred.lastT = T;
    pred.ack = ack;
    pred.log = pred.log.filter(e => e.seq > ack);
    const end = fresh ? T : Math.max(pred.tick, T);
    pred.tick = T;
    loadState(s);
    predQuiet(() => { while (pred.tick < end) predStep(); });
    pred.state = saveState();
    if (fresh) {
        pred.visited = T;
        pred.fired = [];
    }
    pred.lastFix = old && !fresh ? Math.hypot(old.x - pred.state.players[slot].x, old.y - pred.state.players[slot].y) : 0;
    if (!old || fresh) {
        pred.err.x = pred.err.y = pred.errBall.x = pred.errBall.y = 0;
        return 0;
    }
    if (oldTick !== pred.tick)
        return 0; // the predictor was behind the snapshot: the two states are different moments, comparing them would invent a correction
    const me = pred.state.players[slot], dx = old.x - me.x, dy = old.y - me.y, e = Math.hypot(dx, dy);
    if (e > PRED_SNAP_DIST)
        pred.err.x = pred.err.y = 0;
    else {
        pred.err.x += dx; // what is drawn is prediction + err, so the picture does not jump; err then fades
        pred.err.y += dy;
    }
    if (oldBall && oldTick === pred.tick) { // the same for the ball (compared at the same tick; if we were behind, there is nothing to compare)
        const bx = oldBall.x - pred.state.ball.x, by = oldBall.y - pred.state.ball.y;
        if (Math.hypot(bx, by) > PRED_BALL_SNAP)
            pred.errBall.x = pred.errBall.y = 0;
        else {
            pred.errBall.x += bx;
            pred.errBall.y += by;
        }
    }
    return e;
}
function predFrame(now) {
    pred.err.x *= PRED_ERR_DECAY;
    pred.err.y *= PRED_ERR_DECAY;
    pred.errBall.x *= PRED_ERR_DECAY;
    pred.errBall.y *= PRED_ERR_DECAY;
    if (!pred.state || net.slot < 0 || !net.running)
        return;
    predAdvance(predNow() + 1);
    if (net.shown)
        net.show(net.shown); // the predictor borrowed the game's globals: put the drawn world back
}
// Called by net.applyTick on the interpolated state just before it is loaded for drawing: put the predicted timeline's parts into it.
function predShape(mixed) {
    const slot = net.slot;
    if (!pred.state || slot < 0 || !net.running || mixed.pause > 0)
        return mixed;
    const ps = pred.state, me = ps.players[slot], theirs = mixed.players[slot];
    let out = { ...mixed };
    if (PRED_WORLD && ps.pause <= 0) { // (a goal scored in the predicted world freezes it: until the drawn world gets there too, only my player is predicted)
        const b = ps.ball;
        out.ball = { ...b, x: b.x + pred.errBall.x, y: b.y + pred.errBall.y };
        if (PRED_SHOTS) { // everybody's projectiles live on my clock (they are tied to their owner by id, not by list position, so nothing else needs re-pointing)
            out.pegs = ps.pegs.slice();
            out.projectiles = (ps.projectiles || []).slice();
        } else {
            out.pegs = mixed.pegs.filter(q => q.owner !== slot).concat(ps.pegs.filter(q => q.owner === slot));
            out.projectiles = (mixed.projectiles || []).filter(p => p.owner !== slot).concat((ps.projectiles || []).filter(p => p.owner === slot));
        }
        // Decoys: mine, and the one I am tethered to, come from the predicted world (the rope end is computed there, so it must hang on the decoy that is drawn).
        // The others stay on the drawn timeline. Decoys are told apart by owner (one per player), because their index in the list differs between the two worlds.
        const tethered = me.tball > 0 ? ps.decoys[me.tball - 1] : null;
        const fromPred = ps.decoys.filter(d => d.owner === slot || d === tethered), predOwners = new Set(fromPred.map(d => d.owner));
        const list = mixed.decoys.filter(d => !predOwners.has(d.owner)).concat(fromPred);
        const idxOf = owner => list.findIndex(d => d.owner === owner) + 1; // 0 = no such decoy in this picture
        out.decoys = list;
        out.players = mixed.players.map((q, i) => {
            if (!q || i === slot)
                return q; // replaced below
            if (q.onBall && q.tball === 0 && q.rope) { // tethered to the ball: their hook is on the ball's edge, so move it with the ball
                const ang = out.ball.th + q.hookAng;
                return { ...q, rope: { ...q.rope, x: out.ball.x + Math.cos(ang) * out.ball.r, y: out.ball.y + Math.sin(ang) * out.ball.r } };
            }
            if (q.tball > 0) { // tethered to a decoy: find it again in the new list; if it was mine and is gone in my timeline they let go
                const owner = mixed.decoys[q.tball - 1].owner, k = idxOf(owner);
                if (!k)
                    return { ...q, tball: null, onBall: false, rope: null };
                if (!predOwners.has(owner) || !q.rope)
                    return { ...q, tball: k };
                const d = list[k - 1], ang = d.th + q.hookAng; // the decoy was swapped for its predicted copy: hang the hook on that one
                return { ...q, tball: k, rope: { ...q.rope, x: d.x + Math.cos(ang) * d.r, y: d.y + Math.sin(ang) * d.r } };
            }
            return q;
        });
        pred.drawnDecoyIdx = idxOf; // my own tether is remapped with this below
    } else if (me.tball === 0)
        out.ball = ps.ball; // old behaviour: only while I am tethered to it
    if (!theirs.alive)
        return out; // death is the server's call (a predicted death is shown early: it is almost always the ball, which we simulate too)
    const mine = { ...me, x: me.x + pred.err.x, y: me.y + pred.err.y };
    if (me.tball > 0) // the index of a decoy in the predicted world means nothing in the drawn list: look it up by owner
        mine.tball = PRED_WORLD && ps.pause <= 0 ? pred.drawnDecoyIdx(ps.decoys[me.tball - 1].owner) || null : theirs.tball;
    const players = out.players.slice();
    players[slot] = mine;
    out.players = players;
    return out;
}

// ---- hook into net (client.js) when running in the page ----
if (typeof net.onSnapshot === 'function') {
    const onSnap = net.onSnapshot.bind(net), frame = net.frame.bind(net), sendKeys = net.sendKeys.bind(net);
    net.onSnapshot = function (m) {
        onSnap(m);
        if (this.slot >= 0 && this.running) {
            predReconcile(m.tick, m.s, m.ack);
            if (this.shown)
                this.show(this.shown);
        } else
            pred.state = null;
    };
    net.sendKeys = function () {
        const before = this.seq;
        sendKeys();
        if (this.seq !== before && this.running)
            predPress(predBitsOf(this.keys), this.seq);
    };
    net.frame = function (now) {
        predFrame(now);
        frame(now);
    };
    net.shape = predShape;
    net.skipEvent = predSkipServerEvent;
    net.extra = () => `prediction on${PRED_WORLD ? (PRED_SHOTS ? '' : ', shots delayed') : ' (player only)'}, ${pred.state ? pred.tick - pred.lastT : 0} ticks ahead, last fix ${pred.lastFix.toFixed(1)} u`; // shown in the status line next to the ping
}


