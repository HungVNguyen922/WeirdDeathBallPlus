// PHYSICS - Player instant specials: Awakened (setAwake), Explode (explode / explodeRefund) and Warp (warpPress). Never draws.
// Adds methods to Player (see mixin() in player.js); load after player.js.
mixin(Player, {
    // Awakened on / off. Powering up lifts a grapple lockout that is running (the meter restarts from 0, as when a lockout ends). Wearing off starts the cooldown;
    // being swapped away from (cooling = false) does not.
    setAwake(on, cooling = true) {
        if (on) {
            this.awakeT = AWAKENED_T;
            if (this.gCool > 0) {
                this.gCool = 0;
                this.gCharge = 0;
            }
        } else {
            this.awakeT = 0;
            if (cooling)
                this.cd.awakened = AWAKENED_COOLDOWN;
        }
    },
    // Explode key press (instant): every other living player, and the death ball and every decoy, whose edge is within EXPLODE_R of our centre gets an ADDITIVE kick. The kick is stronger
    // the closer the body is (EXPLODE_KICK_MIN at the edge .. EXPLODE_KICK_MAX in the middle), and it follows the body's own motion where it has some (so it amplifies a swing / a shot) and
    // goes straight away from us where it has none. Starts the cooldown and the EXPLODE_WINDOW in which a death refunds it (checked in update(), rules.js). The AI's planning copies only
    // do their own bookkeeping, they never touch the real game.
    explode() {
        const hits = []; // every body the blast pushes: where it was, which way it was sent and how hard (0..1), so the drawing can flash and streak exactly those
        this.explodeFx = { t: EXPLODE_FX, x: this.x, y: this.y, hits };
        this.cd.explode = EXPLODE_COOLDOWN;
        this.exploT = EXPLODE_WINDOW;
        this.exploDead = players.filter(q => !q.alive).length;
        if (this.sim)
            return;
        const blast = q => { // push one body (player, ball, decoy or arrow) if it is touching the blast radius
            const isArrow = q.stuck !== undefined, qr = q.r === undefined ? ARROW_R : q.r;
            if (isArrow && q.immune > 0)
                return;
            const dx = q.x - this.x, dy = q.y - this.y, d = Math.hypot(dx, dy), reach = EXPLODE_R + qr;
            if (d > reach)
                return;
            const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1; // (exactly on top of us: straight up)
            const power = Math.pow(1 - Math.min(1, d / reach), EXPLODE_FALLOFF); // 1 on top of us, 0 at the edge
            let kick = EXPLODE_KICK_MIN + (EXPLODE_KICK_MAX - EXPLODE_KICK_MIN) * power;
            // Amplify: the part of its motion that is not heading into us (a body flying at us keeps only its sideways motion)
            const into = Math.min(0, q.vx * nx + q.vy * ny), mx = q.vx - into * nx, my = q.vy - into * ny, ms = Math.hypot(mx, my);
            let ux = nx, uy = ny;
            if (ms > 1e-6) {
                const w = Math.min(1, ms / EXPLODE_AMP_SPEED) * EXPLODE_AMP_BLEND; // a body that is barely moving is pushed radially; a fast one along its motion
                ux = nx * (1 - w) + (mx / ms) * w;
                uy = ny * (1 - w) + (my / ms) * w;
                const m = Math.hypot(ux, uy) || 1;
                ux /= m;
                uy /= m;
                kick += ms * EXPLODE_AMP_GAIN; // extra speed on top of what it already has
            }
            hits.push({ x: q.x, y: q.y, r: qr, ux, uy, k: Math.min(1, kick / EXPLODE_KICK_MAX) });
            if (isArrow)
                arrowKnock(q, q.vx + ux * kick, q.vy + uy * kick);
            else {
                q.vx += ux * kick;
                q.vy += uy * kick;
            }
            if (q.boost !== undefined) { // a ball already flying fast: lift its speed cap for a moment (like a crash shot or a hatchet hit) so the push is not clipped
                const s = Math.hypot(q.vx, q.vy);
                if (s > BALL_VMAX)
                    q.boost = Math.max(q.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
            }
        };
        for (const q of players)
            if (q !== this && q.alive)
                blast(q);
        blast(ball);
        for (const d of decoys)
            if (!d.dead)
                blast(d);
        for (const a of projOf('arrow'))
            blast(a);
        for (const k of projOf('block'))
            blast(k); // the Builder's blocks are shoved like the death ball
    },
    // A death happened within the window: the cooldown is refunded (and, if EXPLODE_CARRY, kept through the round reset that a kill ending the round is followed by).
    explodeRefund() {
        this.cd.explode = 0;
        this.exploT = 0;
        if (EXPLODE_CARRY)
            this.exploCarry = true;
    },
    // Warp key press. No marker yet: drop one here. A marker and the cooldown is over: jump to it. A marker and the cooldown still running: move the marker to where you stand (free, as often as you like). Position only: vx / vy are untouched, so all momentum carries over.
    // The grapple is kept: the rope stays on its pivot (or ball) and the normal tether rules take over from the new spot. netSide is refreshed so the net guard in step() does not drag us back across the net.
    warpPress() {
        if (!this.warp) {
            this.warp = { x: this.x, y: this.y };
            return;
        }
        if (this.cd.warp > 0) { // the teleport is on cooldown, but the spot can be recast freely
            this.warp = { x: this.x, y: this.y };
            return;
        }
        this.warpFx = { t: WARP_FX, ax: this.x, ay: this.y, bx: this.warp.x, by: this.warp.y };
        this.x = this.warp.x;
        this.y = this.warp.y;
        this.warp = null;
        this.cd.warp = WARP_COOLDOWN;
        this.netSide = this.x < NETX ? 0 : 1;
    },
});



