// PHYSICS - Player casts: starting an ability when its key goes down (startAbility), running the timed / held casts (stepCast: dash, plinko, marionette, decoy, bat, barbwire, arrow)
// and the per-tick key handling that drives them (stepCasts). Never draws.
// Adds methods to Player (see mixin() in player.js); load after player.js.
mixin(Player, {
    // Something just appeared at (x, y) with radius rr: if we overlap it we are moved out along the arrow(s) held when the cast began (c.hx / c.hy); with none held: up if
    // we are on the floor, otherwise back against our motion. We keep the speed that was carrying us away from it and lose the part that carried us into it.
    pushOutOf(x, y, rr, c) {
        if (Math.hypot(this.x - x, this.y - y) >= this.r + rr)
            return;
        const sp = Math.hypot(this.vx, this.vy);
        let ux = 0, uy = -1;
        if (!this.ground && sp > 30) { ux = -this.vx / sp; uy = -this.vy / sp; }
        if (c.hx || c.hy) { const m = Math.hypot(c.hx, c.hy); ux = c.hx / m; uy = c.hy / m; }
        this.x = x + ux * (this.r + rr + 1);
        this.y = y + uy * (this.r + rr + 1);
        const vn = this.vx * -ux + this.vy * -uy;
        if (vn > 0) { this.vx -= -ux * vn; this.vy -= -uy * vn; }
        this.vx += ux * 60;
        this.vy += uy * 60;
    },
    // A special key went down (or a queued arrow came off cooldown): start that ability. Returns true if it started or fired.
    startAbility(id, key, ball) {
        if (this.stunT > 0) return false;
        const k = this.keys, hx = (k.r ? 1 : 0) - (k.l ? 1 : 0), hy = (k.dn ? 1 : 0) - (k.up ? 1 : 0);
        if (AIMING.includes(id) && this.casts.some(c => AIMING.includes(c.type)))
            return false; // two aiming casts would fight over the same arrow keys
        let c = null;
        if (id === 'dash' && this.dashReady && this.cd.dash <= 0 && (hx || hy) && !(this.ground && !hx && hy > 0)) // pushing straight down into the floor does not use it up
            c = { type: 'dash', t: DASH_CAST, t0: DASH_CAST, hx, hy };
        else if (id === 'plinko' && this.cd.plinko <= 0)
            c = { type: 'plinko', t: PLINKO_CAST, t0: PLINKO_CAST, hx, hy, x: this.x, y: this.y };
        else if (id === 'marionette' && this.cd.marionette <= 0) // starts aiming: no timer, it lasts as long as the key is held
            c = { type: 'marionette', aim: true, t: 1, t0: 1, hx, hy, grace: hx || hy ? MARIONETTE_GRACE : 0 };
        else if (id === 'decoy' && this.cd.decoy <= 0)
            c = { type: 'decoy', t: DECOY_CAST, t0: DECOY_CAST, hx, hy, x: this.x, y: this.y };
        else if (id === 'bat' && this.cd.bat <= 0) // charges while the key is held (aim read live), swings on release
            c = { type: 'bat', t: BAT_T, t0: BAT_T, charging: true, charge: 0, pow: 0, hx, hy, inv: !!k.x, ang: hx || hy ? Math.atan2(hy, hx) : Math.atan2(ball.y - this.y, ball.x - this.x), hits: 0 };
        else if (id === 'barbwire' && this.cd.barbwire <= 0)
            c = { type: 'barbwire', t: 1, t0: 1, held: 0, roped: 0, hx, hy };
        else if (id === 'arrow' && this.cd.arrow <= 0)
            c = { type: 'arrow', t: 1, t0: 1, charge: 0, ang: this.arrowAng, noTilt: false, tap: { l: 0, r: 0, u: 0, d: 0 }, prev: { l: k.l, r: k.r, u: k.up, d: k.dn } };
        else if (id === 'awakened') { // instant, no cast: power up if ready and not already awake
            if (this.cd.awakened <= 0 && this.awakeT <= 0) {
                this.setAwake(true);
                return true;
            }
        } else if (id === 'smoke') { // instant, no cast: wrap yourself in smog if ready and not already smoking
            if (this.cd.smoke <= 0 && this.smokeT <= 0) {
                this.smokeT = SMOKE_T;
                this.smokeX = this.x;
                this.smokeY = this.y;
                return true;
            }
        } else if (id === 'mines') { // 1 s cast: plant a mine on the nearest surface. Nothing happens if none is in reach or you already have MINE_MAX out
            if (this.cd.mines <= 0 && !this.sim && mineCount(this) < MINE_MAX) {
                const s = nearestSurface(this.x, this.y);
                if (s && s.d <= MINE_REACH)
                    c = { type: 'mine', t: MINE_CAST, t0: MINE_CAST, x: s.x, y: s.y, lift: s.lift, nx: s.nx, ny: s.ny };
            }
        } else if (id === 'pong') { // instant, no cast: the floor and walls turn to rubber if ready and not already on
            if (this.cd.pong <= 0 && this.pongT <= 0) {
                this.pongT = PONG_T;
                return true;
            }
        } else if (id === 'explode') { // instant, no cast
            if (this.cd.explode <= 0) {
                this.explode();
                return true;
            }
        } else if (id === 'accelerator' && this.cd.accelerator <= 0 && !this.sim) {
            c = { type: 'accelerator', t: ACCELERATOR_CAST, t0: ACCELERATOR_CAST, x: this.x, y: this.y, hx, hy };
        } else if (id === 'builder') { // instant: build a block in the arrows' direction; weight = the sloped / domed version
            if (this.cd.builder <= 0 && !this.sim) {
                buildBlock(this, hx, hy, !!k.x);
                return true;
            }
        } else if (id === 'warp') { // instant: no cast, no timer (see warpPress)
            this.warpPress();
            return true;
        } else if (id === 'split') { // instant: halve yourself (or, with weight held, switch bodies)
            return this.splitPress();
        } else if (id === 'fighter') { 
            return this.fighterPress(key);
        } else if (id === 'boomerang') { // instant: no cast
            if (this.cd.boomerang <= 0 && (this.sim || boomCount(this) < BOOMERANG_MAX)) {
                if (!this.sim)
                    throwBoomerang(this, hx, hy);
                this.cd.boomerang = BOOMERANG_COOLDOWN;
                return true;
            }
            return false;
        }else if (id === 'hopper') {
            return this.hop();
        }
        if (!c)
            return false;
        c.key = key; // the key that started it is the key that ends it
        this.casts.push(c);
        return true;
    },
    stepCast(c, k, ball) {
        const held = k[c.key || 'sp']; // the key that started this cast
        if (c.type === 'arrow') {
            arrowAimStep(c, k);
            this.arrowAng = c.ang;
            if (!held)
                c.t = 0; // released: fire (below)
        } else if (c.aim) { // marionette: follow the arrows while the key is held; letting go fires (or cancels if there is no direction)
            const ax = (k.r ? 1 : 0) - (k.l ? 1 : 0), ay = (k.dn ? 1 : 0) - (k.up ? 1 : 0);
            if (ax || ay) {
                c.hx = ax;
                c.hy = ay;
                c.grace = MARIONETTE_GRACE;
            } else
                c.grace = Math.max(0, c.grace - DT);
            if (!held) {
                if ((c.hx || c.hy) && c.grace > 0)
                    c.t = 0; // released with a direction: fire (below)
                else
                    this.endCast(c); // released with none: cancelled, nothing spent
            }
        } else if (c.type === 'barbwire') {
            c.held += DT;
            if (this.rope || (this.pending && k.z))
                c.roped += DT; // time the wire was really out (hook in flight or tethered): only this costs cooldown
            if (!held || c.roped >= BARBWIRE_MAX_T)
                c.t = 0;
        } else if (c.type === 'bat') {
            if (c.charging) { // holding the key: charge up and follow the arrows; the timer does not run yet
                const ax = (k.r ? 1 : 0) - (k.l ? 1 : 0), ay = (k.dn ? 1 : 0) - (k.up ? 1 : 0);
                if (ax || ay) {
                    c.hx = ax;
                    c.hy = ay;
                }
                c.ang = c.hx || c.hy ? Math.atan2(c.hy, c.hx) : Math.atan2(ball.y - this.y, ball.x - this.x); // last direction held, or the death ball if none ever was
                c.charge = Math.min(1, c.charge + DT / BAT_CHARGE_T);
                if (!held) { // released: swing
                    c.charging = false;
                    c.pow = c.charge;
                }
            } else {
                batStep(this, c, ball);
                c.t -= DT;
            }
        } else if (c.type === 'mine') { // timed, but cancelled if you drift away from the spot
            c.t -= DT;
            if (Math.hypot(this.x - c.x, this.y - (c.y + mineLift(c))) > MINE_LEASH)
                this.endCast(c);
        } else
            c.t -= DT;
        if (this.casts.includes(c) && c.t <= 0) {
            this.endCast(c);
            if (c.type === 'dash' && this.dashReady) {
                const m = Math.hypot(c.hx, c.hy), ux = c.hx / m, uy = c.hy / m;
                if (ux && this.vx * ux < 0)
                    this.vx = 0; // cancel what we were doing against the dash
                if (uy && this.vy * uy < 0)
                    this.vy = 0;
                this.vx += ux * DASH_V;
                this.vy += uy * DASH_V;
                this.dashReady = false;
                this.cd.dash = DASH_COOLDOWN;
                this.dashT = DASH_FX;
                this.dashDir = [ux, uy];
            } else if (c.type === 'plinko') {
                // The peg appears at the spot where the cast began. If we are still overlapping it we get pushed out in the direction of the arrow(s)
                // held at the press; with none held: up if we are on the floor, otherwise back against our motion.
                const peg = { x: c.x, y: c.y, vx: 0, vy: 0, r: PEG_R, team: this.team, owner: this, flash: 1, life: PEG_LIFE };
                if (!this.sim) { // (the AI's planning copies must not leave pegs in the real game)
                    pegs.push(peg);
                    if (pegs.filter(q => q.owner === this).length > PEG_MAX)
                        pegs.splice(pegs.findIndex(q => q.owner === this), 1);
                }
                this.pushOutOf(peg.x, peg.y, PEG_R, c);
                this.cd.plinko = PLINKO_COOLDOWN;
            } else if (c.type === 'marionette') {
                // An impulse on the death ball along the arrow(s) held when the key was released. Motion against the shove is cancelled first, so it always goes the way you pointed.
                const m = Math.hypot(c.hx, c.hy), ux = c.hx / m, uy = c.hy / m;
                if (ux && ball.vx * ux < 0)
                    ball.vx = 0;
                if (uy && ball.vy * uy < 0)
                    ball.vy = 0;
                ball.vx += ux * MARIONETTE_V;
                ball.vy += uy * MARIONETTE_V;
                ball.pull = { t: MARIONETTE_FX, ux, uy, col: this.color };
                this.cd.marionette = MARIONETTE_COOLDOWN;
            } else if (c.type === 'decoy') {
                // The lookalike appears where the cast began (replacing this team's previous one). If we are still standing in it we are pushed out the way the
                // arrow(s) pointed at the press, exactly like plinko.
                if (!this.sim)
                    spawnDecoy(this, c.x, c.y);
                this.pushOutOf(c.x, c.y, BALL_R, c);
                this.cd.decoy = DECOY_COOLDOWN;
            } else if (c.type === 'arrow') {
                if (!this.sim)
                    fireArrow(this, c);
                this.cd.arrow = ARROW_COOLDOWN;
            } else if (c.type === 'barbwire') {
                this.cd.barbwire = Math.min(c.roped, BARBWIRE_MAX_T) * BARBWIRE_CD_RATIO; // proportional to how long the wire was out
            } else if (c.type === 'bat') {
                this.cd.bat = BAT_COOLDOWN; // the cooldown starts when the swing ends
            } else if (c.type === 'mine') {
                if (placeMine(this, c))
                    this.cd.mines = MINE_COOLDOWN;
            } else if (c.type === 'accelerator') {
                const node = placeStatic('accelerator', this, c.x, c.y);
                this.pushOutOf(node.x, node.y, ACCELERATOR_NODE_R, c);
                this.cd.accelerator = ACCELERATOR_COOLDOWN;
            }
        }
    },
    // Each tick: queue / start abilities from the key presses, then advance every running cast.
    stepCasts(ball) {
        const k = this.keys;
        // Start a cast. Each active special has its own key; a press of either starts that ability, unless a cast is already running (then it is ignored, like today).
        // To let the instant abilities (warp, awakened, explode) fire mid-cast, test them here before the `!this.cast` check.
        const slots = this.slots(), prev = { sp: this.prevSp, sp2: this.prevSp2 };
        for (const [key, id] of slots)
            if (id === 'arrow' && k[key] && this.cd.arrow > 0)
                this.arrowQueued = key; // held during cooldown: queue the next cast (arrowQueued holds the key it was queued on)
        if (this.arrowQueued && !k[this.arrowQueued])
            this.arrowQueued = false;
        for (const [key, id] of slots) {
            if (this.casts.some(c => c.key === key))
                continue; // that key already has a cast running
            const pressed = k[key] && !prev[key], queued = id === 'arrow' && this.arrowQueued === key && this.cd.arrow <= 0, repeat = BOOMERANG_HOLD && id === 'boomerang' && k[key];
            if (!pressed && !queued && !repeat)
                continue;
            if (this.startAbility(id, key, ball) && queued)
                this.arrowQueued = false; // (if the aiming rule refused it, the queue stays and tries again)
        }
        for (const c of this.casts.slice()) // (a copy: a cast removes itself from the list when it ends)
            this.stepCast(c, k, ball);
        this.prevSp = k.sp;
        this.prevSp2 = k.sp2;
    },
});
