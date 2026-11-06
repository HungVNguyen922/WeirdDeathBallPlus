// PHYSICS - Player collide: moving the body through the arena for one tick (pegs, floor and slopes, ledges, net, stuck arrows, ceiling, side walls, the net guard).
// Adds a method to Player (see mixin() in player.js); load after player.js.
mixin(Player, {
    // Integrate the position and resolve every collision. dir = -1 / 0 / 1 steering (the pivot bounce uses it).
    stepCollide(dir) {
        this.x += this.vx * DT;
        this.y += this.vy * DT;
        // The hook is just the rope's anchor point: nothing blocks you from reaching it, so you can swing straight through the pivot and out the other side.
        for (const q of pegs)
            pegBounce(this, q);
        // Floor + slopes are solved in the floor's own frame (it can be raised and moving), then everything moves back: the floor's
        // speed is handed to whoever rests on it, which is how a pop kicks things up.
        const o = sawY(this.x), vo = sawV(this.x);
        this.y -= o;
        this.vy -= vo;
        this.hit = 0;
        const tg = collideTerrain(this, 0, vo);
        if (this.y + this.r > H) {
            this.hit = Math.max(this.hit, this.vy + vo);
            this.y = H - this.r;
            if (this.vy > 0)
                this.vy = 0;
        }
        const gf = tg || this.y + this.r >= H - 1.5;
        this.y += o;
        this.vy += gf && this.xericT > 0 ? vo * XERIC_QUAKE : vo; // Xeric: standing weighted on the floor soaks up most of the pop's kick
        sawHit(this.x, this.hit);
        this.ground = collideTerrain(this, 0, 0, LEDGES, LEDGE_T) || gf;
        if (collideTerrain(this, 0.2, 0, NETSEGS, NET_T))
            this.ground = true; // landing on top of the net's cut end counts as ground
        if (collideTerrain(this, 0, 0, stuckSegs, ARROW_HALF_W))
            this.ground = true; // standing on a stuck arrow counts as ground
        if (!this.sim && blocksVsPlayer(this))
            this.ground = true; // standing on a builder block counts as ground
        if (this.rope && !this.onBall && this.ropeGround && this.hit > PIVOT_MIN_HIT && Math.hypot(this.rope.x - this.x, this.rope.y - this.y) < PIVOT_ZONE) {
            // Hit the pivot: the speed the floor just absorbed goes sideways instead. Direction = the way you steer, else the way you were already
            // travelling, else out the side opposite to the one you came in on.
            const sgn = dir !== 0 ? dir : Math.abs(this.vx) > 10 ? Math.sign(this.vx) : this.pivotSide ? -this.pivotSide : 1;
            const add = this.hit * PIVOT_TRANSFER;
            const keep = Math.sign(this.vx) === sgn ? 1 : PIVOT_TURN_KEEP;
            this.vx = sgn * Math.hypot(this.vx * keep, add);
        }
        if (this.y - this.r < 0) {
            this.y = this.r;
            if (this.vy < 0)
                this.vy *= -0.05;
        } // demo: ceiling hits barely rebound
        const lo = this.r; // players may now cross the net through its gap, so only the outer walls limit them
        const hi = W - this.r;
        if (this.x < lo) {
            this.x = lo;
            if (this.vx < 0)
                this.vx *= -0.2;
        }
        if (this.x > hi) {
            this.x = hi;
            if (this.vx > 0)
                this.vx *= -0.2;
        }
        // Net guard: the net is a thin wall, so a very fast player could jump clean through it in one step. If we ended up on the other side of the net
        // while below its gap, put us back against the face we came from. (Crossing through the gap is fine: we are above NET_GAP then.)
        const side = this.x < NETX ? 0 : 1;
        if (this.netSide !== undefined && side !== this.netSide && this.y + this.r > NET_GAP + 0.5) {
            this.x = NETX + (this.netSide ? this.r : -this.r);
            if (this.vx * (this.netSide ? 1 : -1) < 0)
                this.vx *= -0.2;
        } else
            this.netSide = side;
    },
});



