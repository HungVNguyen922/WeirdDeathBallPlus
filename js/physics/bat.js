// PHYSICS - bat: the BAT special's swing maths (angle over time, and the per-step hit sweep). Called from Player.stepCast (player-casts.js); the renderer reads batAngle too.
// Load order: anywhere before the first tick (it only uses globals at call time).
// Bat special. Angle of the bat at swing progress f (0..1). The swing is a semicircle (BAT_ARC) centred on the aim c.ang: it starts BAT_ARC/2 to one side of the aim (pulled back a
// little further the more it is charged), sweeps through the aim and ends BAT_ARC/2 on the other side, easing in and out (smoothstep). Clockwise when aiming, anticlockwise when
// holding weight. The renderer draws the bat at this angle (and earlier ones for the motion blur); the physics uses the same angle to sweep the hit area.
function batAngleAt(c, f) {
    f = Math.max(0, Math.min(1, f));
    const e = f * f * (3 - 2 * f), s = (Math.cos(c.ang) >= 0 ? 1 : -1) * (c.inv ? -1 : 1), half = BAT_ARC / 2, back = half + BAT_WIND * c.charge; // inv: start on the other end, sweep the other way
    return c.ang - s * back + s * (back + half) * e;
}
const batAngle = c => batAngleAt(c, c.charging ? 0 : 1 - c.t / c.t0);
// One physics step of a bat swing, called from Player.step while the cast runs. p = the batter, c = the cast, ball = the death ball. c.hits is a bit mask (one bit per target, in
// the order of the list below) of what this swing has already hit: a number, not an array, so the AI's shallow cast copies cannot share it.
// A target is hit when (a) its centre is inside the half-disc, i.e. within BAT_ARC/2 of the aim, and (b) the bat's sweep this step (previous angle -> current angle) passes over it.
// Testing the whole sweep, not just the bat's current angle, means a fast swing can never skip over something.
function batStep(p, c, ball) {
    const f = 1 - c.t / c.t0, th = batAngleAt(c, f), prev = batAngleAt(c, f - DT / c.t0), targets = [ball];
    if (!p.sim) { // the AI's planning copies only know the death ball
        targets.push(...decoys);
        for (const q of players)
            if (q !== p && q.alive && (BAT_HITS_TEAMMATES || q.team !== p.team))
                targets.push(q);
        for (const k of projOf('block')) // the Builder's blocks (before the arrows: arrows are not in the hit mask)
            if (!k.broken)
                targets.push(k);
        for (const a of projOf('arrow')) // arrows last: they are not tracked in the c.hits mask (their own immunity timer stops a second hit instead)
            if (BAT_HITS_STUCK_ARROWS || !a.stuck)
                targets.push(a);
    }
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    const ax = Math.cos(c.ang), ay = Math.sin(c.ang); // the way the bat was aimed (the direction held)
    const s = (ax >= 0 ? 1 : -1) * (c.inv ? -1 : 1), stepAng = Math.abs(wrap(th - prev)); // s: swing direction, stepAng: how far the bat moved this step
    for (let i = 0; i < targets.length; i++) {
        const b = targets[i], isArrow = b.stuck !== undefined, bit = isArrow ? 0 : 1 << i; // (only arrows have a `stuck` field)
        if (isArrow ? b.immune > 0 : c.hits & bit)
            continue;
        const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
        if (d > BAT_REACH + b.r)
            continue; // out of reach
        const slack = Math.asin(Math.min(1, b.r / Math.max(d, 1e-6))); // a big target is hit a little earlier / later
        const ang = Math.atan2(dy, dx);
        if (Math.abs(wrap(ang - c.ang)) > BAT_ARC / 2 + slack)
            continue; // outside the semicircle
        const along = s * wrap(ang - prev); // how far past the bat's previous position the target is, measured in the swing direction
        if (along < -slack - BAT_HIT_MARGIN || along > stepAng + slack + BAT_HIT_MARGIN)
            continue; // the bat did not pass it this step
        c.hits |= bit;
        const isPlayer = b instanceof Player, ox = d > 1 ? dx / d : ax, oy = d > 1 ? dy / d : ay; // ox, oy: straight away from the batter
        let ux = ax * BAT_AIM_W + ox * (1 - BAT_AIM_W), uy = ay * BAT_AIM_W + oy * (1 - BAT_AIM_W);
        const m = Math.hypot(ux, uy) || 1;
        ux /= m;
        uy /= m;
        const pow = 1 + BAT_CHARGE_BONUS * c.pow, sp = Math.hypot(b.vx, b.vy); // what it had, plus some; a still target still goes
        const out = isArrow ? Math.min(BAT_ARROW_VMAX + BAT_VMAX_CHARGE * c.pow, (BAT_ARROW_V + BAT_ARROW_KEEP * sp) * pow)
            : isPlayer ? Math.min(BAT_PLAYER_VMAX * pow, (BAT_PLAYER_V + BAT_PLAYER_KEEP * sp) * pow) : Math.min(BAT_VMAX + BAT_VMAX_CHARGE * c.pow, (BAT_V + BAT_KEEP * sp) * pow);
        const nvx = ux * out + p.vx * BAT_CARRY, nvy = uy * out + p.vy * BAT_CARRY;
        if (isPlayer && BAT_OVERCHARGE && c.pow >= BAT_OVERCHARGE_MIN)
            b.overcharge(); // a fully charged swing also overcharges the player it hits
        if (isArrow)
            arrowKnock(b, nvx, nvy, ARROW_DEFLECT_TEAM ? p.team : null, ARROW_DEFLECT_TEAM ? p : null);
        else {
            const ovx = b.vx, ovy = b.vy;
            b.vx = nvx;
            b.vy = nvy;
            if (b.type === 'block') { // a block spins by where the bat caught it
                const cd2 = Math.max(p.r, d - b.r);
                bkSpin(b, p.x + ox * cd2, p.y + oy * cd2, nvx - ovx, nvy - ovy);
            }
        }
        if (b.boost !== undefined) { // balls: big hits raise the speed cap briefly, like a hatchet hit
            const sp2 = Math.hypot(b.vx, b.vy);
            if (sp2 > BALL_VMAX)
                b.boost = Math.max(b.boost, Math.min(1, (sp2 - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
        }
        if (b === ball)
            b.pull = { t: BAT_FX, ux, uy, col: p.color }; // streak (only the death ball's timer is stepped in rules.js, so decoys get none)
        if (!p.sim) { // impact effects for the renderer (the AI's planning copies must stay silent): the contact point is on the target's near edge
            const cd = Math.max(p.r, d - b.r);
            events.onBatHit(p, b, p.x + (d > 1 ? dx / d : ax) * cd, p.y + (d > 1 ? dy / d : ay) * cd, ux, uy, Math.min(1, Math.hypot(b.vx, b.vy) / BAT_VMAX));
        }
    }
}
