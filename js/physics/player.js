// PHYSICS - Player: the class itself (state, reset, the per-tick step that calls the pieces). Never draws.
// The rest of Player lives in player-grapple.js, player-collide.js, player-casts.js, player-specials.js and player-hopper.js, and the bat maths in bat.js (all loaded after this file).
const noKeys = () => ({ l: false, r: false, up: false, z: false, x: false, sp: false, sp2: false, dn: false }); // sp = first special, sp2 = second special (only when twoSpecials), dn = down, z = grapple, x = weight
const AIMING = ['arrow', 'marionette', 'bat']; // casts that read the arrow keys live to aim: only one of them can run at a time
const mixin = (cls, methods) => { for (const n of Object.keys(methods)) Object.defineProperty(cls.prototype, n, { value: methods[n], writable: true, configurable: true, enumerable: false }); }; // adds methods to a class from another file, as if they were declared in it

class Player {
    constructor(team, sx, color, id) {
        this.id = id; // 0 Blue, 1 Red, 2 Blue's teammate, 3 Red's teammate (indexes the AI state and key bindings)
        this.team = team;
        this.sx = sx;
        this.color = color;
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.r = 16;
        this.ground = false;
        this.alive = true;
        this.deadT = 0; // sandbox: how long this player has been dead
        this.rope = null;
        this.pending = null;
        this.onBall = false;
        this.len = 0;
        this.hookAng = 0;
        this.hookR = 0;
        this.ropeGround = false;
        this.prevX = false;
        this.kickReq = false;
        this.primeT = 0; // seconds of 'primed' left after weight is released (weight held = primed)
        this.gjN = 0; this.gjT = 99;               // grapple-jump chain: jumps so far, seconds since the last one
        this.driveT = 0; this.driveAcc = 0; this.driveVmax = 0; // the grapple-jump drive still running (see GJ_DRIVE_T): seconds left, and its acceleration (u/s^2)
        this.tball = null; // the ball (the death ball or a decoy) we are tethered to while onBall
        this.taut = false;
        this.floatW = 1; // grapple-float weight 0..1: dribbling fades it out so the rope can pull you in, then it eases back
        this.dribT = 0;  // seconds left of the 'dribbling' window opened by a weighted kick
        this.stretchT = 0; // > 0: the ball tether was wildly overstretched (a teleport, launch...) and the leash is in a snap (see stepGrapple); seconds left
        this.sim = false; // true on the AI planner's throwaway copies: they must not touch the real game (spawn decoys / pegs)
        this.keys = noKeys();
        this.special = 'dash'; // chosen special ability (see SPECIALS)
        this.special2 = 'plinko'; // second special (only used while twoSpecials is on; never the same as `special`)
        this.prevSp2 = false;
        this.warp = null; // Warp: the placed marker { x, y }, or null (replaced, never edited in place, so the AI's shallow copies are safe)
        this.awakeT = 0; // Awakened: seconds of power-up left (0 = not awake)
        this.exploT = 0; // Explode: seconds left in which a death refunds the cooldown (0 = no blast to reward)
        this.exploDead = 0; // Explode: how many players were already dead when the blast went off
        this.exploCarry = false; // Explode: a refund was earned, so the next round starts with it ready (see reset)
        this.explodeFx = null; // Explode: the last blast { t, x, y, hits: [{ x, y, r }] } (the zone, and a flash on each body it hit); t counts down from EXPLODE_FX
        this.smokeT = 0; // Smoke Screen: seconds of cloud left (0 = none); the cloud is centred on the player
        this.smokeX = 0; this.smokeY = 0; // where the cloud was cast
        this.pongT = 0; // Pong: seconds of rubber left (0 = none)
        this.mineFx = null; // Mines: the last blast { t, pts: [{ x, y, n }] } (display only); t counts down from MINE_FX
        this.minePrevX = false; // Mines: was weight down last tick (a detonation is a fresh press of weight while the special key is held)
        this.warpFx = null; // Warp: the last teleport { t, ax, ay, bx, by } (a short visual: rings at both ends); t counts down from WARP_FX
        this.arrowAng = -Math.PI / 2; // last arrow aim, kept across rounds (so not in reset())
        this.boomFlip = 1;
        this.reset();
    }
    reset() {
        this.x = sidesSwapped ? W - this.sx : this.sx; // sx is the spawn on the team's normal side; a swapped team spawns mirrored
        this.face = this.x < NETX ? 1 : -1; this.dirHist = []; this.fTick = 0; this.move = null;
        this.fBuf = null;
        this.stunT = 0;
        this.hLast = 1; this.pL = false; this.pR = false;
        this.s = 1; this.r = SPLIT_BASE_R; this.clones = []; this.splitLock = 0;
        this.y = H - this.r;
        this.vx = this.vy = 0;
        this.alive = true;
        this.rope = null;
        this.pending = null;
        this.awakeT = 0; // Awakened never survives the round
        this.smokeT = 0; // neither does the smog
        this.pongT = 0; // Pong never survives the round either
        this.mineFx = null;
        this.minePrevX = false;
        this.gCharge = GRAPPLE_MAX; // grapple meter: seconds of grip left
        this.gCool = 0;             // > 0: the meter was spent; no grappling at all until this runs out (then the meter restarts from 0 and refills passively)
        this.onBall = false;
        this.stretchT = 0;
        this.ground = false;
        this.ropeBase = null;
        this.netSide = undefined; // which side of the net we were last on (0 left, 1 right); set after the first step
        this.gjN = 0; this.gjT = 99;               // grapple-jump chain: jumps so far, seconds since the last one
        this.driveT = 0; this.driveAcc = 0; this.driveVmax = 0; // the grapple-jump drive still running (see GJ_DRIVE_T): seconds left, and its acceleration (u/s^2)
        this.dashReady = true; // one dash per trip off the floor
        this.tball = null;
        this.cd = { dash: 0, plinko: 0, marionette: 0, decoy: 0, arrow: 0, bat: 0, barbwire: 0, warp: 0, awakened: 0, explode: 0 }; // per-ability cooldown remaining (s)
        this.warp = null; // a marker never survives the round
        this.warpFx = null;
        for (const id in ABILITY)
            this.cd[id] = ABILITY[id].cd * START_CD;
        if (this.exploCarry)
            this.cd.explode = 0; // earned by a kill that ended the last round: start this one with Explode ready
        this.exploCarry = false;
        this.exploT = 0;
        this.explodeFx = null;
        this.hopT = 0; this.hopDir = [0, 0]; this.hopTo = { x: 0, y: 0 }; this.hopFloor = false; this.hopPx = 0; this.hopPy = 0;
        this.surf = null; this.clinging = false; this.stickGrace = 0;
        this.casts = []; // abilities being cast right now, at most one per special key: { type, key, t, t0, hx, hy, x, y, ... }
        this.dashT = 0;
        this.dashDir = [0, 0];
        this.prevSp = false;
        this.prevSp2 = false;
        this.arrowQueued = false;
        this.gBurst = 0;
        this.hyperT = 0; this.xericT = 0;           // seconds left on this player's hyper / xeric aura (they act on every OTHER player)
        this.boostFx = 0; this.fizzleFx = 0;        // display timers: a jump / kick was just boosted by another's hyper, or cut by another's xeric
    }
    get grounded() { return this.ground; }
    // The specials that are active right now, as [key, ability id]: the first always, the second only when the match uses two and it is not the same ability.
    slots() {
        if (twoSpecials && this.special === 'fighter' && this.special2 === 'fighter') return [['sp', 'fighter'], ['sp2', 'fighter']];
        const s1 = this.special === 'fighter' ? 'dash' : this.special; // a stray Fighter outside its mode counts as Dash
        return twoSpecials && this.special2 && this.special2 !== 'fighter' && this.special2 !== s1 ? [['sp', s1], ['sp2', this.special2]] : [['sp', s1]];
    }
    has(id) { return this.slots().some(s => s[1] === id); }
    casting(type) { return this.casts.find(c => c.type === type) || null; } // the running cast of this kind, or null
    endCast(c) {
        const i = this.casts.indexOf(c);
        if (i >= 0)
            this.casts.splice(i, 1);
    }
    get crashK() { return this.awakeT > 0 ? AWAKENED_CRASH : 1; } // Awakened: multiplier on the push your crashes give to balls, decoys and players
    // Tick the cooldowns, effect timers and the per-special bookkeeping (markers, power-ups) that need no input.
    tickTimers() {
        if (this.ground) // Dash: one use, refilled whenever the player is on the floor
            this.dashReady = true;
        for (const id in this.cd)
            this.cd[id] = Math.max(0, this.cd[id] - DT);
        this.dashT = Math.max(0, this.dashT - DT);
        if (!this.has('warp'))
            this.warp = null; // swapped to another special: the marker goes with it
        if (this.awakeT > 0) {
            if (!this.has('awakened'))
                this.setAwake(false, false); // swapped to another special: the power-up ends, no cooldown
            else if ((this.awakeT -= DT) <= 0)
                this.setAwake(false); // wore off: the cooldown starts now
        }
        if (this.smokeT > 0) {
            if (!this.has('smoke'))
                this.smokeT = 0; // swapped to another special: the cloud goes with it, no cooldown
            else if ((this.smokeT -= DT) <= 0) {
                this.smokeT = 0;
                this.cd.smoke = SMOKE_COOLDOWN; // cleared: the cooldown starts now
            }
        }
        if (this.pongT > 0) {
            if (!this.has('pong'))
                this.pongT = 0; // swapped to another special: the rubber goes with it, no cooldown
            else if ((this.pongT -= DT) <= 0) {
                this.pongT = 0;
                this.cd.pong = PONG_COOLDOWN; // wore off: the cooldown starts now
            }
        }
        if (this.warpFx && (this.warpFx = { ...this.warpFx, t: this.warpFx.t - DT }).t <= 0)
            this.warpFx = null;
        if (this.exploT > 0)
            this.exploT = Math.max(0, this.exploT - DT);
        if (this.explodeFx && (this.explodeFx = { ...this.explodeFx, t: this.explodeFx.t - DT }).t <= 0)
            this.explodeFx = null;
        if (this.mineFx && (this.mineFx = { ...this.mineFx, t: this.mineFx.t - DT }).t <= 0)
            this.mineFx = null;
        this.stunT = Math.max(0, this.stunT - DT);
        this.gBurst = Math.max(0, this.gBurst - DT);
        this.stickGrace = Math.max(0, this.stickGrace - DT);
        this.boostFx = Math.max(0, this.boostFx - DT);
        this.fizzleFx = Math.max(0, this.fizzleFx - DT);
        if (!this.has('hopper')) { this.hopT = 0; this.clinging = false; this.surf = null; }
    }
    step(ball) {
        const k = this.keys, heavy = k.x;
        this.gjT += DT;
        this.dribT = Math.max(0, this.dribT - DT);
        if (this.gjT > GJ_CHAIN_T)
            this.gjN = 0; // chain broken
        const lock = this.moveLocked();
        const dir = this.casting('arrow') || lock ? 0 : (k.r ? 1 : 0) - (k.l ? 1 : 0);
        // Constant acceleration toward the max speed (the demo shows a steady ramp, not a hard build-up curve).
        // Movement is halved for Hopper Special
        const mv = this.has('hopper') ? HOPPER_MOVE : 1;
        const acc = RUN_ACC * mv * (this.grounded ? 1 : 0.55) * (dir * this.vx < 0 ? 1.4 : 1);;
        if (dir && dir * this.vx < 330 * mv)
            this.vx += dir * acc * DT;
        else if (!dir && this.grounded && !this.rope)
            this.vx *= 1 - GROUND_BRAKE * DT; // no ground braking while tethered, so the rope bounce is not eaten
        this.tickTimers();
        this.fighterRecord();
        this.stepCasts(ball);
        this.fighterStep(ball);
        // Jump: pressing UP on the ground launches at JUMP_V. While UP stays held in the air, gravity drops to G_FLOAT, which
        // gives the long, symmetric float seen in the demo; releasing UP restores full gravity G. While tethered and
        // holding UP, a floaty arc keeps swings and floats working.
        if (k.up && this.grounded && !lock) 
            this.vy = -JUMP_V;
        let g = (k.up ? G_FLOAT : G) * (heavy ? 1.35 : 1);
        if (k.up && this.rope) {
            g = (this.onBall ? G * 0.4 : G_FLOAT) * (heavy ? 1.35 : 1);
            const cap = this.onBall ? 170 : 70;
            if (this.vy > cap)
                g = 0; // surface tether: the float only stops gravity from adding fall speed. It never clips the rope's own recoil, so a held grapple can pull you back through the pivot
        }
        if (k.dn)
            g = G * DOWN_G * (heavy ? 1.35 : 1); // DOWN: drop faster (also cancels the UP float), which keeps dribbles low
        if (this.stunT > 0) {
            g *= FIGHTER_STUN_GRAV;
            this.vx *= 1 - FIGHTER_STUN_DRAG * DT;
            this.vy *= 1 - FIGHTER_STUN_DRAG * DT;
        }
        this.stepGrapple(ball, dir);
        if (this.hopT > 0 || this.clinging)
            g = 0;
        this.vy += g * DT;
        this.vx *= 1 - 0.1 * DT;
        if (this.hopT > 0) { // flying: the hop sets the velocity outright (so the rope cannot slow it)
            this.vx = this.hopDir[0] * HOPPER_HOP_V;
            this.vy = this.hopDir[1] * HOPPER_HOP_V;
        } else if (this.clinging) { // clinging: no sliding, only a slow crawl along the surface
            const crawl = k.x ? HOPPER_CRAWL_FINE : HOPPER_CRAWL; // Weight held: slow, precise crawl
            if (this.surf === 'C' || this.surf === 'JU') { this.vy = 0; this.vx = dir * crawl; } // (JU = the underside of a goal jut, crawled along like the ceiling)
            else { this.vx = 0; this.vy = ((k.dn ? 1 : 0) - (k.up ? 1 : 0)) * crawl; }
        }
        this.hopPx = this.x; this.hopPy = this.y;
        this.stepCollide(dir);
        this.hopperEnd(k);
    }
}






