// MAIN - wires the renderer to the simulation and runs the fixed-timestep loop.
// Hook the renderer into the game's events (the game never calls the renderer directly).
events.onPoint = (team, why) => {
    hud.flash[team] = 1;
    if (why === 'scores!')
        hud.line[1 - sideSwap(team)] = 1; // the threshold line that was crossed lights up
};
events.onBodyStep = trailPush;
events.onPauseTick = trailMelt;
events.onNewRound = () => { trailClear(); impactsClear(); prevPos.clear(); };
events.onBatHit = spawnBatImpact;
events.onImpact = spawnImpact;

// RENDER SMOOTHING: the simulation steps at a fixed 120 Hz but the screen refreshes at its own rate (60, 144, ...), so on most screens some frames get 0 steps and some 2 and fast
// bodies visibly stutter. Offline, each frame is therefore DRAWN a fraction of the way between the last two simulation states (players, ball, decoys, the rope's hook point):
// pure display, the simulation itself is untouched. A body that jumped further than RENDER_JUMP u in one step (a respawn, warp, portal, swap) is drawn where it is, not smeared.
const RENDER_INTERP = true;
const RENDER_JUMP = 60;
const prevPos = new Map();
const interpBodies = () => [...allPlayers, ball, ...decoys];
function interpCapture() {
    prevPos.clear();
    for (const o of interpBodies()) {
        prevPos.set(o, { x: o.x, y: o.y, th: o.th });
        if (o.rope)
            prevPos.set(o.rope, { x: o.rope.x, y: o.rope.y });
    }
}
function interpBegin(f) { // move everything to f (0..1) of the way from its previous state to its current one; returns the function that puts it back
    const undo = [];
    const lerp = (o, key) => {
        const q = prevPos.get(o);
        if (!q || Math.hypot(o.x - q.x, o.y - q.y) > RENDER_JUMP)
            return;
        undo.push([o, o.x, o.y, o.th]);
        o.x = q.x + (o.x - q.x) * f;
        o.y = q.y + (o.y - q.y) * f;
        if (q.th !== undefined && o.th !== undefined && Math.abs(o.th - q.th) < 2)
            o.th = q.th + (o.th - q.th) * f;
    };
    for (const o of interpBodies()) {
        lerp(o);
        if (o.rope && o.rope !== o)
            lerp(o.rope);
    }
    return () => { for (const [o, x, y, th] of undo) { o.x = x; o.y = y; if (th !== undefined) o.th = th; } };
}
let last = performance.now(), acc = 0;
function frame(t) {
    acc += Math.min(0.05, (t - last) / 1000);
    last = t;
    let restore = null;
    if (net.on) { // NET: online, the server runs the simulation; we only draw what it sends
        acc = 0;
        net.frame(performance.now());
    } else {
        while (acc >= DT) {
            if (RENDER_INTERP)
                interpCapture();
            update();
            acc -= DT;
        }
        if (RENDER_INTERP && prevPos.size && !pause)
            restore = interpBegin(Math.min(1, acc / DT));
    }
    try {
        draw();
    } finally {
        if (restore)
            restore();
    }
    requestAnimationFrame(frame);
}

(function warmUpPointFx() { // pay the one-time costs (font lookup, JIT, first gradients) at load, not on the first goal
    const sMsg = msg, sPause = pause, sOver = over;
    try {
        cx.save();
        cx.translate(OX, HUD);
        for (const [t, win] of [[0, false], [1, true]]) {
            msg = (t === 0 ? 'Blue' : 'Red') + ' scores!';
            over = win;
            pause = 1; // e = 0.6 s into a goal, 3 s into a win (so confetti and fireworks run too)
            drawPointFx();
        }
        drawBanner('GET READY', 0.5, 0); // same font, used by the pick screens and side changes
        cx.restore();
        cx.clearRect(0, 0, cv.width, cv.height);
    } catch (e) {
        console.warn('point fx warm-up failed', e);
    } finally {
        msg = sMsg; pause = sPause; over = sOver;
    }
})();
newRound();
requestAnimationFrame(frame);
