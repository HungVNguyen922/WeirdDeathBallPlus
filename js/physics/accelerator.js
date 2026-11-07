// PHYSICS - accelerator: the ACCELERATOR special. Never draws (see render/accelerator.js). Built on physics/statics.js; tuning numbers live in constants.js (ACCELERATOR_*).
// Load order: after statics.js and player.js, before game/rules.js.
//
// HOW IT PLAYS: press the special key to drop a node where you stand. Every node is joined by a line to each OLDER node of yours, so n nodes make n(n-1)/2 lines. At ACCELERATOR_MAX nodes the
// next press replaces your oldest. Nodes stay until the round ends (ACCELERATOR_LIFE = 0).
// WHO IS SPED UP: when something crosses one of YOUR lines it gains ACCELERATOR_BOOST of its velocity, once per crossing, if it is
//   - you (and, with ACCELERATOR_BOOST_TEAMMATES, your teammates), or
//   - the death ball or a decoy that you were the LAST to grapple (ball.lastGrab, set in Player.attach and kept after you let go, until somebody else grapples it or the round resets).
// Enemies, other people's balls and projectiles are not touched. Boosts stack per crossing; the ball's own speed cap (BALL_VMAX) still applies.
//
// CROSSING: no extra state is kept. Where a body was a tick ago is rebuilt from its velocity (x - vx * DT), and a body crosses a line when that short move cuts it. That is exact for
// free flight and close enough around bounces; a teleport (warp, portal, swap) moves the body without a matching velocity, so it is never counted as a crossing.
// A line is handled by its NEWER end, so each line is checked once per body per tick.
function placeAcceleratorNode(p) {
    return placeStatic('accelerator', p, p.x, p.y);
}
function acceleratorBoosts(b, s) { // does a line of s's owner speed b up?
    return b === s.owner || b.lastGrab === s.owner.id || (b.type === 'block' && b.owner === s.owner) || (ACCELERATOR_BOOST_TEAMMATES && b instanceof Player && b.team === s.team);
}
function acceleratorBoost(b) {
    const k = 1 + ACCELERATOR_BOOST;
    b.vx *= k;
    b.vy *= k;
}
STATIC_TYPES.accelerator = {
    max: ACCELERATOR_MAX, life: ACCELERATOR_LIFE, fx: 0.3,
    step(s, bodies) { // s = one node; its lines run to every older node of the same owner
        if (!s.owner)
            return;
        const mine = bodies.filter(b => acceleratorBoosts(b, s));
        if (!mine.length)
            return;
        for (const o of statics) {
            if (o.type !== 'accelerator' || o.owner !== s.owner || o.id >= s.id)
                continue;
            for (const b of mine)
                if (segCross(b.x - b.vx * DT, b.y - b.vy * DT, b.x, b.y, o.x, o.y, s.x, s.y)) {
                    acceleratorBoost(b);
                    s.flash = o.flash = 1; // the line lights up (display only)
                }
        }
    },
};
