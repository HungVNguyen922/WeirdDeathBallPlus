// PHYSICS - block interactions: how the BUILDER's blocks react to Explode, Bat, Arrow, Plinko, Boomerang, Swap and Accelerator. Never draws.
// Load order: after builder.js (it uses bkCircle / blockNearest from there) and before game/rules.js. Everything here is only called at run time, from the hooks listed in PATCHES-BLOCKS.md.
// Tuning numbers are the ones those specials already use (ARROW_BALL_K, PAD_E, BOOMERANG_M_*, ...): a block weighs as much as the death ball, so it is pushed like the death ball.
//
//   EXPLODE    the blast shoves every block in range like it shoves the ball (edit in player-specials.js: one extra loop).
//   BAT        a swing launches any block it passes over, like the ball, and spins it by where the bat caught it (edit in bat.js).
//   ARROW      a live arrow that reaches a block gives it a share of its velocity (ARROW_BALL_K, like the ball) at the point it hit, and is used up. A spent arrow just rests on / bounces
//              off the block instead of sinking into it. Arrows never break a block by themselves (edit in arrows.js).
//   PLINKO     pegs bounce a block exactly like the hatchet / ball bounce (PAD_E, PAD_KICK, PAD_MAX), at the contact point, so a block that clips a peg tumbles (edit in builder.js, sub()).
//   BOOMERANG  going out it nudges a block (BOOMERANG_M_OUT), coming home it shoves it toward its owner (BOOMERANG_M_BACK). The boomerang keeps its own course (edit in boomerangs.js).
//   SWAP       a block is swappable: you trade places with it, it keeps its velocity, and it is shielded from breaking for a moment while it settles (edits in builder.js / swap.js).
//   ACCELERATOR the lines speed up blocks you built or last grappled (edit in accelerator.js).

// Give block k a spin from a push that changed its velocity by (dvx, dvy) at the world point (px, py): torque / inertia, i.e. cross(r, dv) / k2 (k2 = inertia per unit mass).
function bkSpin(k, px, py, dvx, dvy) {
    k.w += ((px - k.x) * dvy - (py - k.y) * dvx) / (k.k2 || 1);
    k.w = Math.max(-BALL_W_MAX, Math.min(BALL_W_MAX, k.w));
}
// Push block k by a change of velocity (dvx, dvy) applied at (px, py): moves it and spins it.
function bkPoke(k, px, py, dvx, dvy) {
    k.vx += dvx;
    k.vy += dvy;
    bkSpin(k, px, py, dvx, dvy);
}

// ---- ARROW ----
// Called from the arrow's sub-step. Returns true if a LIVE arrow reached a block (it is used up, exactly like reaching the ball). A spent arrow is only pushed out and bounced.
function arrowVsBlocks(a) {
    for (const k of projOf('block')) {
        if (k.broken)
            continue;
        const h = bkCircle(k, a.x, a.y, a.r); // (nx, ny) points from the block to the arrow
        if (!h)
            continue;
        const px = a.x - h.nx * (a.r - h.pen), py = a.y - h.ny * (a.r - h.pen); // where they touch
        a.x += h.nx * h.pen; // out of the block
        a.y += h.ny * h.pen;
        if (!a.spent) {
            bkPoke(k, px, py, a.vx * ARROW_BALL_K, a.vy * ARROW_BALL_K); // the block takes a share of the arrow's velocity, like the death ball does
            return true;
        }
        const vn = a.vx * h.nx + a.vy * h.ny; // a spent arrow: a small bounce
        if (vn < 0) {
            a.vx -= (1 + ARROW_BUMP_E) * vn * h.nx;
            a.vy -= (1 + ARROW_BUMP_E) * vn * h.ny;
        }
    }
    return false;
}

// ---- PLINKO ----
// A peg is fixed, so only the block moves. The same bounce as pegBounce (collision.js): launched off the peg along the contact normal with PAD_E x its closing speed, at least PAD_KICK, at most PAD_MAX.
function blockPegBounce(k, q) {
    const h = bkCircle(k, q.x, q.y, q.r); // points from the block to the peg
    if (!h)
        return false;
    const nx = -h.nx, ny = -h.ny, px = q.x + nx * (q.r - h.pen), py = q.y + ny * (q.r - h.pen); // peg -> block, and the touching point
    k.x += nx * h.pen; // out of the peg
    k.y += ny * h.pen;
    const vn = k.vx * nx + k.vy * ny; // < 0 = moving into the peg
    if (vn >= 0)
        return false;
    const out = Math.min(PAD_MAX, Math.max(PAD_KICK, -vn * PAD_E)), dv = out - vn;
    bkPoke(k, px, py, nx * dv, ny * dv);
    q.flash = 1; // the peg's hit effect (the renderer reads these)
    q.nx = nx;
    q.ny = ny;
    q.hits = (q.hits | 0) + 1;
    return true;
}

// ---- BOOMERANG ----
// One boomerang b against one block k. The boomerang is pushed clear but carries straight on (like boomHit); the block gets the collision impulse of a boomerang of mass BOOMERANG_M_OUT going
// out (a nudge) or BOOMERANG_M_BACK coming home (a shove), at the touching point, so it also turns.
function boomVsBlock(b, k) {
    if (k.broken)
        return;
    const h = bkCircle(k, b.x, b.y, b.r); // points from the block to the boomerang
    if (!h)
        return;
    const out = b.phase === 0, mb = out ? BOOMERANG_M_OUT : BOOMERANG_M_BACK, e = out ? BOOMERANG_E_OUT : BOOMERANG_E_BACK;
    const px = b.x - h.nx * (b.r - h.pen), py = b.y - h.ny * (b.r - h.pen);
    b.x += h.nx * h.pen;
    b.y += h.ny * h.pen;
    const vn = (b.vx - k.vx) * h.nx + (b.vy - k.vy) * h.ny;
    if (vn >= 0)
        return;
    const j = -(1 + e) * vn / (1 / mb + 1 / BUILDER_M); // impulse, along the normal
    bkPoke(k, px, py, -h.nx * j / BUILDER_M, -h.ny * j / BUILDER_M);
}
function boomBlocks(b) {
    for (const k of projOf('block'))
        boomVsBlock(b, k);
}
