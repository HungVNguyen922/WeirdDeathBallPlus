// PHYSICS - boomerangs: the BOOMERANG special's projectiles. Never draws.
// Load order: after arrows.js (it reuses wrapAng and the arrow terrain lists) and before game/rules.js (which calls stepProjectiles()).
// Tuning numbers live in constants.js (BOOMERANG_*).
//
// One press throws a VOLLEY of BOOMERANG_VOLLEY boomerangs in a fan along the arrows held (none held: toward the net). Each one flies OUT along a curved, constant-speed arc until it has covered
// its range (the volley's ranges are staggered, so the wave is layered), then comes BACK: it keeps circling the same way it was thrown (so the path is a loop, not a U-turn) and homes in on its
// owner, turning harder the longer it takes, and is caught (removed) when it reaches them.
//
// DEFAULT: the arc bends UP first (over and around). Holding WEIGHT (keys.x) when you throw flips it: the arc bends DOWN first (under and around).
//
// PUSH: going out a boomerang is almost massless (BOOMERANG_M_OUT) so it barely moves what it touches. Coming back it is heavy (BOOMERANG_M_BACK), so whatever it meets on the return leg
// is shoved along with it, toward the owner. The outbound wave sails past an object, the return arc comes round the far side of it and drags it home.
// A boomerang never kills, its own path is not changed by what it hits, and its owner passes straight through it.

// Throw a volley from player p along the arrows held (hx, hy are -1 / 0 / 1; both 0 = toward the net).
// inv = flip the arc to bend downward first. Left out, it follows whether p is holding Weight. Returns how many were thrown (0 = already at BOOMERANG_MAX out).
function throwBoomerang(p, hx, hy, inv = !!(p.keys && p.keys.x)) {
    const n = Math.min(BOOMERANG_VOLLEY, BOOMERANG_MAX - boomCount(p));
    if (n <= 0)
        return 0;
    const base = hx || hy ? Math.atan2(hy, hx) : (p.x < NETX ? 0 : Math.PI);
    const spin = (Math.cos(base) >= 0 ? -1 : 1) * (inv ? -1 : 1);
    for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0 : k / (n - 1) - 0.5;
        const ang = wrapAng(base + t * BOOMERANG_FAN), ux = Math.cos(ang), uy = Math.sin(ang), d = p.r + BOOMERANG_R + 2;
        let x = p.x + ux * d, y = p.y + uy * d;
        if (boomBlocked(x, y, BOOMERANG_R)) { x = p.x; y = p.y; } // thrown into a wall: starts on you, hits it on the first step and comes back
        spawnProjectile('boomerang', p, x, y, ux * BOOMERANG_V, uy * BOOMERANG_V,
            { ang, sp: BOOMERANG_V, spin, phase: 0, trav: 0, back: 0, rot: 0, range: BOOMERANG_RANGE * (1 + t * BOOMERANG_RANGE_SPREAD) });
    }
    return n;
}

// Is a circle at (x, y) with radius r touching the terrain (or outside the arena walls)? The same solids arrows stick into; the net is ignored, like the death ball does.
function boomBlocked(x, y, r) {
    for (const [list, t] of ARROW_SOLIDS)
        for (const sg of list) {
            const q = nearestOnSeg(sg, x, y);
            if (Math.hypot(x - q.x, y - q.y) < r + t)
                return true;
        }
    return (y + r > H && x > 0 && x < W) || y < r || x < r || x > W - r;
}
// Push a boomerang out of the terrain. Returns true if it touched anything.
function boomTerrain(b) {
    let hit = false;
    for (const [list, t] of ARROW_SOLIDS) {
        const x0 = b.x, y0 = b.y;
        collideTerrain(b, 0, 0, list, t);
        if (b.x !== x0 || b.y !== y0)
            hit = true;
    }
    delete b.hit; // collideTerrain leaves a field behind that nothing needs
    if (b.y + b.r > H && b.x > 0 && b.x < W) { // the flat floor between the ramps
        b.y = H - b.r;
        if (b.vy > 0)
            b.vy = 0;
        hit = true;
    }
    if (b.y < b.r) {
        b.y = b.r;
        if (b.vy < 0)
            b.vy = 0;
        hit = true;
    }
    if (b.x < b.r) {
        b.x = b.r;
        if (b.vx < 0)
            b.vx = 0;
        hit = true;
    }
    if (b.x > W - b.r) {
        b.x = W - b.r;
        if (b.vx > 0)
            b.vx = 0;
        hit = true;
    }
    return hit;
}

// The boomerang meets something: a collision where the boomerang weighs BOOMERANG_M_OUT going out (a nudge) and BOOMERANG_M_BACK coming home (a shove), against the thing's own mass.
// The boomerang itself carries straight on.
function boomHit(b, o, mo) {
    const out = b.phase === 0, vx0 = b.vx, vy0 = b.vy, hit = collide(b, o, out ? BOOMERANG_M_OUT : BOOMERANG_M_BACK, mo, out ? BOOMERANG_E_OUT : BOOMERANG_E_BACK);
    b.vx = vx0;
    b.vy = vy0;
    if (hit > IMPACT_V0 && !out) { // sparks only for the hard return hits
        const dx = o.x - b.x, dy = o.y - b.y, m = Math.hypot(dx, dy) || 1;
        events.onImpact(b.owner, b.x + dx / m * b.r, b.y + dy / m * b.r, dx / m, dy / m, hit); // sparks fly the way the thing was pushed
    }
}
function boomBump(b) {
    for (const p of players)
        if (p.alive && p !== b.owner && (BOOMERANG_SOLID_TEAMMATES || p.team !== b.team))
            boomHit(b, p, PLAYER_M);
    boomHit(b, ball, BALL_M);
    for (const d of decoys)
        boomHit(b, d, BALL_M);
    boomBlocks(b);
}

PROJ_TYPES.boomerang = {
    r: BOOMERANG_R, life: BOOMERANG_LIFE, swappable: true,
    steer(b) {
        const o = b.owner;
        if (!o || !o.alive)
            return 'remove';
        b.rot += BOOMERANG_SPIN * DT;
        if (b.phase === 0) { // out: a constant-speed arc
            b.ang = wrapAng(b.ang + b.spin * BOOMERANG_TURN * DT);
            b.sp = BOOMERANG_V;
            b.trav += b.sp * DT;
            if (b.trav >= (b.range || BOOMERANG_RANGE))
                b.phase = 1;
        } else { // back: keep circling the way it was thrown, closing in on the owner
            b.back += DT;
            const dist = Math.hypot(o.x - b.x, o.y - b.y);
            const turn = Math.max(BOOMERANG_BACK_TURN + BOOMERANG_BACK_GROW * b.back, b.sp / Math.max(20, dist * 0.4)) * DT;
            let diff = wrapAng(Math.atan2(o.y - b.y, o.x - b.x) - b.ang);
            if (diff * b.spin < 0 && Math.abs(diff) > BOOMERANG_BACK_COMMIT)
                diff -= Math.sign(diff) * Math.PI * 2;
            b.ang = wrapAng(b.ang + Math.max(-turn, Math.min(turn, diff)));
            b.sp = Math.min(BOOMERANG_BACK_V, b.sp + BOOMERANG_BACK_ACC * DT);
        }
        b.vx = Math.cos(b.ang) * b.sp;
        b.vy = Math.sin(b.ang) * b.sp;
    },
    sub(b) { // (this replaces the portalPass line, which the core now does for every type)
        const o = b.owner;
        if (boomTerrain(b)) {
            if (b.phase === 0)
                b.phase = 1;
            const v = Math.hypot(b.vx, b.vy);
            b.ang = v > 30 ? Math.atan2(b.vy, b.vx) : Math.atan2(o.y - b.y, o.x - b.x);
            b.vx = Math.cos(b.ang) * b.sp;
            b.vy = Math.sin(b.ang) * b.sp;
        }
        boomBump(b);
    },
    after(b) { // caught
        const o = b.owner;
        if (b.phase === 1 && Math.hypot(o.x - b.x, o.y - b.y) <= o.r + b.r + BOOMERANG_CATCH)
            return 'remove';
    },
};
const boomCount = p => projectiles.reduce((n, b) => n + (b.type === 'boomerang' && b.owner === p ? 1 : 0), 0);