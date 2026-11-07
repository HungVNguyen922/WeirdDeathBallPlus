// PHYSICS - reel: the REEL special. Never draws (the cast ring is in render/casts.js). Adds methods to Player (see mixin() in player.js); load after player-hopper.js.
// Tuning numbers live in constants.js (REEL_*).
//
// HOW IT PLAYS: REEL turns the grapple into a grappling hook. It only works while a rope is out (rope, not a hook still in flight).
//   Press the special key (no weight):   PAY OUT. The rope gets up to REEL_OUT_LEN longer over a fraction of a second and the grappled ball / decoy / block is shoved outward along it,
//                                        so your grapple range grows. On a platform / wall the thing you are hooked to cannot move, so YOU are pushed away from it instead.
//                                        This is what costs the cooldown (REEL_COOLDOWN), and it starts at once.
//   Hold WEIGHT while the special key is held:  REEL IN. The rope shortens and the grappled thing is pulled toward you (on a platform you are pulled toward it).
//                                        It has NO cooldown and can be started or stopped whenever the key is down, even while the pay-out is still going or its cooldown is running:
//                                        pay out, then without letting go press weight and pull. Pressing weight mid-pay-out cuts the rest of the pay-out short and starts the pull.
//   Letting go of the special key, or the grapple ending, ends the cast. Pressing with no rope out does nothing.
//
// SMOOTH PAY-OUT (the old version added all the length and a big radial kick in ONE tick, then the leash slammed the ball to a stop at the new length, which threw away the
// ball's swing). Now the rope pays out at a speed (REEL_OUT_RATE, easing off at the end) and the ball is topped up to move outward at that same speed, so the leash only ever has to
// cancel a tiny sliver per tick. Whatever outward speed the ball still has when the rope stops is then ROTATED into sideways speed around you (REEL_SWIRL for REEL_SWIRL_T s), keeping the
// ball's speed, so a looping ball leaves the pay-out spinning wider but not slower.
//
// The cast (type 'reel') is plain data { rem: length still to pay out, tail: seconds of swirl left, mode: what to draw }, so it saves / loads / rolls back like every other cast.
mixin(Player, {
    // The line the pay-out works along. Ball tethered: the ball moves, relative to you, along you -> ball. Anything else: you move, relative to the hook, along hook -> you.
    reelAxis() {
        const a = this.rope, tb = this.onBall ? this.tball : null;
        if (tb) {
            const dx = tb.x - this.x, dy = tb.y - this.y, m = Math.hypot(dx, dy) || 1;
            return { body: tb, ux: dx / m, uy: dy / m, rvx: this.vx, rvy: this.vy, ball: true };
        }
        const dx = this.x - a.x, dy = this.y - a.y, m = Math.hypot(dx, dy) || 1;
        return { body: this, ux: dx / m, uy: dy / m, rvx: 0, rvy: 0, ball: false };
    },
    // A press of the special key with a rope out: the cast, or null if there is nothing to do. weightHeld: pressing with weight is a pull-only press (no pay-out, no cooldown).
    reelStart(weightHeld) {
        if (this.sim || !this.rope)
            return null; // (the AI's planning copies do not model it: they must not push the real ball)
        const c = { type: 'reel', t: 1, t0: 1, rem: 0, tail: 0, mode: 0 }; // mode (display only, see render/reel.js): 0 = idle, 1 = paying out, 2 = reeling in
        if (!weightHeld && this.cd.reel <= 0) {
            const a = this.rope, d = Math.hypot(a.x - this.x, a.y - this.y), cap = playerReach(this) * REEL_LEN_CAP;
            this.len = Math.max(this.len, Math.min(d, cap)); // take up any stretch first, so the pay-out starts from the real length
            const rem = Math.max(0, Math.min(REEL_OUT_LEN, cap - this.len));
            if (rem > 1) { // (already at the cap: nothing to pay out, so it costs nothing)
                c.rem = rem;
                c.tail = REEL_SWIRL_T;
                this.cd.reel = REEL_COOLDOWN;
                if (!this.onBall)
                    this.taut = false; // the floor-tether float must not treat the longer rope as "sunk below the float point"
                const ax = this.reelAxis();
                if (ax.body === ball)
                    ball.pull = { t: MARIONETTE_FX, ux: ax.ux, uy: ax.uy, col: this.color };
            }
        }
        return c;
    },
    // One tick of a running reel cast (called from stepCast): ends it when the key or the rope is gone, otherwise pulls (weight held) or pays out.
    reelStep(c, k) {
        if (!k[c.key] || !this.rope) {
            c.t = 0;
            return;
        }
        if (k.x) { // weight: reel in. It takes over from the pay-out.
            c.rem = 0;
            c.tail = 0;
            this.reelPull();
        } else if (c.rem > 0 || c.tail > 0)
            this.reelPay(c);
        c.mode = k.x ? 2 : c.rem > 0 ? 1 : 0;
    },
    // Pay-out, one tick.
    reelPay(c) {
        let rate = 0; // how fast the rope is paying out right now (u/s)
        if (c.rem > 0) {
            rate = Math.min(REEL_OUT_RATE, REEL_OUT_MIN + c.rem * REEL_OUT_EASE); // full speed, easing off as the last of it runs out
            const ext = Math.min(c.rem, rate * DT);
            this.len += ext;
            c.rem = c.rem - ext < 0.5 ? 0 : c.rem - ext;
        } else
            c.tail -= DT;
        const ax = this.reelAxis(), b = ax.body, ux = ax.ux, uy = ax.uy, tx = -uy, ty = ux;
        const want = ax.ball ? rate : rate * REEL_PUSH_K; // target outward speed of the thing that moves
        const rvx = b.vx - ax.rvx, rvy = b.vy - ax.rvy, vr = rvx * ux + rvy * uy, vt = rvx * tx + rvy * ty;
        if (vr < want) { // top it up toward the pay-out speed (never slows something already moving out faster)
            const add = Math.min(REEL_OUT_ACC * DT, want - vr);
            b.vx += ux * add;
            b.vy += uy * add;
            const s = Math.hypot(b.vx, b.vy);
            if (s > BALL_VMAX && b.boost !== undefined) // a big shot lifts the ball's speed cap for a moment, like a hatchet hit
                b.boost = Math.max(b.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
        } else if (vr > want && Math.abs(vt) > REEL_SWIRL_MIN_V) { // moving out faster than the rope pays out: turn the excess into sideways speed instead of letting the leash eat it
            const excess = vr - want, dr = excess * Math.min(1, REEL_SWIRL * DT), vr2 = vr - dr;
            const vt2 = Math.sign(vt) * Math.sqrt(vt * vt + vr * vr - vr2 * vr2); // same speed, rotated toward the tangent (the way it was already circling)
            b.vx += ux * (vr2 - vr) + tx * (vt2 - vt);
            b.vy += uy * (vr2 - vr) + ty * (vt2 - vt);
        }
    },
    // Reel in: one tick of it.
    reelPull() {
        const a = this.rope;
        if (!a)
            return;
        const dx = a.x - this.x, dy = a.y - this.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
        const tb = this.onBall ? this.tball : null;
        this.len = Math.max(tb ? 41 : MIN_LEN, Math.min(this.len, d) - REEL_IN_RATE * DT); // starts from the real distance, so slack rope is taken up at once (41 = the ball rope's minimum, see candidates())
        if (tb) { // the ball comes toward me
            const toward = tb.vx * -nx + tb.vy * -ny, add = Math.min(REEL_BALL_ACC * DT, Math.max(0, REEL_BALL_V - toward));
            tb.vx -= nx * add;
            tb.vy -= ny * add;
        } else { // I go toward the platform
            const toward = this.vx * nx + this.vy * ny, add = Math.min(REEL_PLAYER_ACC * DT, Math.max(0, REEL_PLAYER_V - toward));
            this.vx += nx * add;
            this.vy += ny * add;
        }
    },
});
