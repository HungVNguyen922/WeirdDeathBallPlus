// PHYSICS - builder: the BUILDER special. Never draws (see render/builder.js). Tuning numbers live in constants.js (BUILDER_*).
// Load order: after accelerator.js (it uses projectiles, ARROW_SOLIDS, stuckSegs and the terrain lists) and before game/rules.js.
//
// HOW IT PLAYS: press the special key and a block appears next to you, in the direction you hold, carrying your momentum (BUILDER_INHERIT). Hold WEIGHT for the other version.
//     LEFT / RIGHT   a square the size of you        |  weight: a right triangle (the square cut on its diagonal): upright side toward you, slope falling away
//     UP / DOWN      a flat 2:1 slab (2 wide, 1 tall) |  weight: the slab stood on end (1 wide, 2 tall)
//     nothing        a circle                         |  weight: a 2:1 oval (2 wide, 1 tall)
//   (nothing held = toward the net. A diagonal counts as LEFT / RIGHT.)
// Players slide over blocks with NO contact friction, like any platform (only the block's own contacts with terrain and the ball have BUILDER_MU).
//
// A block is a PROJECTILE of type 'block' (see projectiles.js), so it is saved, rolled back, interpolated and cleared at round end like arrows and boomerangs. It has normal projectile
// physics: gravity, terrain collisions (with a little bounce and ground friction), and it is solid for players, the death ball, decoys and other blocks. It never rotates: its shape
// is a convex polygon stored as plain data, b.pts = [[x, y], ...] relative to its CENTRE OF MASS (unrotated), turned by b.th. Players can stand on it (see blocksVsPlayer, called from stepCollide).
// It is a rigid body: b.w is its spin, b.k2 its gyration (inertia / mass), and every contact (terrain, players, the death ball, other blocks, the grapple rope) pushes at a POINT, so it tips,
// rolls and swings. Its air physics copy the death ball (BALL_G gravity, drag, speed cap, spin drag). The net does not affect it, like the ball.
// BREAKING: every contact records how hard it was (b.hitV, the closing speed; terrain counts BUILDER_TERRAIN_K as much). Above BUILDER_BREAK_V the block breaks: it is removed and
// shoves everything within BUILDER_BREAK_R away a little (a "slight impulse"). A new block ignores breaks for BUILDER_GRACE s. Awakened players hit harder (their crashK).
// GRAPPLE: a block can be grappled like a decoy (see the notes for physics/player-grapple.js): the hook sits on the nearest surface point and rides with the block.

// ---- polygon helpers ----
const bkRel = b => { const c = Math.cos(b.th), s = Math.sin(b.th); return b.pts.map(([x, y]) => [x * c - y * s, x * s + y * c]); }; // corners relative to the centre, turned by th
const bkMass = pts => { // centroid and inertia / mass of a positive-area polygon
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length], cr = p[0] * q[1] - q[0] * p[1];
        A += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr;
    }
    A /= 2; cx /= 6 * A; cy /= 6 * A;
    const sh = pts.map(([x, y]) => [x - cx, y - cy]);
    let I = 0;
    for (let i = 0; i < sh.length; i++) {
        const p = sh[i], q = sh[(i + 1) % sh.length], cr = p[0] * q[1] - q[0] * p[1];
        I += cr * (p[0] * p[0] + p[0] * q[0] + q[0] * q[0] + p[1] * p[1] + p[1] * q[1] + q[1] * q[1]) / 12;
    }
    return { cx, cy, pts: sh, k2: I / A };
};
function bkOrient(pts) { // every polygon is stored with positive area, so "inside" is always the left of an edge
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a < 0 ? pts.slice().reverse() : pts;
}
const bkRot = (pts, a) => { const c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]); };
const bkPts = b => bkRel(b).map(q => [b.x + q[0], b.y + q[1]]);
const bkMid = P => { let x = 0, y = 0; for (const q of P) { x += q[0]; y += q[1]; } return [x / P.length, y / P.length]; };

// Separating-axis test. A and B are convex point lists (B may be a 2-point segment with thickness t). Returns { nx, ny, pen } with (nx, ny) pointing from B toward A and pen = how far
// A must move along it to get clear, or null when they do not overlap.
function bkSat(A, B, t) {
    let best = null;
    const ca = bkMid(A), cb = bkMid(B);
    for (const P of [A, B]) {
        const n = P.length, edges = n === 2 ? 1 : n;
        for (let i = 0; i < edges; i++) {
            const p = P[i], q = P[(i + 1) % n];
            let ax = q[1] - p[1], ay = p[0] - q[0];
            const m = Math.hypot(ax, ay);
            if (m < 1e-9)
                continue;
            ax /= m;
            ay /= m;
            let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
            for (const r of A) { const d = r[0] * ax + r[1] * ay; if (d < a0) a0 = d; if (d > a1) a1 = d; }
            for (const r of B) { const d = r[0] * ax + r[1] * ay; if (d < b0) b0 = d; if (d > b1) b1 = d; }
            const o = Math.min(a1 - (b0 - t), b1 + t - a0);
            if (o <= 0)
                return null; // a separating axis: no contact
            if (!best || o < best.pen)
                best = { nx: ax, ny: ay, pen: o };
        }
    }
    if (best && (ca[0] - cb[0]) * best.nx + (ca[1] - cb[1]) * best.ny < 0) {
        best.nx = -best.nx;
        best.ny = -best.ny;
    }
    return best;
}

// Block b against a circle (x, y, r): { nx, ny, pen } pointing from the block to the circle, or null.
function bkCircle(b, x, y, r) {
    const P = bkRel(b), n = P.length;
    let inside = true, bestD = Infinity, qx = 0, qy = 0, onx = 0, ony = -1;
    for (let i = 0; i < n; i++) {
        const ax = b.x + P[i][0], ay = b.y + P[i][1], ex = b.x + P[(i + 1) % n][0] - ax, ey = b.y + P[(i + 1) % n][1] - ay, l2 = ex * ex + ey * ey || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2)), px = ax + ex * t, py = ay + ey * t, d = Math.hypot(x - px, y - py);
        if (ex * (y - ay) - ey * (x - ax) < 0)
            inside = false;
        if (d < bestD) {
            bestD = d;
            qx = px;
            qy = py;
            const l = Math.sqrt(l2);
            onx = ey / l; // the edge's outward normal (the interior is on its left)
            ony = -ex / l;
        }
    }
    if (inside)
        return { nx: onx, ny: ony, pen: r + bestD };
    if (bestD >= r)
        return null;
    return bestD > 1e-6 ? { nx: (x - qx) / bestD, ny: (y - qy) / bestD, pen: r - bestD } : { nx: 0, ny: -1, pen: r };
}
function blockNearest(b, x, y) { // the point on the block's outline closest to (x, y) (a grapple hook goes there)
    const P = bkRel(b), n = P.length;
    let best = null, bd = Infinity;
    for (let i = 0; i < n; i++) {
        const ax = b.x + P[i][0], ay = b.y + P[i][1], ex = b.x + P[(i + 1) % n][0] - ax, ey = b.y + P[(i + 1) % n][1] - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1))), px = ax + ex * t, py = ay + ey * t, d = Math.hypot(x - px, y - py);
        if (d < bd) {
            bd = d;
            best = { x: px, y: py };
        }
    }
    return best;
}

// Terrain near block b: [segment, thickness] pairs. The same solids arrows stick into, plus stuck arrows (NOT the net: blocks pass through it), the flat floor (it follows the seesaw) and the ceiling.
function bkSolids(b) {
    const out = [], R = b.r + 6, fy = H + sawY(b.x);
    const add = (sg, t) => { const q = nearestOnSeg(sg, b.x, b.y); if (Math.hypot(b.x - q.x, b.y - q.y) < R + t) out.push([sg, t]); };
    for (const [list, t] of ARROW_SOLIDS)
        for (const sg of list)
            add(sg, t);
    for (const sg of stuckSegs)
        add(sg, ARROW_HALF_W);
    add([0, fy, W, fy], 0);
    add([0, 0, W, 0], 0);
    return out;
}
const bkBlocked = b => bkSolids(b).some(([sg, t]) => { const h = bkSat(bkPts(b), [[sg[0], sg[1]], [sg[2], sg[3]]], t); return h && h.pen > 1; });

// ---- shapes ----
// (local frame: +x points AWAY from the builder; the origin is the block's centre, except the semicircle, whose origin is the middle of its flat side)
function bkShape(kind, tri, ux) { // ux = which way the builder faces horizontally (+1 / -1), only used by the right triangle
    const S = BUILDER_SIZE, h = S / 2, ring = (a, b, n) => Array.from({ length: n }, (_, k) => [a * Math.cos(Math.PI * 2 * k / n), b * Math.sin(Math.PI * 2 * k / n)]);
    let pts;
    if (kind === 'LR') // a square; with weight, the square cut along its diagonal: upright side next to you, the slope falling away from you
        pts = tri ? [[-h * ux, -h], [-h * ux, h], [h * ux, h]] : [[-h, -h], [h, -h], [h, h], [-h, h]];
    else if (kind === 'UD') // a flat 2:1 slab; with weight, the same slab stood on end
        pts = tri ? [[-h, -S], [h, -S], [h, S], [-h, S]] : [[-S, -h], [S, -h], [S, h], [-S, h]];
    else // a circle; with weight, a 2:1 oval (wide)
        pts = tri ? ring(S, h, 20) : ring(h, h, 16);
    return bkOrient(pts);
}

function buildBlock(p, hx, hy, tri) {
    const kind = hx ? 'LR' : hy ? 'UD' : 'N';
    const ux = kind === 'LR' ? hx : kind === 'UD' ? 0 : (p.x < NETX ? 1 : -1), uy = kind === 'UD' ? hy : 0; // a diagonal counts as sideways; none builds toward the net
    const sh = bkMass(bkShape(kind, tri, ux)), pts = sh.pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]); // re-centred on the centre of mass
    let ext = 0, bound = 0;
    for (const [x, y] of pts) {
        ext = Math.max(ext, -(x * ux + y * uy)); // how far the shape reaches back toward the builder
        bound = Math.max(bound, Math.hypot(x, y));
    }
    const gap = p.r + 2 + ext, x = p.x + ux * gap, y = p.y + uy * gap;
    if (bkBlocked({ pts, x, y, r: bound, th: 0 })) {
        p.cd.builder = BUILDER_MISS_CD;
        return false;
    }
    const mine = projOf('block').filter(b => b.owner === p);
    while (mine.length >= BUILDER_MAX)
        removeBlock(mine.shift()); // the oldest goes
    // tm / ti: its mass and inertia as the GRAPPLE code sees them (the same units as BALL_TM / BALL_I; a block weighs as much as the death ball)
    spawnProjectile('block', p, x, y, p.vx * BUILDER_INHERIT, p.vy * BUILDER_INHERIT, { // it is thrown with your momentum
        pts, r: bound, th: 0, w: 0, k2: sh.k2, tm: BALL_TM, ti: BALL_TM * sh.k2, age: 0, hitV: 0, stress: 0, rest: 0, broken: 0, lastGrab: -1, shape: kind + (tri ? 'T' : '') });
    p.cd.builder = BUILDER_COOLDOWN;
    return true;
}

// ---- removing and breaking ----
function builderRelease(b) { // anyone tethered to this block lets go
    for (const p of allPlayers)
        if (p.tball === b) {
            p.rope = null;
            p.onBall = false;
            p.tball = null;
            p.stretchT = 0;
        }
}
function removeBlock(b) {
    builderRelease(b);
    const i = projectiles.indexOf(b);
    if (i >= 0)
        projectiles.splice(i, 1);
}
function breakBlock(b) { // it shatters: a slight push on everything close, then it is gone (steer removes it next tick)
    if (b.broken)
        return;
    b.broken = 1;
    builderRelease(b);
    for (const q of [...players.filter(p => p.alive), ball, ...decoys.filter(d => !d.dead)]) {
        const dx = q.x - b.x, dy = q.y - b.y, d = Math.hypot(dx, dy), reach = BUILDER_BREAK_R + b.r + q.r;
        if (d > reach)
            continue;
        const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1, k = BUILDER_BREAK_KICK * (1 - d / reach);
        q.vx += nx * k;
        q.vy += ny * k;
    }
    if (b.owner && !b.owner.sim)
        events.onImpact(b.owner, b.x, b.y, 0, -1, BUILDER_BREAK_V * 1.2); // the renderer's spark burst
}

// ---- contact with bodies ----
// One contact between block k and another body o (a player, the death ball, a decoy or another block; null = fixed terrain) at the world point (px, py), with the normal (nx, ny)
// pointing from the block toward o. Normal impulse with restitution e, then Coulomb friction mu: because it acts at the point, the block spins. Returns the closing speed (0 if apart).
function bkImpulse(k, o, imo, nx, ny, px, py, e, mu) {
    const im = 1 / BUILDER_M, ii = 1 / (BUILDER_M * k.k2), oi = o && o.k2 ? 1 / (BUILDER_M * o.k2) : 0;
    const rx = px - k.x, ry = py - k.y, ox = o ? px - o.x : 0, oy = o ? py - o.y : 0;
    const rel = () => { // o's velocity at the contact relative to the block's
        const kvx = k.vx - k.w * ry, kvy = k.vy + k.w * rx;
        const ovx = o ? o.vx - (oi ? o.w * oy : 0) : 0, ovy = o ? o.vy + (oi ? o.w * ox : 0) : 0;
        return [ovx - kvx, ovy - kvy];
    };
    let [rvx, rvy] = rel();
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0)
        return 0;
    const cn = rx * ny - ry * nx, on = ox * ny - oy * nx;
    const j = -(1 + (-vn < 40 ? 0 : e)) * vn / (im + imo + cn * cn * ii + on * on * oi); // (a gentle touch does not bounce: no jitter at rest)
    const push = (jx, jy, c, oc) => { // an impulse (jx, jy) on o and the opposite one on the block
        k.vx -= jx * im; k.vy -= jy * im; k.w -= c * ii;
        if (o) { o.vx += jx * imo; o.vy += jy * imo; if (oi) o.w += oc * oi; }
    };
    push(j * nx, j * ny, cn * j, on * j);
    if (mu > 0) {
        [rvx, rvy] = rel();
        const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty, ct = rx * ty - ry * tx, ot = ox * ty - oy * tx;
        const jt = Math.max(-mu * j, Math.min(mu * j, -vt / (im + imo + ct * ct * ii + ot * ot * oi)));
        push(jt * tx, jt * ty, ct * jt, ot * jt);
    }
    return -vn;
}
// Block k against a circle c (a player, the death ball or a decoy) of mass mc: pushed apart by mass, then the impulse at the touching point. Returns the contact or null.
function bkVsCircle(k, c, mc, e, mu) {
    const h = bkCircle(k, c.x, c.y, c.r);
    if (!h)
        return null;
    const tm = BUILDER_M + mc;
    k.x -= h.nx * h.pen * mc / tm;
    k.y -= h.ny * h.pen * mc / tm;
    c.x += h.nx * h.pen * BUILDER_M / tm;
    c.y += h.ny * h.pen * BUILDER_M / tm;
    const cv = bkImpulse(k, c, 1 / mc, h.nx, h.ny, c.x - h.nx * (c.r - h.pen), c.y - h.ny * (c.r - h.pen), e, mu);
    k.hitV = Math.max(k.hitV, cv * (c.crashK || 1)); // (Awakened players hit harder)
    return h;
}
function bkSupport(P, nx, ny) { // the corners of P that reach furthest along -n, i.e. the lowest along n
    let lo = Infinity;
    for (const q of P)
        lo = Math.min(lo, q[0] * nx + q[1] * ny);
    return P.filter(q => q[0] * nx + q[1] * ny <= lo + 1.5);
}
function bkPair(a, b) { // two blocks
    const h = bkSat(bkPts(b), bkPts(a), 0); // pointing from a toward b
    if (!h)
        return;
    a.x -= h.nx * h.pen / 2;
    a.y -= h.ny * h.pen / 2;
    b.x += h.nx * h.pen / 2;
    b.y += h.ny * h.pen / 2;
    const pts = bkSupport(bkPts(a), -h.nx, -h.ny).concat(bkSupport(bkPts(b), h.nx, h.ny)); // the corners of each that reach into the other
    let v = 0;
    for (const q of pts)
        v = Math.max(v, bkImpulse(a, b, 1 / BUILDER_M, h.nx, h.ny, q[0], q[1], BUILDER_E_BODY, BUILDER_MU));
    a.hitV = Math.max(a.hitV, v);
    b.hitV = Math.max(b.hitV, v);
}
// Called from Player.stepCollide (physics/player-collide.js): every block is solid for p. Returns true if p is standing on one.
function blocksVsPlayer(p) {
    let standing = false;
    for (const k of projectiles)
        if (k.type === 'block' && !k.broken) {
            const h = bkVsCircle(k, p, PLAYER_M, BUILDER_E_PLAYER, 0);
            if (h && h.ny < -0.5)
                standing = true;
        }
    return standing;
}

PROJ_TYPES.block = {
    r: BUILDER_SIZE, life: BUILDER_LIFE, g: BUILDER_G, // (r here is only the default: every block carries its own bounding radius)
    steer(b) {
        if (b.broken || b.life < 2 * DT || b.x < -OUT_D || b.x > W + OUT_D || b.y > H + PIT) { // broken, timed out or fell out of the world
            builderRelease(b);
            return 'remove';
        }
        b.age += DT;
        // the death ball's air physics: light drag, a speed cap, spin that fades, and spin that carries
        const d = 1 - BUILDER_DRAG * DT, s = Math.hypot(b.vx, b.vy), cap = s > BALL_VMAX ? BALL_VMAX / s : 1;
        b.vx *= d * cap;
        b.vy *= d * cap;
        b.w = Math.max(-BALL_W_MAX, Math.min(BALL_W_MAX, b.w * (1 - BALL_SPIN_DRAG * DT)));
        b.th += b.w * DT;
    },
    sub(b) { // after every sub-step move: out of the terrain, then out of the bodies
        let grounded = false, flat = 0;
        for (const [sg, t] of bkSolids(b)) {
            const h = bkSat(bkPts(b), [[sg[0], sg[1]], [sg[2], sg[3]]], t);
            if (!h)
                continue;
            b.x += h.nx * h.pen;
            b.y += h.ny * h.pen;
            let v = 0;
            const sup = bkSupport(bkPts(b), h.nx, h.ny); // every corner touching (two for a flat face): the block tips about them
            for (const q of sup)
                v = Math.max(v, bkImpulse(b, null, 0, -h.nx, -h.ny, q[0], q[1], BUILDER_E, BUILDER_MU));
            if (h.ny < -0.5)
                flat = Math.max(flat, sup.length);
            b.hitV = Math.max(b.hitV, v * BUILDER_TERRAIN_K);
            if (h.ny < -0.5)
                grounded = true;
        }
        if (grounded)
            b.rest = Math.max(b.rest, flat); // 2+ = lying on a flat face
        for (const o of [ball, ...decoys])
            if (!o.dead)
                bkVsCircle(b, o, BALL_M, BUILDER_E_BODY, BUILDER_MU);
        for (const k of projectiles)
            if (k.type === 'block' && k !== b && !k.broken)
                bkPair(b, k);
    },
    after(b) { // once per tick: settle when at rest, then break if something hit hard enough (players hit it earlier this tick, in stepCollide)
        if (b.rest) {
            if (b.rest >= 2 && Math.hypot(b.vx, b.vy) < 8 && Math.abs(b.w) < 0.25) { b.vx = 0; b.vy = 0; b.w = 0; } // lying still: stop the tiny jitter
            b.rest = 0;
        }
        if (b.age > BUILDER_GRACE && b.hitV > BUILDER_BREAK_V)
            breakBlock(b);
        b.stress = Math.max((b.stress || 0) * 0.92, Math.min(1, b.hitV / BUILDER_BREAK_V)); // display only: how close it came
        b.hitV = 0;
    },
};
