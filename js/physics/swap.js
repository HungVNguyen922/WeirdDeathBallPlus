// PHYSICS - swap: the SWAP special. Never draws (see drawSwaps in render/portals-swaps.js).
// Load order: after portals.js (it reuses portalAimStep) and before game/rules.js (which calls stepSwaps()).
// Tuning numbers live in constants.js (SWAP_*).
//
// HOW IT PLAYS: hold the special key and a cone of vision opens in front of you. While you hold, LEFT / RIGHT turn it (double tap an arrow key to snap it that way, same as ARROW and
// PORTAL). Release to swap places with the NEAREST thing in the cone, or, if you are holding weight when you let go, the FURTHEST. The thing the swap would pick right now is ringed.
// Everything that moves counts: the other players (teammates too), the death ball, decoys, arrows in flight and boomerangs. Arrows stuck in the terrain count too: the swap pulls one free, so it hangs loose where the swapper stood and falls.
// Swapping is position only, like Warp: each body keeps the velocity it had, so momentum carries over. A body is "in the cone" when its centre is within SWAP_RANGE of you and inside the
// cone's angle (a big body is seen a little earlier / later, like the bat). The cone sees through walls and the net. With nothing in the cone, letting go does nothing (a short cooldown).
// A player who ends up outside the side walls (swapped into the ball in a goal tunnel, say) dies: that rule lives in stepPortals(), which runs right after this.
// Every body a swap could pick, as long as it is not `self`.
function swapBodies(self) {
    const out = [];
    for (const q of players)
        if (q !== self && q.alive)
            out.push(q);
    out.push(ball);
    for (const d of decoys)
        if (!d.dead)
            out.push(d);
    for (const b of projectiles) 
        if (PROJ_TYPES[b.type].swappable) 
            out.push(b)
    return out;
}
// The body a swap from p with aim ang would pick: the nearest in the cone (far = false) or the furthest (far = true), or null.
function swapPick(p, ang, far) {
    let best = null, bestD = 0;
    for (const b of swapBodies(p)) {
        const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy), r = b.r || 0;
        if (d - r > SWAP_RANGE)
            continue;
        const slack = Math.asin(Math.min(1, r / Math.max(d, 1e-6)));
        if (Math.abs(wrapAng(Math.atan2(dy, dx) - ang)) > SWAP_HALF + slack)
            continue;
        if (!best || (far ? d > bestD : d < bestD)) {
            best = b;
            bestD = d;
        }
    }
    return best;
}
function doSwap(p, b) {
    const ax = p.x, ay = p.y, bx = b.x, by = b.y;
    p.x = bx;
    p.y = by;
    b.x = ax;
    b.y = ay;
    for (const q of [p, b])
        if (q instanceof Player)
            q.netSide = q.x < NETX ? 0 : 1; // like Warp / Portal: the net guard in Player.step must know which side we are on now, or it drags us back
    if (b.stuck) { // a landed arrow: it leaves the wall with the swap, hangs loose where the swapper stood and falls
        b.stuck = false;
        b.ghost = ARROW_GHOST_T;
        b.vx = b.vy = 0;
        b.life = Math.max(b.life, ARROW_KNOCK_LIFE);
        b.immune = ARROW_IMMUNE_T;
    }
    if (b.type === 'block') { // it may land inside terrain: it must not shatter on the first tick
        b.age = 0;
        b.hitV = 0;
    }
    // What the renderer needs to fly a ghost of each body between the two spots (plain data, so it travels in snapshots): what b is, its size and colour.
    const kind = b instanceof Player ? 'player' : b.type === 'block' ? 'block' : 'stuck' in b ? 'arrow' : 'phase' in b ? 'boomerang' : 'ball';
    p.swapFx = { t: SWAP_FX, ax, ay, bx, by, pr: p.r, bk: kind, br: b.r || 8, bcol: kind === 'player' ? b.color : kind === 'arrow' || kind === 'boomerang' || kind === 'block' ? (b.team === 0 ? '#42a5f5' : '#ef5350') : null, bang: kind === 'block' ? b.th : b.ang === undefined ? 0 : b.ang, bid: kind === 'player' ? b.id : -1, bpts: kind === 'block' ? b.pts : null };
}
function clearSwaps() { // new round
    for (const p of allPlayers) {
        p.scast = null;
        p.swapHeld = false;
        p.swapFx = null;
    }
}
function stepSwaps() { // once per tick, after the bodies have moved
    for (const p of players) {
        const k = p.keys, held = (p.special === 'swap' && !!k.sp) || (twoSpecials && p.special2 === 'swap' && !!k.sp2);
        if (p.swapFx && (p.swapFx = { ...p.swapFx, t: p.swapFx.t - DT }).t <= 0)
            p.swapFx = null;
        if (!p.alive)
            p.scast = null;
        else if (p.scast) {
            if (held) {
                portalAimStep(p.scast, k, SWAP_TURN, SWAP_DBL_T);
                p.swapAng = p.scast.ang; // remembered, so the next cone starts where this one ended
            } else {
                const b = swapPick(p, p.scast.ang, !!k.x);
                if (b)
                    doSwap(p, b);
                p.cd.swap = b ? SWAP_COOLDOWN : SWAP_MISS_CD;
                p.scast = null;
            }
        } else if (held && !p.swapHeld && !(p.cd.swap > 0) && !p.pcast && !aimingCastRunning(p))
            p.scast = { ang: p.swapAng === undefined ? -Math.PI / 2 : p.swapAng, noTilt: false, tap: { l: 0, r: 0, u: 0, d: 0 }, prev: { l: !!k.l, r: !!k.r, u: !!k.up, d: !!k.dn } }; // starts pointing where the last one did (up the first time)
        p.swapHeld = held;
    }
}
