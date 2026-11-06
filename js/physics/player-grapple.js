// PHYSICS - Player grapple: the overcharge lockout, what the hook can reach, attaching / landing, and the per-tick rope, tether and weight-kick physics (stepGrapple).
// Adds methods to Player (see mixin() in player.js); load after player.js.
// Ball over-extension: when something suddenly leaves the ball tether wildly overstretched (Warp, and any future teleport / launch / swap) the leash itself copes, so no
// ability needs to know about the ball, and normal play is exactly as it was. Past BALL_SNAP_ABS u (and BALL_SNAP_REL x the tether length) of stretch the leash enters a
// snap (think of flying a kite: the ball's own momentum is the wind and keeps carrying it along its arc, the tether only tugs and bends that path): the stiff spring and the rigid speed-cancelling constraint are swapped for a plain Hooke pull, so the ball's ACCELERATION toward you is BALL_SNAP_K x the distance
// still to close (it dies away smoothly to nothing as the ball reaches the tether length, so nothing slams, brakes or cuts the ball off). The pull goes to the ball's CENTRE (the
// hook point whirls round the ball's edge with its spin, which made a stiff pull jitter), is limited smoothly so the ball is never dragged faster than BALL_SNAP_VMAX, and only
// the ball moving AWAY from you is damped. It is a central pull with no sideways steering, so the ball's own sideways motion (its angular
// momentum about you) decides its path: it sweeps around you. The snap ends the moment the ball is back inside the tether length, or fades back into the normal leash after
// BALL_SNAP_T s. The ball and you share the pull the way your BALL_TM / BALL_PULL tuning already says.
const BALL_SNAP_ABS = 100;       // u: stretched past the tether length by more than this (and more than BALL_SNAP_REL x the tether length) starts a snap
const BALL_SNAP_REL = 1.0;       // x tether length
const BALL_SNAP_K = 750;         // 1/s^2: ball acceleration toward you = this x the stretch. THE kite-string knob: low = the ball mostly keeps its own arc and is only bent by the tug; high = the tug takes over.
                                 //   Note the tug is capped by BALL_SNAP_VMAX, so past about 120-200 a higher K mostly just makes the first moment more of a lurch (one hard tick) instead of snappier
const BALL_SNAP_VMAX = 800;      // u/s: the tug never drags the ball faster than this toward you on its own (a smooth limit: the pull just tops the ball up to this speed, no on/off flicker). A ball already
                                 //   moving faster just coasts. Too low = the ball floats out there while overextended; too high = it arrives hard. BALL_VMAX (the ball's own speed cap) still caps everything
const BALL_SNAP_DAMP = 3;        // 1/s: pulls back a ball moving AWAY from you (the way back in is never slowed). Higher = overshoots die out faster
const BALL_SNAP_T = 2;           // s: a snap lasts at most this long
const BALL_SNAP_FADE = 0.5;      // s: over the last part of that the snap fades back into the normal leash instead of switching over with a jolt

mixin(Player, {
    // ---- Hyper / Xeric (constants.js has the numbers and the rules in one place) ----
    // Called for every player once per tick BEFORE anyone steps, so the order players are stepped in never matters.
    auraStep() {
        const k = this.keys, zEff = k.z && this.gCool <= 0; // the grapple key only counts when the grapple can actually work
        const onFloorRope = (this.rope && this.ropeGround && !this.onBall) || (this.pending && this.pending.ground);
        const hyperOn = this.alive && k.x && zEff && (this.ground || onFloorRope) && !this.onBall; // weight + grapple, on the floor or hooked to it
        const xericOn = this.alive && this.ground && k.x && !zEff;                                   // weight on the floor, grapple not held
        this.hyperT = hyperOn ? HYPER_LINGER : Math.max(0, this.hyperT - DT);
        this.xericT = xericOn ? XERIC_LINGER : Math.max(0, this.xericT - DT);
        this.boostFx = Math.max(0, this.boostFx - DT);
        this.fizzleFx = Math.max(0, this.fizzleFx - DT);
    },
    // What the OTHER players' floor auras do to me right now: { hyper, xeric } (true = at least one other player has it up). The AI's planning copies see neither.
    floorFx() {
        const fx = { hyper: false, xeric: false };
        if (this.sim)
            return fx;
        const onFloor = this.ground || (this.rope && this.ropeGround && !this.onBall); // standing on the floor, or tethered to it
        for (const o of players)
            if (o !== this && o.alive && (FLOOR_FX_TEAMMATES || o.team !== this.team)) {
                if (o.hyperT > 0) fx.hyper = true;
                if (o.xericT > 0 && onFloor) fx.xeric = true; // xeric only reaches players who are on the floor, or hooked to it
            }
        return fx;
    },
    // Overcharge: the meter is emptied, the grapple is locked out for GRAPPLE_COOLDOWN and the grip is torn away (purple ripple). Happens when the meter runs out, or when a
    // player with their grapple active (rope out, or hook in flight) touches an enemy (see update() in rules.js).
    overcharge() {
        if (this.awakeT > 0)
            return; // Awakened: never overcharged, whatever the cause
        this.gCharge = 0;
        this.gCool = GRAPPLE_COOLDOWN;
        this.gBurst = GRAPPLE_BURST_T;
        this.kickReq = false;
        this.driveT = 0;
        this.rope = null;
        this.pending = null;
        this.onBall = false;
        this.tball = null;
        this.stretchT = 0;
    },
    // Letting go of the ball: the whip's sideways speed around you becomes spin (so WHEN you release matters).
    flickBall() {
        const tb = this.tball, a = this.rope;
        if (!this.onBall || !tb || !a)
            return;
        const dx = a.x - this.x, dy = a.y - this.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
        const vt = (tb.vx - this.vx) * -ny + (tb.vy - this.vy) * nx; // ball's speed around you (u/s); + = clockwise on screen, same sign as ball.w
        const over = Math.abs(vt) - BALL_FLICK_MIN;
        if (over <= 0)
            return;
        const pong = pongOn();
        const dw = Math.min(BALL_FLICK_MAX * (pong ? PONG_FLICK_MAX_MULT : 1), over / tb.r * BALL_FLICK * (pong ? PONG_FLICK_MULT : 1)) * Math.sign(vt);
        tb.w = Math.max(-BALL_W_MAX, Math.min(BALL_W_MAX, tb.w + dw));
    },
    // Everything grappleable within RANGE: surfaces (ground = floor/slopes) and the ball.
    candidates(ball) {
        const c = [];
        const add = (p, ground) => {
            const d = Math.hypot(p.x - this.x, p.y - this.y);
            c.push({ p, d, len: Math.max(d, MIN_LEN), b: false, ground });
        };
        const o = sawY(this.x); // the floor can be raised by a quake: look it up in the floor's own frame, then lift the result
        add({ x: this.x, y: H + o }, true);
        for (const p of [{ x: this.x, y: 0 }, { x: 0, y: this.y }, { x: W, y: this.y }])
            add(p, false);
        add(nearestOnSeg(NETSEGS[0], this.x, this.y), false); // the net only exists below its gap
        for (const sg of SEGS) {
            const q = nearestOnSeg(sg, this.x, this.y - o);
            add({ x: q.x, y: q.y + sawY(q.x) }, true);
        }
        for (const sg of LEDGES)
            add(nearestOnSeg(sg, this.x, this.y), false);
        for (const b of this.sim ? [ball] : [ball, ...decoys]) { // the death ball and any decoys (the AI's planning copies only know the death ball)
            const ang = Math.atan2(this.y - b.y, this.x - b.x); // grapple point on the ball's edge, facing us
            const hp = { x: b.x + Math.cos(ang) * b.r, y: b.y + Math.sin(ang) * b.r };
            const hd = Math.hypot(hp.x - this.x, hp.y - this.y);
            c.push({ p: hp, d: hd, len: Math.max(hd, 41), b: true, ground: false, ball: b, decoy: b !== ball });
        }
        if (!this.sim)
            for (const b of projectiles)
                if (b.type === 'block' && !b.broken) {
                    const hp = blockNearest(b, this.x, this.y), hd = Math.hypot(hp.x - this.x, hp.y - this.y);
                    c.push({ p: hp, d: hd, len: Math.max(hd, 41), b: true, ground: false, ball: b, decoy: true, block: true });
                }
        return c.filter(o => o.d <= playerReach(this));
    },
    inReach(ball) { return this.candidates(ball).length > 0; },
    // Tether to the nearest thing in reach (no priorities). Rope length = distance at press.
    attach(ball) {
        const best = this.candidates(ball).reduce((m, o) => (!m || o.d < m.d ? o : m), null);
        if (!best)
            return;
        if (best.b) { // ball: instant; the pivot sits on the ball's edge and spins with it
            this.rope = best.p;
            this.len = best.len;
            this.onBall = true;
            this.tball = best.ball;
            best.ball.lastGrab = this.id; // who grappled it last (the ACCELERATOR special boosts the ball for that player, see physics/accelerator.js)
            this.ropeGround = false;
            this.ropeBase = null;
            this.hookAng = Math.atan2(best.p.y - best.ball.y, best.p.x - best.ball.x) - best.ball.th;
            this.hookR = best.block ? Math.hypot(best.p.x - best.ball.x, best.p.y - best.ball.y) : 0; // 0 = on the ball's edge (tb.r)
            return;
        }
        const delay = this.grounded ? GROUND_DELAY : HOOK_DELAY; // the hook takes a moment to land
        if (delay > 0) {
            this.pending = { p: best.p, t: delay, t0: delay, ground: best.ground };
            return;
        }
        this.land(best.p, best.ground);
    },
    // The hook lands on a surface: tether length = distance right now. A grapple jump (rising on floor/slopes) kicks the player
    // directly away from the pivot (weight multiplies it), with matching tether slack; a pivot behind you gives a diagonal hop.
    land(p, ground) {
        const dx = this.x - p.x, dy = this.y - p.y, d = Math.hypot(dx, dy);
        this.rope = p;
        this.onBall = false;
        this.ropeGround = ground;
        this.ropeBase = ground ? { x: p.x, y: p.y - sawY(p.x) } : null; // floor pivots ride the floor when it pops
        this.len = Math.max(d, MIN_LEN);
        this.taut = false;
        this.driveT = 0;
        if (ground && this.vy <= 0) {
            const chain = Math.min(GJ_MAX, GJ_START * Math.pow(GJ_GROWTH, this.gjN)); // exponential ramp over a spammed chain
            const lift = LIFT_V * chain * (this.keys.x ? WEIGHT_M : 1);
            this.gjN++;
            this.gjT = 0;
            if (this.keys.x && !this.onBall)
                this.hyperT = HYPER_LINGER; // a weighted grapple jump off the floor is a hyper in passing: it lasts past the moment you leave the floor
            // The rope's length becomes the reach: one more GJ_REACH_GROUND out than we are now (on a platform that is a player length off it), never past RANGE.
            // Latching high above the pivot (already airborne) is weaker than a jump off the platform: full strength within GJ_NEAR u of the pivot, fading to GJ_AIR_SCALE by GJ_FAR u.
            const air = 1 - (1 - GJ_AIR_SCALE) * Math.max(0, Math.min(1, (d - GJ_NEAR) / (GJ_FAR - GJ_NEAR)));
            const fxL = this.floorFx();
            if (fxL.hyper) this.boostFx = BOOST_FX;                      // (display: this jump is being boosted)
            if (fxL.xeric && this.keys.x) this.fizzleFx = FIZZLE_FX;     // (display: this weighted jump is being cut)
            this.len = Math.min(playerReach(this), Math.max(d, MIN_LEN) + GJ_REACH_GROUND * air * (this.keys.x ? GJ_REACH_WEIGHTED : 1) * (fxL.hyper ? HYPER_REACH : 1));
            this.driveT = GJ_DRIVE_T;
            this.driveVmax = lift * GJ_DRIVE_BOOST * air * (this.keys.x && fxL.xeric ? XERIC_JUMP : 1); // top speed away from the pivot this jump can reach (a xeric under a weighted jump makes it a misfire)
            this.driveAcc = this.driveVmax / GJ_DRIVE_T; // delivered by step() as a pull away from the pivot, not as one kick
            this.taut = false;
        }
    },
    // One tick of the grapple: weight priming, the meter, the hook in flight, the rope / ball tether, the grapple-jump drive and the weight kick. dir = -1 / 0 / 1 steering.
    stepGrapple(ball, dir) {
        const k = this.keys, heavy = k.x;
        // Weight primes the kick: while it is held (and for PRIME_T s after it is released) any grapple that lands applies the kick at once,
        // and the kick is re-armed whenever there is no rope, so a primed player can grapple, kick, let go and grapple again.
        if (k.x)
            this.primeT = PRIME_T;
        else
            this.primeT = Math.max(0, this.primeT - DT);
        const primed = k.x || this.primeT > 0;
        if ((k.x && !this.prevX) || (primed && !this.rope && !this.pending))
            this.kickReq = true; // remembered until the hook lands, so a delayed hook still gets its kick
        // Grapple meter: GRAPPLE_MAX seconds of use (rope out, or hook in flight). Spend it all and the grapple is locked out for GRAPPLE_COOLDOWN seconds,
        // then comes back full. Letting go at any point refills it over time instead.
        if (this.gCool > 0) {
            this.gCool = Math.max(0, this.gCool - DT);
            if (this.gCool === 0)
                this.gCharge = 0; // lockout over: the meter does NOT jump to full, it restarts from 0 (grapple again right away and it just overcharges again)
        }
        const z = k.z && this.gCool <= 0 && this.stunT <= 0;
        if (!z && !primed)
            this.kickReq = false; // a primed kick survives the grapple being up
        if (z && !this.rope && !this.pending)
            this.attach(ball); // also latches on when you drift into reach while holding
        if (this.pending && z) {
            this.pending.t -= DT;
            if (this.pending.t <= 0) {
                const h = this.pending;
                this.pending = null;
                this.land(h.p, h.ground);
            }
        }
        if (this.rope || this.pending) {
            if (this.awakeT <= 0) { // (Awakened: holding the grapple costs nothing)
                this.gCharge -= DT;
                if (this.gCharge <= 0) // spent: the grip is torn away
                    this.overcharge();
            }
        } else if (this.gCool <= 0)
            this.gCharge = Math.min(GRAPPLE_MAX, this.gCharge + GRAPPLE_REGEN * DT);
        if (!z) {
            this.flickBall(); // new: before the rope is dropped
            this.driveT = 0;
            this.rope = null;
            this.pending = null;
            this.onBall = false;
            this.tball = null;
            this.stretchT = 0;
        }
        // Tether = a leash: a maximum length, nothing more. Stretched past it = spring + damping (hard limit on surfaces); closer than it the rope is slack. The pivot
        // has no effect on you at all: no push, no steering, nothing solid, so you can swing right through it. The ball pivot sits on its edge and spins with it.
        const fx = this.floorFx(); // what other players' hyper / xeric do to me this tick
        const a = this.rope, tb = this.tball || ball; // tb = the ball we are tethered to: the death ball or one of the decoys
        if (a) {
            if (this.ropeBase && !this.onBall)
                a.y = this.ropeBase.y + sawY(a.x);
            if (this.onBall) {
                const ang = tb.th + this.hookAng;
                a.x = tb.x + Math.cos(ang) * (this.hookR || tb.r);
                a.y = tb.y + Math.sin(ang) * (this.hookR || tb.r);
            }
            const dx = a.x - this.x, dy = a.y - this.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
            const rx = a.x - tb.x, ry = a.y - tb.y; // hook offset from the ball's center
            const hvx = this.onBall ? tb.vx - tb.w * ry : 0, hvy = this.onBall ? tb.vy + tb.w * rx : 0;
            const closing = (this.vx - hvx) * nx + (this.vy - hvy) * ny;
            if (this.ropeGround && !this.onBall && Math.abs(this.x - a.x) > 12)
                this.pivotSide = Math.sign(this.x - a.x); // which side of the pivot you were last on
            if (this.driveT > 0 && !this.onBall && this.ropeGround) { // grapple-jump drive: the rope accelerates you away from the pivot, out to its reach
                this.driveT -= DT;
                const room = this.len - d; // how far is left to the reach
                if (room > 0) {
                    let ux = -nx * HOP_AIM, uy = -ny;
                    const m = Math.hypot(ux, uy) || 1;
                    ux /= m; uy /= m;
                    const ease = Math.min(1, room / GJ_EASE); // glide in: the pull fades over the last GJ_EASE u
                    const hb = fx.hyper ? HYPER_DRIVE : 1; // another player's hyper speeds the whole pull up (acceleration and top speed)
                    const out = this.vx * ux + this.vy * uy; // speed already heading away from the pivot: the drive never pushes past this jump's top speed, so a regrab on the way up cannot stack
                    if (out < this.driveVmax * hb) {
                        const add = Math.min(this.driveAcc * hb * ease * DT, this.driveVmax * hb - out);
                        this.vx += ux * add;
                        this.vy += uy * add;
                    }
                }
            }
            if (this.kickReq && !this.onBall) {
                // Below the float point (once the grapple jump's slack is used up) a press does nothing: no force is added,
                // so only your momentum and gravity carry you. The taut check keeps the weighted grapple-jump kick working.
                const below = this.ropeGround && this.taut && d < this.len - DRIB_BELOW_TOL;
                if (!below) {
                    if (fx.hyper) this.boostFx = BOOST_FX;   // (display only)
                    if (fx.xeric) this.fizzleFx = FIZZLE_FX;
                    const past = Math.max(0, d - this.len);
                    const room = Math.max(0, 1 - past / WEIGHT_KICK_REACH);
                    const want = WEIGHT_KICK * room * (this.ropeGround ? 1 : WALL_KICK_SCALE) * (fx.hyper ? HYPER_KICK : 1) * (fx.xeric ? XERIC_KICK : 1);

                    // Kick direction: away from the pivot, reshaped by the arrows. Only once the float is established (taut),
                    // so the weighted grapple-jump launch keeps its direction.
                    let ux = -nx, uy = -ny;
                    if (this.taut && this.ropeGround) {
                        const vert = k.up || k.dn, horiz = dir !== 0;
                        if (vert && !horiz)
                            uy *= KICK_STEEP;                  // up / down only: steeper
                        else if (horiz && !vert) {
                            uy *= KICK_FLAT;                   // left / right only: flatter, leaning the way you hold
                            ux += dir * KICK_STEER;
                        }
                        // both (diagonal) or neither: plain radial direction
                        const m = Math.hypot(ux, uy) || 1;
                        ux /= m;
                        uy /= m;
                    }
                    const out = this.vx * ux + this.vy * uy;
                    const add = Math.max(0, want - out);
                    this.vx += ux * add;
                    this.vy += uy * add;
                }
                this.kickReq = false;          // the press is used up either way
            }
            // Over-extension, measured to the ball's CENTRE: the hook is on the ball's edge and whirls round it with its spin (up to +-BALL_R u every tick), which would shake a stiff pull.
            const cdx = tb.x - this.x, cdy = tb.y - this.y, dc = Math.hypot(cdx, cdy) || 1;
            const xc = this.onBall ? dc - tb.r - this.len : 0; // how far past its length the tether is (the hook sits on the near edge, so the centre is len + radius away at rest)
            if (this.stretchT > 0)
                this.stretchT = (!this.onBall || xc <= 0) ? 0 : this.stretchT - DT;       // a snap is over once the ball is back inside the tether
            if (this.onBall && this.stretchT <= 0 && xc > Math.max(BALL_SNAP_ABS, this.len * BALL_SNAP_REL))
                this.stretchT = BALL_SNAP_T;                                               // wildly overstretched (teleport, launch...): start a snap
            const sf = this.onBall && this.stretchT > 0 ? Math.min(1, this.stretchT / BALL_SNAP_FADE) : 0; // 0 = the normal leash, 1 = the pure Hooke pull
            if (d > this.len) {
                const x = d - this.len; // the rope can deform past its length, but pulls back with a force that grows the further it goes
                if (this.onBall) {
                    // Rope = distance constraint on the ball: cancel only the speed that would stretch it (mass-weighted, so the
                    // light ball takes the correction). Tangential speed survives, so the ball keeps circling the player.
                    const c = rx * ny - ry * nx, im = 1 + 1 / BALL_TM + c * c / BALL_I;
                    if (closing < 0) {
                        const J = -closing * BALL_RIGID / im * (1 - sf);                // (switched off during a snap: nothing cancels the ball's swing)
                        this.vx += nx * J * BALL_PULL;
                        this.vy += ny * J * BALL_PULL;
                        tb.vx -= nx * J / BALL_TM;
                        tb.vy -= ny * J / BALL_TM;
                        tb.w -= J * c / BALL_I;
                    }
                }
                let f = Math.max(0, (this.onBall ? KB : KS) * (this.onBall || this.ropeGround ? 1 : WALL_KS_SCALE) * (heavy ? HEAVY_KS : 1) * x * (1 + x / STRETCH_X0)
                    - (this.onBall ? DB : DAMP) * Math.min(0, closing)
                    - (this.onBall ? 0 : RETURN_DAMP) * Math.max(0, closing));
                f *= 1 - sf;                         // (during a snap the normal leash steps aside; it only comes back as the snap fades out)
                const pf = this.onBall ? BALL_PULL : 1; // platform ropes stay as they were
                this.vx += nx * f * DT * pf;
                this.vy += ny * f * DT * pf;
                if (this.onBall) {
                    tb.vx -= nx * f * DT / BALL_TM;
                    tb.vy -= ny * f * DT / BALL_TM;
                    tb.w += (rx * (-ny * f) - ry * (-nx * f)) * DT / BALL_I; // torque from pulling on the edge
                }
                const lim = this.len * 3 + 200;
                if (!this.onBall && d > lim) { // failsafe only; the progressive spring normally stops you long before this
                    this.x = a.x - nx * lim;
                    this.y = a.y - ny * lim;
                    if (closing < 0) {
                        this.vx -= closing * nx;
                        this.vy -= closing * ny;
                    }
                }
            }
            if (sf > 0 && xc > 0) {
                // The snap: a Hooke pull along the line to the ball's centre (so no torque and no spin-driven jitter). The ball's acceleration is BALL_SNAP_K x the stretch, but the
                // pull only tops the ball up to BALL_SNAP_VMAX toward you (a smooth speed limit, not an on/off switch) so it can never drag the ball faster than that.
                const ncx = cdx / dc, ncy = cdy / dc;
                const closingC = (this.vx - tb.vx) * ncx + (this.vy - tb.vy) * ncy;           // relative closing speed along the centre line (+ = coming together)
                const ballIn = -(tb.vx * ncx + tb.vy * ncy);                                   // the ball's OWN speed toward you (not the relative one: that includes YOUR speed)
                const fh = (BALL_SNAP_K * xc + BALL_SNAP_DAMP * Math.max(0, -closingC)) * BALL_TM;
                const fs = Math.min(fh, Math.max(0, BALL_SNAP_VMAX - ballIn) * BALL_TM / DT) * sf;
                this.vx += ncx * fs * DT * BALL_PULL;
                this.vy += ncy * fs * DT * BALL_PULL;
                tb.vx -= ncx * fs * DT / BALL_TM;
                tb.vy -= ncy * fs * DT / BALL_TM;
            }
            if (TAUT_K > 0 && !this.onBall && this.ropeGround) { // taut floor tether: hang above the pivot instead of dropping onto it
                const s = Math.max(0, Math.min(1, (ny - TAUT_MIN_NY) / TAUT_FADE));
                if (!this.taut && d >= this.len)
                    this.taut = true; // the grapple-jump slack is used up
                if (this.taut && this.len - d > FLOAT_RELEASE_DEPTH)
                    this.dribT = DRIB_T;   // sank clearly below the float point: the float steps aside and you fall to the pivot
                // Float weight: dribbling overrides the float (fast fade out), then it settles back in slowly so there is no pop.
                const wT = this.dribT > 0 ? 1 - DRIB_FLOAT_FADE : 1; // (0 fade = the float never steps aside, so the rope's rubber band alone brings you back)
                this.floatW += (wT - this.floatW) * Math.min(1, (wT >= this.floatW ? FLOAT_ON_RATE : FLOAT_OFF_RATE) * DT);
                const fw = this.floatW * s;
                if (this.taut && fw > 0.001) {
                    if (d < this.len) { // closer than the rope's length: below the neutral float point
                        const x = this.len - d;
                        const bd = BOB_DEPTH + BOB_KICK_BONUS * (this.dribT / DRIB_T); // bob zone: a little sag is allowed, wider right after a kick
                        const xe = x <= bd ? x * BOB_SOFT : bd * BOB_SOFT + (x - bd); // soft spring inside the bob zone, full strength past it
                        const f = Math.max(0, TAUT_K * (heavy ? HEAVY_KS : 1) * xe * (1 + xe / STRETCH_X0) + TAUT_DAMP * closing) * fw;
                        this.vx -= nx * f * DT;
                        this.vy -= ny * f * DT;
                    }
                    if (!this.ground && dir === 0) {   // no sideways centering or drag while you steer
                        this.vx -= (this.x - a.x) * TAUT_CENTER * fw * DT;
                        this.vx *= 1 - TAUT_DRAG * fw * DT;
                    }
                }
            }
        }
        this.prevX = k.x;
    },
});