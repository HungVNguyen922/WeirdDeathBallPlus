// ---- AI opponent: toggle either player with the buttons under the game, or keys 1 (Blue) / 2 (Red) ----
// The AI plays a few simple tactics and leans on the real physics to check them:
//   ENGAGE   walk to a stand-off from the ball, then ask "if I jump right now, do I latch onto the ball and stay clear of it?" by playing that jump forward on a copy of the
//            game; jump the first moment the answer is yes. (The grapple only latches onto the nearest thing, so we have to be airborne and over the ball.)
//            The same check is the DEFENSE: a ball rolling or flying at us gets the same jump-and-grab, which also stops it going into our goal.
//   HOLD     once tethered, play a few plans forward and keep the best one:
//              shootU / shootF  dash toward their goal (up-and-over / flat) so the rope whips the ball along, and let go the moment the ball would end up in their goal
//              pull             run back toward our own side, dragging the ball out of the middle to somewhere with room for a shot
//              push             carry it upfield when it is stuck far back in our own half
//              loopO / loopU    swing the ball around us (over the top / underneath) and let go when a release would score or hit an enemy (the book's osL / usL)
//              hold             hang on
//   CROSS    the ball is slow and between us and our own goal: hop over it (a look-ahead picks a jump that clears it and lands behind it), so the shot can start from behind the ball.
//            ENGAGE then takes over: from behind, a grapple-jump over the ball, latch, and (usually) the HOLD plan 'loopO' swings it up and over for the overhand shot.
//   DODGE    otherwise, if the ball is going to reach us: try each way of steering (left / right / still, jump / not) on a rough model and take the one that keeps us furthest from it.
//   WAIT     far away or ball on their side: wait on the midline of our half (the book's Midline Defense: nothing blocks the grapple circle, and the ball can come from anywhere).
//   RESCUE   (new) a shot that would end up in our goal gets a grab even when the grab is not 'clean': if no jump latches AND stays well clear of the ball, the AI tries ones that only
//            just clear it (a graze), grabs for a short moment to bleed the ball's speed, and lets go. See aiJumpJob's `rescue` search and the RESCUE tunables below.
// The grapple has a meter (4 s of grip, then a 6 s lockout; letting go refills it), so the AI only goes for a grab with enough left, and never holds on for ever.
// Playing things forward costs ~17 us per physics step, so those look-aheads are written as generators and run a few steps per tick (AI_SLICE), never all at once.
// A job first plays forward the ticks it is itself going to take (AI_PRE, keys frozen), so its answer is about the moment it arrives, not the moment it started.
// SIDES: a team does not always defend the left goal: every SIDE_SWAP points the teams trade ends (sidesSwapped, constants.js). Everything below that needs to know where our goal is asks aiLeft(team)
// (never `team === 0`), and the ball reports which SIDE scored (0 = the left team's end), so aiSimStep turns that into a team with sideSwap().
const aiLeft = team => sideSwap(team) === 0;
// ---- tunables for the newer behaviours ----
const AI_LAG = 1;                        // ticks added to a planned jump's start: the real jump starts a tick or two earlier than the plan assumed, and at 800 u/s a tick is ~7 u (tuned: 0 and 2 were worse overall, 3-4 much worse)
const AI_RESCUE = true;                  // false = old behaviour (only 'clean' grabs, otherwise dodge)
const AI_RESCUE_HOLDS = [0.15, 0.35, 0.7]; // how long (s) a rescue grab holds on before letting go: short = just shave the ball's speed, longer = really drag it
const AI_RESCUE_STYLES = [2, 4, 0];      // grapple-jump tap counts the rescue search tries
const AI_RESCUE_AFTER = 120;             // steps played after the release to see whether the ball still gets in
const AI_RESCUE_MARGIN = 1;              // a rescue grab only has to keep this many u clear of touching the ball (the normal search wants a 36 u gap); it must never touch
const AI_DASH_USE = 0.35;                 // chance that a latch is allowed to use the dash shot at all (0 = never dashes, 1 = old behaviour). The rest of the time it shoots with the rope alone.
const AI_THREAT = 50; // dodge when the ball would get this close (u; touching is 30)
const AI_SPECIALS = true;                  // false = the AI only ever uses Dash, like before
const AI_SPECIAL_POOL = ['dash', 'plinko', 'marionette', 'decoy', 'arrow'];
const AI_LOW = true;                       // low-to-ground style
const AI_ALT_SOFT = H * 0.45, AI_ALT_PEN = 0.06; // held plans lose points for flying above this height
const AI_CONTEST = true;                   // move to meet a shot instead of waiting at the midline
const AI_AWAY = true;                      // 1v1: crash an enemy while across the net, otherwise get home
const AI_LOOP_DASH = true;                 // dash mid-loop to keep the orbit fast
const AI_PULL_ROOM = 110;                  // 'pull' stops running home once the ball is this far (u) onto our side of the net: enough room behind it for a shot (same number the plan scoring in aiHeldJob uses)
const AI_PULL_MAX = 0.9;                   // s: the longest a pull keeps running home after the latch
const AI_GOAL_BUFFER = 0.4;                // fraction of NETX: a plan that drags or swings the ball nearer our own goal line than this (on the rope, or after a release) is marked down
const AI_GOAL_PEN = 1.5;                   // points lost per u inside that buffer
const AI_COMMIT_V = 120;                   // a rope-only (no dash) latch whose best plan is worth at least this (it scores or hits someone in the look-ahead) sticks with it instead of re-planning every 0.15 s
const AI_OVERHAND_TAPS = [2, 3, 4, 0];     // the overhand setup: stand behind the ball and hop over it with a weighted grapple-jump (these tap counts, in this order); a plain jump only as the last resort
const AI_OVERHAND_BONUS = 40;              // a loopO whose release scores or hits beats an equally good dash shot: it is the more reliable shot and needs no dash
const AI_STICK = 24;                       // bonus for staying with the current plan when there is no dash to commit us (the dash holder keeps the old +6: spending the dash is its commitment)
const ai = [0, 1, 2, 3].map(() => ({ on: false, plan: null, t: 0, age: 0, noGrab: 0, held: false, rescueHold: null }));
function aiReset(i) {
    Object.assign(ai[i], { plan: null, t: 0, age: 0, noGrab: 0, held: false, hs: null, E: null, job: null, cool: 0, jcool: 0, fails: 0, idle: 0, stand: undefined, threat: false, X: null, crossFail: 0, rescueHold: null, airT: 0, airOk: false, V: null, invCool: 0, invIdle: 0, sp: null, spCool: 0, spT: 0, R: null, retCool: 0, retFail: 0 });
    if (AI_SPECIALS && ai[i].on && !pickFixed)
        allPlayers[i].special = aiPickSpecial(allPlayers[i]);
}
function aiPickSpecial(p) { return AI_SPECIALS ? AI_SPECIAL_POOL[Math.floor(Math.random() * AI_SPECIAL_POOL.length)] : 'dash'; }
function snapshotFx() { return { sv: saw.v, st: saw.t, qf: { ...quakeFx }, hp: [...padFlash], pf: pegs.map(q => [q.flash, q.hits, q.nx, q.ny]) }; }
function restoreFx(s) {
    saw.v = s.sv;
    saw.t = s.st;
    Object.assign(quakeFx, s.qf);
    padFlash[0] = s.hp[0];
    padFlash[1] = s.hp[1];
    pegs.forEach((q, n) => { if (s.pf[n]) [q.flash, q.hits, q.nx, q.ny] = s.pf[n]; });
}
function aiClone(p) {
    const c = Object.assign(Object.create(Player.prototype), p);
    c.keys = { ...p.keys };
    c.rope = p.rope ? { ...p.rope } : null;
    c.ropeBase = p.ropeBase ? { ...p.ropeBase } : null;
    c.pending = p.pending ? { ...p.pending, p: { ...p.pending.p } } : null;
    c.casts = (p.casts || []).map(x => ({ ...x })); // (own copies: a shared list would let a look-ahead leave casts on the real player)
    c.cd = { ...p.cd };
    c.dashDir = [...p.dashDir];
    c.sim = true; // a planning copy: it must never add pegs / decoys to the real game
    return c;
}

// ---- flight prediction (no physics objects, ~100 cheap iterations): if the ball is let go now, does it end up in the goal that `team` attacks? ----
// Mirrored for team 1 so the goal is always at x = W. Ignores the players; a ball that lands on the floor only counts if it is still moving fast (it rolls up the ramp).
const AI_FLIGHT_STEPS = 200;
function aiFloorY(x) { // the arena floor under x (the hills at the net and the goal ramps)
    return H - RISE * (Math.max(0, 1 - Math.abs(x - NETX) / RUN) + Math.max(0, 1 - (W - x) / RUN) + Math.max(0, 1 - x / RUN));
}
// Where a ball let go now ends up on the floor, as a distance from OUR goal line (0 = in our goal, W = in theirs). Used to tell a safe toss upfield from dropping it at our feet.
function aiRestFromOwn(b, team) {
    const m = aiLeft(team) ? 1 : -1, dt = 1 / 60, r = BALL_R;
    let x = b.x, y = b.y, vx = b.vx, vy = b.vy, w = b.w || 0;
    for (let n = 0; n < 240; n++) {
        vy += BALL_G * dt;
        vx *= 1 - 0.05 * dt;
        vy *= 1 - 0.05 * dt;
        { const mgx = -BALL_MAGNUS * w * vy * dt; vy += BALL_MAGNUS * w * vx * dt; vx += mgx; } // spin curves the flight (ball.js): the predictions used to ignore it, so a spinny shot looked like it was going somewhere else
        x += vx * dt;
        y += vy * dt;
        if (y < r) { y = r; if (vy < 0) vy = 0; }
        if (x < 0 || x > W)
            break;
        if (y + r > aiFloorY(x)) {
            y = aiFloorY(x) - r;
            vy = 0;
            vx *= 1 - BALL_ROLL_DRAG * dt;
            if (Math.abs(vx) < 25) break;
        }
    }
    const d = aiLeft(team) ? x : W - x;
    return d;
}
// Letting go of this ball now would end in our goal or leave it rolling close to it.
const aiRisky = (b, me) => aiFlight(b, 1 - me.team) || aiRestFromOwn(b, me.team) < NETX * 0.45;
// The free ball is on course for our goal (or to die right in front of it) if nobody touches it: the cue to grab it even at a graze.
const aiUrgent = me => AI_RESCUE && (aiForecast().end === (aiLeft(me.team) ? -1 : 1) || aiFlight(AIB, 1 - me.team) || aiRestFromOwn(AIB, me.team) < NETX * 0.3);
function aiFlight(b, team) {
    const m = aiLeft(team) ? 1 : -1, dt = 1 / 60, r = BALL_R, roof = GOAL_Y0 + LEDGE_T + r;
    let x = aiLeft(team) ? b.x : W - b.x, y = b.y, vx = b.vx * m, vy = b.vy, w = (b.w || 0) * m; // (mirrored frame: spin flips)
    for (let n = 0; n < AI_FLIGHT_STEPS; n++) {
        vy += BALL_G * dt;
        vx *= 1 - 0.05 * dt;
        vy *= 1 - 0.05 * dt;
        { const mgx = -BALL_MAGNUS * w * vy * dt; vy += BALL_MAGNUS * w * vx * dt; vx += mgx; } // spin curves the flight (ball.js): the predictions used to ignore it, so a spinny shot looked like it was going somewhere else
        x += vx * dt;
        y += vy * dt;
        if (y < r) { y = r; if (vy < 0) vy = 0; }
        if (x > W + OUT_D)
            return true;                       // through the threshold line
        if (x > W - PL - r && y < roof)
            return false;                      // hit the jut above the goal
        if (x < 0 || (vx < 30 && n > 20))
            return false;                      // going the wrong way / stalled
        if (x > W)
            continue;                          // in the tunnel: the hatchet bounces anything out
        if (y + r > aiFloorY(x))
            return vx > 230 && x > NETX * 0.6; // floor: only a hard-rolling ball makes it up the ramp
    }
    return false;
}
// ---- aiming zones (from the notes): if the ball is let go now, does it run into an enemy, and how likely is that hit to land? ----
// The Death Ball kills whatever it touches. Enemies are predicted ballistically and never react, so every value is a discount, not a promise.
//   Aerial Point Range  an enemy already in the air can barely steer out of the way: the best hit.
//   Plunge Path Range   a steep ball catches a defender who hops to receive it.
//   Sweep Path Range    a hard ball along the floor traps a grounded defender against it.
// Returns 0 for no hit, else roughly 90..220 (a goal is worth 200 in aiHeldJob). A late hit is worth a little less: they have longer to react.
const AI_HIT_STEPS = 90, AI_HIT_MIN = 110;
function aiBallHit(b, me) {
    const foes = [];
    for (const q of players)
        if (q.team !== me.team && q.alive)
            foes.push({ x: q.x, y: q.y, vx: q.vx, vy: q.vy, r: q.r, air: !q.ground && !q.onBall, g: q.keys && q.keys.up ? G_FLOAT : G });
    if (!foes.length)
        return 0;
    const dt = 1 / 60, r = BALL_R, w = b.w || 0;
    let x = b.x, y = b.y, vx = b.vx, vy = b.vy;
    for (let n = 0; n < AI_HIT_STEPS; n++) {
        vy += BALL_G * dt;
        vx *= 1 - 0.05 * dt;
        vy *= 1 - 0.05 * dt;
        { const mgx = -BALL_MAGNUS * w * vy * dt; vy += BALL_MAGNUS * w * vx * dt; vx += mgx; } // spin curves the flight (ball.js): the predictions used to ignore it, so a spinny shot looked like it was going somewhere else
        x += vx * dt;
        y += vy * dt;
        if (y < r) { y = r; if (vy < 0) vy = 0; }
        if (x < 0 || x > W)
            return 0;
        const fl = aiFloorY(x) - r;
        let rolling = false;
        if (y >= fl) { y = fl; vy = 0; vx *= 1 - BALL_ROLL_DRAG * dt; rolling = true; if (Math.abs(vx) < 40) return 0; }
        for (const e of foes) {
            if (e.air) {
                e.vy += e.g * dt;
                e.x += e.vx * dt;
                e.y += e.vy * dt;
                const ef = aiFloorY(e.x) - e.r;
                if (e.y >= ef) { e.y = ef; e.vy = 0; e.vx = 0; e.air = false; }
            }
            if (Math.hypot(x - e.x, y - e.y) < r + e.r) {
                let v = e.air ? 150 : 90;
                if (vy > 0.8 * Math.abs(vx))
                    v += 30;                   // steep
                else if (rolling && !e.air && Math.abs(vx) > 300)
                    v += 40;                   // hard and low against a grounded enemy
                return v - n * 0.4;
            }
        }
    }
    return 0;
}

// The closest we and the free ball get over the next 0.6 s if we hold this steering (dir -1/0/1, up = jump / float). Both move ballistically (cheap and rough): this is what
// lets the AI see that it is about to fall onto a ball lying on the floor, or that a rolling ball will reach it, and pick the way out.
function aiPathMin(me, b, dir, up, lo, hi) {
    let x = me.x, y = me.y, vx = me.vx, vy = me.vy, grounded = me.ground, bx = b.x, by = b.y, bvx = b.vx, bvy = b.vy, bw = b.w || 0, min = 1e9;
    const dt = 1 / 60;
    if (up && grounded) {
        vy = -JUMP_V;
        grounded = false;
    }
    for (let n = 0; n < 36; n++) {
        if (dir) {
            if (dir * vx < 330)
                vx += dir * RUN_ACC * (grounded ? 1 : 0.55) * (dir * vx < 0 ? 1.4 : 1) * dt;
        } else if (grounded)
            vx *= 1 - GROUND_BRAKE * dt;
        if (!grounded)
            vy += (up ? G_FLOAT : G) * dt;
        x = Math.max(lo, Math.min(hi, x + vx * dt));
        y += vy * dt;
        const f = aiFloorY(x) - me.r;
        grounded = y >= f;
        if (grounded) {
            y = f;
            vy = Math.min(vy, 0);
        }
        bvy += BALL_G * dt;
        { const mgx = -BALL_MAGNUS * bw * bvy * dt; bvy += BALL_MAGNUS * bw * bvx * dt; bvx += mgx; } // spin
        bx += bvx * dt;
        by += bvy * dt;
        const fb = aiFloorY(bx) - BALL_R;
        if (by > fb) {
            by = fb;
            bvy = 0;
            bvx *= 1 - BALL_ROLL_DRAG * dt;
        }
        min = Math.min(min, Math.hypot(x - bx, y - by));
    }
    return min;
}
// When will the free ball reach us (come within 50 u of our x, on its way to our goal)? { t, y } or null. Cheap and rough, like aiThreat.
// ---- which body are we thinking about? ----
// There can be several balls on the field: the death ball and any decoys. A decoy scores like the death ball but never kills. Every prediction and look-ahead below works on ONE body, AIB:
// the one we are tethered to, else the one that will reach our goal soonest, else (if the death ball is not on our half) the nearest decoy on our half, else the death ball. The death ball is the only
// thing that can kill us, so the dodge always watches it, whatever AIB is.
const AI_DECOYS = true;                    // false = decoys are ignored, like before
const AI_TEAMWORK = true;                  // 2v2: only the teammate best placed for a ball goes for it; the other stays clear (false = both pile in, like before)
const AI_SUPPORT_GAP = 140;                // u: the player giving way to a teammate holds position this far behind them (towards our goal) instead of freezing
const AI_YIELD_MARGIN = 20;                // u: a teammate has to be this much closer to the ball before we give way (ties go to the lower player id)
const AI_CEIL_MARGIN = 70, AI_CEIL_PEN = 5; // held plans: penalty per u that we get closer than this to the ceiling (a fast ball on the rope can drag us up there and kill us)
const AI_INVADE = true;                    // 2v2: the player giving way to a teammate may jump over the net and crash into an enemy to throw off their shot / positioning (false = never)
const AI_INVADE_TAPS = [2, 3, 4];          // grapple-jump tap counts the invade search tries
const AI_INVADE_RUNS = [0.4, 0.3, 0.5, 0.2, 0.6, 0.8, 0, 1.0, 1.2]; // seconds of running at the target before the jump (the search tries each)
const AI_INVADE_MIN_V = 180;               // u/s: the closing speed a crash needs to be worth the trip
const AI_INVADE_CD = 5;                    // s between invades
const AI_INVADE_WAIT = 0.8;                // s of backing up a teammate before the first invade
const AI_INVADE_REACH = 560;               // u: only enemies this close (horizontally) are worth a try
const AI_RACE = true;                      // the Shot Race: while holding a ball, weigh our shot against another ball about to score on us (false = ignore the other ball, like before)
const AI_RACE_MARGIN = 4;                  // ticks: our shot has to land at least this long before their ball does to count as winning the race
const AI_DEFEND_LEAD = 40;                 // ticks (~0.33 s) it takes us, once free, to react and jump to a ball coming at our goal
let AIB = ball;
const aiStats = { invades: 0 };            // (for testing)
function aiPickFocus(me, A) {
    if (me.onBall && me.tball)
        return me.tball;
    if ((A.job || A.E || A.X) && A.fb && (A.fb === ball || decoys.includes(A.fb)))
        return A.fb;                       // a look-ahead / jump in progress was planned for this body: keep it
    let best = ball;
    if (AI_DECOYS && decoys.length) {
        const goal = aiLeft(me.team) ? -1 : 1, s = aiSide(me);
        let bt = Infinity, threat = null;
        for (const b of [ball, ...decoys]) {
            const f = aiForecast(b);
            if (f.end === goal && f.path.length < bt) {
                bt = f.path.length;
                threat = b;
            }
        }
        if (threat)
            best = threat;                 // whatever will score on us first is the business at hand
        else if ((ball.x - NETX) * s >= 40) { // the death ball is not on our half: a decoy that is, is a chance
            let bd = Infinity;
            for (const d of decoys)
                if ((d.x - NETX) * s < 40 && Math.hypot(d.x - me.x, d.y - me.y) < bd) {
                    bd = Math.hypot(d.x - me.x, d.y - me.y);
                    best = d;
                }
        }
    }
    return best;
}

// ---- Invade: the back rank jumps over the net and crashes into an enemy ----
// Knocking an enemy around throws off their shot if they have the ball, and drags their positioning about if they do not (while our teammate goes for the ball). The invader needs no ball: a two-tap
// grapple jump off the floor already carries it over the net near the ceiling, and steering in the air does the rest. The search (see aiInvadeJob) rolls candidate jumps forward against a simple
// prediction of where the enemy will be, and only goes if one of them lands a crash that is hard enough.
function aiInvadeKeys(me, en, V, k) {
    V.t += DT;
    const taps = V.taps, jt = V.t - (V.run || 0);  // jt: time since the jump started (negative while still running up)
    const dx = en.x - me.x;
    if (jt < 0) {                              // the run-up
        if (Math.abs(dx) > 10)
            k[dx > 0 ? 'r' : 'l'] = true;
        return;
    }
    k.up = jt < Math.max(AI_JUMP_HOLD, taps * AI_TAP_T + 0.35);
    if (taps) {
        const i = Math.floor(jt / AI_TAP_T);
        k.z = i < taps && jt - i * AI_TAP_T < AI_TAP_ON;
        k.x = jt < taps * AI_TAP_T;
    }
    const dy = en.y - me.y;
    if (me.ground || jt < taps * AI_TAP_T + 0.15 || dy < 20) {
        if (Math.abs(dx) > 10)                 // taking off (or already level with them): head for them
            k[dx > 0 ? 'r' : 'l'] = true;
        return;
    }
    // Up in the air above them: dive when a dive from here would land on them (the dive falls at DOWN_G x G), and steer so that it does.
    const g = G * DOWN_G, tf = (-me.vy + Math.sqrt(me.vy * me.vy + 2 * g * dy)) / g, miss = dx - me.vx * tf; // (time to fall dy from where we are, with the speed we have)
    if (Math.abs(miss) < 30) {
        k.up = false;
        k.dn = true;
        if (Math.abs(miss) > 8)
            k[miss > 0 ? 'r' : 'l'] = true;
    } else {
        k.up = true;                           // float and line it up
        k[miss > 0 ? 'r' : 'l'] = true;
    }
}
// A plain-object stand-in for an enemy player: moves under gravity, stops on the floor, and keeps its current velocity otherwise.
const aiEnemySnap = e => ({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, r: e.r, up: !!(e.keys && e.keys.up) });
function aiEnemyStep(en) {
    const fl = aiFloorY(en.x) - en.r;
    if (en.y < fl - 1)
        en.vy += (en.up ? G_FLOAT : G) * DT;
    en.x = Math.max(en.r, Math.min(W - en.r, en.x + en.vx * DT));
    en.y += en.vy * DT;
    const f2 = aiFloorY(en.x) - en.r;
    if (en.y >= f2) {
        en.y = f2;
        en.vy = 0;
        en.vx *= 1 - GROUND_BRAKE * DT;
    }
}
function* aiInvadeJob(me0, frozen, tgt, out) {
    const S = aiSimNew(me0), en0 = aiEnemySnap(tgt);
    let n = 0;
    for (let i = 0; i < AI_PRE; i++) {         // the real AI carries on with `frozen` while this runs
        aiSimStep(S, frozen);
        aiEnemyStep(en0);
        if (aiDead(S))
            return;
    }
    let bestV = 0;
    for (const run of AI_INVADE_RUNS) for (const taps of AI_INVADE_TAPS) {
        const V = aiSimFork(S), en = Object.assign({}, en0), I = { t: 0, taps, run };
        for (let i = 0; i < 420; i++) {
            const k = aiNoKeys();
            aiInvadeKeys(V.me, en, I, k);
            const sc = aiSimStep(V, k);
            aiEnemyStep(en);
            if (aiDead(V) || (sc !== null && sc !== V.me.team))
                break;                         // the death ball got us, or it scored on us meanwhile
            if (Math.hypot(V.me.x - en.x, V.me.y - en.y) < V.me.r + en.r + 2) {
                const rv = Math.hypot(V.me.vx - en.vx, V.me.vy - en.vy);
                if (rv >= AI_INVADE_MIN_V) {       // good enough: take it (the AI stands still while this runs, so a quick answer matters more than the best one)
                    out.ok = true;
                    out.taps = taps;
                    out.run = run;
                    out.v = rv;
                    return;
                }
                break;
            }
            if (V.me.ground && I.t > run + 0.3)
                break;                         // landed without a crash
            if (++n % AI_SLICE === 0)
                yield;
        }
    }
}
// Who is worth crashing into: a holder first (spoil the shot), else whoever is nearest the ball.
function aiInvadeTarget(me, b) {
    let best = null, bs = -Infinity;
    for (const e of players) {
        if (e.team === me.team || !e.alive || Math.abs(e.x - me.x) > AI_INVADE_REACH)
            continue;
        const sc = (e.onBall ? 1000 : 0) - Math.hypot(e.x - b.x, e.y - b.y) * 0.5 - Math.abs(e.x - me.x) * 0.2;
        if (sc > bs) {
            bs = sc;
            best = e;
        }
    }
    return best;
}
// Safe to leave our half: nothing is going to score on us, and the death ball is not on top of us.
function aiInvadeSafe(me) {
    const goal = aiLeft(me.team) ? -1 : 1;
    for (const b of [ball, ...decoys])
        if (aiForecast(b).end === goal)
            return false;
    return Math.hypot(ball.x - me.x, ball.y - me.y) > 320 || Math.hypot(ball.vx, ball.vy) < 120; // (a ball lying around near us is no danger; one moving about near us is)
}

// ---- teamwork (2v2) ----
// Should we leave this ball to a teammate? Yes if they are holding it, or are clearly better placed for it (and able to grapple). Two defenders going for the same ball get in each other's way.
function aiYield(me, b) {
    const dm = Math.hypot(b.x - me.x, b.y - me.y);
    for (const t of players) {
        if (t === me || t.team !== me.team || !t.alive)
            continue;
        if (t.onBall && t.tball === b)
            return t;                          // they have it
        if (!aiCanGrip(t))
            continue;                          // they cannot grapple right now: no use leaving it to them
        const dt = Math.hypot(b.x - t.x, b.y - t.y);
        if (dt + AI_YIELD_MARGIN < dm || (dt <= dm + AI_YIELD_MARGIN && t.id < me.id))
            return t;
    }
    return null;
}

// ---- the Shot Race ----
// The earliest OTHER body (not the one we hold) that will score on us if nobody touches it: { T: ticks from now, at(t): where it is t ticks from now }, or null.
function aiOtherThreat(me) {
    const goal = aiLeft(me.team) ? -1 : 1, sd = aiSide(me);
    let best = null;
    for (const b of [ball, ...decoys]) {
        if (b === me.tball)
            continue;
        const f = aiForecast(b), off = aiTickN - f.stamp, T = f.path.length - off;
        if (f.end !== goal || T <= 0 || (best && T >= best.T))
            continue;
        let D = 0;                             // ticks until it gets past us (within 50 u of our x): after that it is out of our reach, so that is our real deadline, not the goal
        while (D < f.path.length && (f.path[D].x - me.x) * sd >= 50)
            D++;
        D = Math.max(0, D - off);
        if (D === 0)
            D = T;                             // already past us (between us and our goal): we can only chase it, and the deadline is when it scores
        best = { T, D, at: t => f.path[Math.max(0, Math.min(f.path.length - 1, t + off - 1))] };
    }
    return best;
}
// Free from tick `relT` on, standing at x, can we still get to the threat before it scores? (we need AI_DEFEND_LEAD ticks to react and jump, and can run ~250 u/s on the way)
function aiCanReceive(R, x, relT) {
    const spare = R.D - AI_DEFEND_LEAD - relT;
    if (spare <= 0)
        return false;
    const p = R.at(R.D - AI_DEFEND_LEAD);
    return Math.abs(p.x - x) < 250 * spare * DT + RANGE * 0.8;
}
// Uncached: if this body is left alone, does it score, and in how many ticks? { end: -1 / 0 / +1, steps }
function aiRollEnd(body) {
    const b = Object.assign(new Ball(), body);
    for (let i = 0; i < AI_FC_STEPS; i++) {
        const sc = b.step();
        if (sc !== null || aiInGoal(b))
            return { end: b.x < W / 2 ? -1 : 1, steps: i + 1 };
    }
    return { end: 0, steps: Infinity };
}

// ---- the free ball's future, by the REAL ball physics ----
// The hand-written predictors above (aiArrival, aiFlight ...) are quick but they leave things out: how a spinning ball grips the floor, the jut, the slopes, pegs. For the question "is this shot
// coming at my goal, and when does it get here" the AI therefore steps a copy of the real ball forward (nobody touching it) and reads the answer off that. Shared by all AIs, and redone only
// every few ticks (or when the ball is hit / bounces off its predicted path).
// Inside a goal mouth (past the line, between the posts): it will score, so the forecast calls it a goal as soon as that happens (the real score only comes when it has rolled to the back of the alcove).
const aiInGoal = b => (b.x < -8 || b.x > W + 8) && b.y > GOAL_Y0 && b.y < GOAL_Y1;
const AI_FC_STEPS = 300, AI_FC_EVERY = 20; // (re-forecast a body every 20 ticks at most, and at most one body per tick; a body that leaves its predicted path is re-done at once)
let aiFcDoneTick = -1;
let aiTickN = 0, aiLastI = 99;
const aiFcMap = new Map();                 // body -> its forecast (the death ball and every decoy get one)
const AI_NO_FC = { stamp: 0, path: [], end: 0 };
function aiForecast(body = AIB) {
    for (const p of players)
        if (p.onBall && p.tball === body && p.alive)
            return AI_NO_FC;                   // somebody has it on a rope: its path is not free, so there is nothing to forecast (it would also be redone every tick)
    let f = aiFcMap.get(body);
    if (f && f.stamp === aiTickN)
        return f;
    if (f) {
        const q = f.path[Math.min(aiTickN - f.stamp - 1, f.path.length - 1)];
        if (q && Math.hypot(q.vx - body.vx, q.vy - body.vy) < 25 && Math.hypot(q.x - body.x, q.y - body.y) < 12
            && (aiTickN - f.stamp < AI_FC_EVERY || aiFcDoneTick === aiTickN))
            return f;                          // still on the predicted path (and not yet due for a refresh, or another body already used this tick's refresh)
    }
    aiFcDoneTick = aiTickN;
    const b = Object.assign(new Ball(), body), path = [];
    let end = 0;                               // -1 = into the left goal, +1 = into the right goal, 0 = neither within the look-ahead
    for (let i = 0; i < AI_FC_STEPS; i++) {
        const sc = b.step();
        path.push({ x: b.x, y: b.y, vx: b.vx, vy: b.vy });
        if (sc !== null || aiInGoal(b)) {
            end = b.x < W / 2 ? -1 : 1;
            break;
        }
    }
    f = { stamp: aiTickN, path, end };
    if (aiFcMap.size > 8)
        for (const k of aiFcMap.keys())
            if (k !== ball && !decoys.includes(k))
                aiFcMap.delete(k);             // forget bodies that are gone
    aiFcMap.set(body, f);
    return f;
}
function aiArrival(me) {
    const s = aiSide(me);
    if (AIB.vx * s > -90 || (AIB.x - me.x) * s < 0)
        return null;                           // not coming at us (or already past)
    const path = aiForecast().path;
    for (let n = 0; n < path.length; n++)
        if ((path[n].x - me.x) * s < 50)
            return { t: (n + 1) * DT, y: path[n].y };
    return null;
}

// The steering that keeps us furthest from the free ball over the next 0.6 s, or null if it is not going to reach us (the DODGE tactic, shared with the held-plan look-ahead below so that a plan that
// lets go of the ball is judged with the dodge the AI will really do afterwards, not as if it stood frozen).
function aiDodge(me, b, lo, hi) {
    if (Math.hypot(b.x - me.x, b.y - me.y) > 420 || aiPathMin(me, b, 0, false, lo, hi) >= AI_THREAT)
        return null;
    let best = null, bestD = -1;
    for (const dir of [0, -1, 1])
        for (const up of [false, true]) {
            const d = aiPathMin(me, b, dir, up, lo, hi) + (dir === 0 ? 4 : 0) + (up || !AI_LOW ? 0 : 14);
            if (d > bestD) {
                bestD = d;
                best = { dir, up };
            }
        }
    return best;
}

// Would grabbing the ball RIGHT NOW (from the air) and then holding it be survivable? One rollout, like a trial in the jump search: latch next tick, then the 'hold' plan.
function aiAirGrabSafe(me) {
    const V = aiSimNew(me), hs = { t: 0, dashT: null, plan: 'hold' };
    let latched = false;
    for (let i = 0; i < AI_SAFE_STEPS; i++) {
        const k = aiNoKeys();
        if (V.me.onBall) {
            latched = true;
            aiHeldKeys(V.me, V.b, hs, k);
        } else
            k.z = true;
        if (aiSimStep(V, k) !== null || aiDead(V))
            return false;
        if (i === 3 && !latched)
            return false;                      // the press did not take the ball (something else was nearer)
    }
    return latched;
}

// ---- tactics ----
const AI_GRIP_MIN = 1.6, AI_FLOAT_T = 0.5, AI_JUMP_HOLD = 0.6, AI_STAND = 90, AI_STANDS = [90, 130, 70, 160, 110], AI_HOLD_MAX = 1.6;
const AI_SLICE = 96, AI_PRE = 8;          // jump jobs: physics steps per tick, and the ticks of latency they plan around
const AI_SLICE_H = 48, AI_PRE_H = 24;      // held-plan jobs: bigger, because they must finish within their latency window (AI_PRE_H ticks) to be about the moment they land
const AI_JUMP_STEPS = 180, AI_SAFE_STEPS = 84, AI_HELD_STEPS = 96, AI_AFTER_STEPS = 72, AI_LOOP_STEPS = 180, AI_LOOP_MAX = 2.4, AI_STALL_MAX = 2.2; // look-ahead lengths (steps): a jump, the safe time after latching, a held plan, the time after a release
const AI_WAIT_FRAC = 0.5; // where the AI waits when the ball is not its business: 0 = against the net, 0.5 = the midline of its half (the book's Midline Defense), 1 = at its goal. (The old spot was 90 u from the net, about 0.19.)
const aiMid = me => NETX - aiSide(me) * AI_WAIT_FRAC * NETX;
// Grapple-jump launches: tap the grapple on the floor with weight held (weight multiplies the kick, and each tap within 1.5 s of the last makes the next one stronger and adds to our
// upward speed), then fly up with jump held. n taps reach higher, faster, than a plain jump; the look-ahead decides which n works.
const AI_TAP_T = 0.17, AI_TAP_ON = 0.13; // one tap every 0.17 s, the grapple down for 0.13 s (the hook needs 0.1 s to land)
const aiSide = me => (aiLeft(me.team) ? 1 : -1); // +1: we defend the left goal and attack to the right
const aiNoKeys = () => ({ l: false, r: false, up: false, dn: false, z: false, x: false, sp: false, sp2: false });
const aiNearest = (me, b) => me.candidates(me.sim ? b : ball).reduce((m, o) => (!m || o.d < m.d ? o : m), null); // (a planning copy only knows the body it plans with; the real game also offers the death ball and every decoy)
const aiCanDash = (me, hs) => me.special === 'dash' && me.dashReady && me.cd.dash <= 0 && !(hs && hs.noDash); // hs.noDash: this latch shoots with the rope only
const aiCanGrip = me => me.gCool <= 0 && me.gCharge > AI_GRIP_MIN; // the grapple meter: enough left to latch on and do something with it

// Keys for a tethered AI. hs = { t: seconds since the latch, plan, dashT: when we dashed (or null), n: tick counter }.
function aiHeldKeys(me, b, hs, k) {
    const s = aiSide(me), tb = me.tball || b, plan = hs.plan || 'hold', dashPlan = plan === 'shootF' || plan === 'shootU', shoot = dashPlan || plan === 'sling' || plan === 'slingU', loop = plan === 'loopO' || plan === 'loopU';
    hs.t += DT;
    hs.n = (hs.n || 0) + 1;
    k.z = plan !== 'drop';                     // 'drop' = let go right now (the ball is about to get us)
    const room = (NETX - tb.x) * s, homeDist = aiLeft(me.team) ? tb.x : W - tb.x; // room: how far the ball is onto our side of the net; homeDist: its distance from our goal line
    const pulling = plan === 'pull' && room < AI_PULL_ROOM && hs.t < AI_PULL_MAX && homeDist > NETX * AI_GOAL_BUFFER + 40; // a pull only exists to get the ball off the middle: once there is room for a shot, running home any longer just whips the ball round us and into our own goal
    const dir = plan === 'pull' ? (pulling ? -s : 0) : plan === 'hold' ? 0 : s;
    k.r = dir > 0;
    k.l = dir < 0;
    k.up = shoot ? (plan === 'sling' ? hs.t < 0.5 : plan === 'slingU' ? hs.t < 0.9 : hs.t < 0.15 && hs.dashT === null && plan === 'shootF') : hs.t < AI_FLOAT_T; // otherwise float (jump held) just after the latch, so we stay up over the ball while the rope drags it about; then come down (the dash only recharges on the ground)
    if (loop) { // orbit the ball: keep moving along the circle we are on (osL = over the top, usL = underneath), floating whenever the circle is going up
        const rx = me.x - tb.x, ry = me.y - tb.y, d = Math.hypot(rx, ry) || 1, sp = plan === 'loopO' ? s : -s;
        const tx = sp * -ry / d, ty = sp * rx / d; // unit tangent: which way we have to move to keep going round
        k.r = tx > 0.3;
        k.l = tx < -0.3;
        k.up = ty < 0.3;
    }
    if (dashPlan && hs.dashT === null && hs.t >= 0.04 && aiCanDash(me, hs)) { // the dash direction is whatever arrows are held when the key goes down
        k.sp = true;
        k.up = plan === 'shootU';
        k.r = s > 0;
        k.l = s < 0;
        hs.dashT = hs.t;
    }
    else if (AI_LOOP_DASH && loop && hs.dashT === null && hs.t >= 0.3 && aiCanDash(me, hs)) { // dash along the orbit's tangent to keep the loop fast
        const rx = me.x - tb.x, ry = me.y - tb.y, d = Math.hypot(rx, ry) || 1, sp = plan === 'loopO' ? s : -s, tx = sp * -ry / d, ty = sp * rx / d;
        k.sp = true; k.r = tx > 0.3; k.l = tx < -0.3; k.up = ty < -0.3; k.dn = ty > 0.3;
        hs.dashT = hs.t;
    }
    if ((shoot || loop) && hs.n % 2 === 0 && (hs.dashT !== null ? hs.t - hs.dashT > 0.14 : hs.t > (loop ? 0.35 : 0.4)) && (aiFlight(tb, me.team) || aiBallHit(tb, me) >= AI_HIT_MIN))
        k.z = false;                           // it will score (or hit an enemy that cannot get out of the way): let go
    else if (hs.t > (loop ? AI_LOOP_MAX : AI_HOLD_MAX) && (plan !== 'pull' || !pulling) && plan !== 'push' && !aiRisky(tb, me))
        k.z = false;                           // could not line it up: give it up (but never into a bad spot: only a meter about to run out lets go of a ball that would end up in or near our goal)
    else if (hs.t > AI_STALL_MAX && plan === 'push' && !aiRisky(tb, me))
        k.z = false;                           // carried it as far as it goes: toss it
    else if (me.gCharge < 0.15)
        k.z = false;                           // the meter is about to tear it away anyway: let go on our own terms
    if (hs.rescue !== undefined && hs.t > hs.rescue && !aiRisky(tb, me))
        k.z = false;                           // a rescue grab: it only had to bleed off the ball's speed. (Only let go if the ball is then somewhere safe: a slow ball left rolling towards our goal is just a goal a moment later; the normal plans take over instead.)
}
// Keys during an engage jump (before the grapple latches). E = { t, mode: 'toward' | 'none' | 'away' }.
function aiEngageKeys(me, b, E, k) {
    E.t += DT;
    const taps = E.taps || 0;
    k.up = E.t < Math.max(AI_JUMP_HOLD, taps * AI_TAP_T + 0.35);
    if (taps) {
        const i = Math.floor(E.t / AI_TAP_T);
        k.z = i < taps && E.t - i * AI_TAP_T < AI_TAP_ON;
        k.x = E.t < taps * AI_TAP_T;         // weighted kicks
    }
    const dx = b.x - me.x;
    if (E.mode === 'toward' && Math.abs(dx) > 50)
        k[dx > 0 ? 'r' : 'l'] = true;
    else if (E.mode === 'away' && Math.abs(dx) < 130)
        k[dx > 0 ? 'l' : 'r'] = true;      // too close to latch from here: open the gap while we rise
    if (!me.ground && Math.hypot(dx, b.y - me.y) < RANGE + 30) { // (candidates() is the expensive part, so only ask when the ball could be in reach)
        const near = aiNearest(me, b);
        if (near && near.b && near.ball === b) // the body we are after is the nearest thing in reach: latch on.
            k.z = !((me.rope || me.pending) && !me.onBall); // (A held grapple never re-targets: if the tap jump left us hooked to the floor, let go for a tick so the next press takes the ball. Before this, a ball that arrived while we hung on a floor rope flew past un-grabbed.)
    }
}

// ---- crossing: hop over a slow ball that is behind us, so the shot can start from behind it ----
// Our overhand shot starts BEHIND the ball (the side nearer our own goal): jump over it, grapple it as we go, swing it up and over and let go toward their goal. When the ball is between us and
// our own goal we first have to get round it. The only way past a ball that kills on touch is over it, so: jump, drift toward our own goal, land behind it. aiCrossJob plays that forward on a
// copy of the game with a few jump lengths and only commits to one that never touches the ball and lands clear of it.
const AI_PRE_X = 2, AI_SLICE_X = 192;      // the plain hop is a standing jump: it needs almost no 'ticks of latency' to plan around (AI_PRE = 8 made it stand and think), and its rollouts are short, so they can be run in bigger slices
const AI_CROSS_MIN_GAP = 46;               // u: a hop over the ball must stay at least this far from it (contact is ~32: the old 34 left 2 u, and the real jump never starts exactly where the plan assumed)
const AI_CROSS_HOLDS = [0.7, 1.1, 1.6], AI_CROSS_CLEAR = 40, AI_CROSS_ROOM = 150; // how long the jump key is held (s), and how far behind the ball we must land (u)
function aiCrossKeys(me, X, k) {
    X.t += DT;
    k.up = X.t < X.hold;
    k[aiSide(me) > 0 ? 'l' : 'r'] = true;   // toward our own goal
}
function* aiCrossJob(me0, frozen, out, pre = AI_PRE) {
    const S = aiSimNew(me0), s = aiSide(me0);
    let n = 0;
    for (let i = 0; i < pre; i++) {         // the real AI carries on with `frozen` while this runs
        aiSimStep(S, frozen);
        if (aiDead(S))
            return;
    }
    const trial = function* (hold, jx, jv) {   // one hop from a start nudged by jx (position) / jv (speed): does it clear the ball by a real margin and land behind it?
        const V = aiSimFork(S), X = { t: 0, hold };
        V.me.x += jx;
        V.me.vx += jv;
        let minD = 1e9;
        for (let i = 0; i < 300; i++) {
            const k = aiNoKeys();
            aiCrossKeys(V.me, X, k);
            const sc = aiSimStep(V, k);
            if (aiDead(V) || (sc !== null && sc !== V.me.team))
                return false;                  // it got us, or it went in our goal anyway
            minD = Math.min(minD, aiGap(V));
            if (V.me.ground && X.t > 0.3)
                return minD > AI_CROSS_MIN_GAP && (V.me.x - V.b.x) * s < -AI_CROSS_CLEAR; // landed: clear, and behind it?
            if (++n % AI_SLICE_X === 0)
                yield;
        }
        return false;
    };
    const calm = Math.hypot(S.b.vx, S.b.vy) < 40; // a ball lying still: one rollout and the clearance margin are enough; a moving one is only trusted if the hop also works from a slightly different start
    for (const hold of AI_CROSS_HOLDS)
        if ((yield* trial(hold, 0, 0)) && (calm || ((yield* trial(hold, 6, 35)) && (yield* trial(hold, -6, -35))))) {
            out.ok = true;
            out.hold = hold;
            return;
        }
}

// ---- look-ahead jobs ----
function aiSimNew(me0) {
    const b = Object.assign(new Ball(), AIB), me = aiClone(me0), foes = [];
    if (me.tball)
        me.tball = me.tball === AIB ? b : Object.assign(new Ball(), me.tball);
    for (const q of players)                   // an enemy tethered to the ball too (tug of war): their rope matters, keys frozen
        if (q !== me0 && q.team !== me0.team && q.alive && q.onBall && q.tball === AIB) {
            const f = aiClone(q);
            f.tball = b;
            foes.push(f);
        }
    return { me, b, foes };
}
function aiSimFork(S) {
    const b = Object.assign(new Ball(), S.b), me = aiClone(S.me);
    if (S.me.tball)
        me.tball = b;
    return { me, b, foes: S.foes.map(f => { const c = aiClone(f); c.tball = b; return c; }) };
}
function aiSimStep(S, k) { // one physics step; returns the scoring team if the ball scored
    Object.assign(S.me.keys, k);
    for (const f of S.foes)
        f.step(S.b);
    S.me.step(S.b);
    const sc = S.b.step(); // the SIDE that scored (0 = the left team's end), not the team: after a side swap they differ
    return sc === null ? null : sideSwap(sc);
}
const aiGap = S => Math.hypot(S.me.x - S.b.x, S.me.y - S.b.y);
const aiDead = S => aiGap(S) < S.me.r + S.b.r + 2;

function* aiJumpJob(me0, frozen, delays, modes, out, styles = [0], robust = false, rescue = false) { // do we latch onto the ball, without touching it, if we jump after one of these delays (in ticks, most likely first)?
    const W = aiSimNew(me0), snaps = {}, asc = [...delays].sort((p, q) => p - q); // the waiting copy: walks on with `frozen` keys for AI_PRE ticks, then stands still
    let n = 0, t = 0;
    for (const d of asc) {                     // one pass to get the state at each delay
        while (t < d) {
            aiSimStep(W, t < AI_PRE ? frozen : aiNoKeys());
            t++;
            if (aiDead(W))
                break;                         // the ball gets us while we wait: later delays are hopeless
            if (++n % AI_SLICE === 0)
                yield;
        }
        if (aiDead(W))
            break;
        snaps[d] = aiSimFork(W);
    }
    // One rollout: if we jump from `snap` with this steering and tap count, do we latch onto the ball and stay clear of it? jx / jv nudge the start (position / speed): the real jump never starts
    // exactly where the plan assumed (a tick or two of lag), and a latch is often a knife edge (the grapple takes whatever is nearest, and the ball only just beats the floor), so a jump
    // is trusted (when `robust`) only if it also works from a slightly different start.
    const trial = function* (snap, mode, taps, jx, jv) {
        const V = aiSimFork(snap), E = { t: 0, mode, taps }, hs = { t: 0, dashT: null, plan: 'hold' };
        V.me.x += jx;
        V.me.vx += jv;
        let latchedAt = -1, minD = 1e9, prevGap = 1e9;
        for (let i = 0; i < AI_JUMP_STEPS; i++) {
            const k = aiNoKeys();
            if (V.me.onBall) {
                if (latchedAt < 0)
                    latchedAt = i;
                aiHeldKeys(V.me, V.b, hs, k);
            } else
                aiEngageKeys(V.me, V.b, E, k);
            const sc = aiSimStep(V, k);
            if (aiDead(V) || (sc !== null && sc !== V.me.team))
                return false;                  // it got us, or it went in our goal anyway
            const gap = aiGap(V);
            minD = Math.min(minD, gap);
            if (latchedAt < 0 && !V.me.ground && gap > RANGE + 30 && gap > prevGap)
                return false;                  // out of reach and still drifting apart (a tap jump that has shot past the ball): it cannot latch any more, so stop here and let the search move on.
                                               // Without this every failed candidate ran the whole look-ahead, the job finished after the moment it was planning for, and the AI fell back to a dodge hop.
            prevGap = gap;
            if (latchedAt >= 0 && i - latchedAt >= AI_SAFE_STEPS)
                return minD > 36 && !aiFlight(V.b, 1 - V.me.team);
            if (latchedAt < 0 && V.me.ground && E.t > 0.3)
                return false;                  // landed without latching
            if (++n % AI_SLICE === 0)
                yield;
        }
        return false;
    };
    // ---- RESCUE rollouts (tried per delay, right after the clean ones fail: nothing 'clean' latches, but the ball is on course for our goal. Accept a grab that only just clears the ball (a graze), holds a moment to bleed its speed, then lets go.
    // Score of a rollout: 1000 = we live and the ball does NOT end up in our goal; otherwise minus the ball's speed toward our goal when it gets there (a slowed ball is still better: it gives the
    // hatchet, the ramp or a teammate time to deal with it); -Infinity = we never latched, or the ball killed us.
    const s = aiSide(me0), rtrial = function* (snap, mode, taps, hold) {
        const V = aiSimFork(snap), E = { t: 0, mode, taps }, hs = { t: 0, dashT: null, plan: 'hold', rescue: hold };
        let latched = false, since = 0, prevGap = 1e9;
        const soft = () => -Math.max(0, -V.b.vx * s);
        for (let i = 0; i < AI_JUMP_STEPS + AI_RESCUE_AFTER + 60; i++) {
            const k = aiNoKeys();
            if (V.me.onBall) {
                latched = true;
                aiHeldKeys(V.me, V.b, hs, k);
            } else if (!latched)
                aiEngageKeys(V.me, V.b, E, k);
            const sc = aiSimStep(V, k);
            const gap = aiGap(V);
            if (gap < V.me.r + V.b.r + AI_RESCUE_MARGIN)
                return -Infinity;              // it still must not touch us
            if (sc !== null)
                return sc === V.me.team ? 1000 : latched ? soft() : -Infinity;
            if (!latched && !V.me.ground && gap > RANGE + 30 && gap > prevGap)
                return -Infinity;              // out of reach and drifting apart
            prevGap = gap;
            if (!latched && V.me.ground && E.t > 0.3)
                return -Infinity;              // landed without latching
            if (latched && V.me.onBall && hs.t > hold && aiRisky(V.b, V.me))
                return soft() - 100;           // slowed it but it would still end up in / near our goal if we let go: worth grabbing, and the normal plans carry on from there
            if (latched && !V.me.onBall && ++since >= AI_RESCUE_AFTER)
                return aiRisky(V.b, V.me) ? soft() - 100 : 1000;
            if (++n % AI_SLICE === 0)
                yield;
        }
        return -Infinity;
    };
    let best = null;
    for (const d of delays) {                  // then try the most likely one first, and stop at the first that works
        if (!snaps[d] || d < (out.now || 0) + 2)
            continue;
        for (const taps of styles) for (const mode of modes) {
            if (!(yield* trial(snaps[d], mode, taps, 0, 0)))
                continue;
            if (robust && (!(yield* trial(snaps[d], mode, taps, 5, 30)) || !(yield* trial(snaps[d], mode, taps, -5, -30))))
                continue;                      // a knife edge: not good enough (only asked of a calm approach: against an incoming shot a marginal jump beats none)
            out.ok = true;
            out.mode = mode;
            out.taps = taps;
            out.delay = d;
            return;
        }
        if (!rescue)
            continue;
        // No clean jump at this delay. Try the rescue grabs for the SAME delay before moving to a later one: the clean search is slow, and by the time it has run through every delay the early,
        // useful ones are in the past (the ball is already on us).
        for (const taps of AI_RESCUE_STYLES) for (const mode of modes) for (const hold of AI_RESCUE_HOLDS) {
            if (d < (out.now || 0) + 2)
                break;
            const sc = yield* rtrial(snaps[d], mode, taps, hold);
            if (sc >= 1000) {
                Object.assign(out, { ok: true, mode, taps, delay: d, rescue: hold });
                return;
            }
            if (sc > -Infinity && (!best || sc > best.sc))
                best = { sc, mode, taps, delay: d, rescue: hold };
        }
    }
    if (best && best.delay >= (out.now || 0) + 2)  // nothing saves it outright, but a grab that slows it beats a dodge
        Object.assign(out, { ok: true, mode: best.mode, taps: best.taps, delay: best.delay, rescue: best.rescue });
}
function* aiHeldJob(me0, hs0, out) { // the best held plan from here (after the ticks this job takes)
    const S = aiSimNew(me0), hs = { ...hs0 }, plans = aiCanDash(me0, hs0) ? ['shootU', 'shootF', 'sling', 'loopO', 'loopU', 'pull', 'push', 'hold', 'drop'] : ['sling', 'slingU', 'loopO', 'loopU', 'pull', 'push', 'hold', 'drop'], s = aiSide(me0), x0 = S.b.x;
    let n = 0;
    const R = out.race || null, atk = aiLeft(me0.team) ? 1 : -1; // R: another body about to score on us (see aiOtherThreat); atk: the goal we attack
    for (let i = 0; i < AI_PRE_H; i++) {       // we carry on with the current plan meanwhile
        const k = aiNoKeys();
        aiHeldKeys(S.me, S.b, hs, k);
        aiSimStep(S, k);
        if (aiDead(S)) {                       // the current plan gets us before a new one could take over: let go of it now, and hope
            out.plan = 'drop';
            return;
        }
        if (!S.me.onBall)
            return;
        if (++n % AI_SLICE_H === 0)
            yield;
    }
    let bestV = -Infinity;
    const vals = {};                           // each plan's value before the stay-with-it bonus
    for (const plan of plans) {
        const V = aiSimFork(S), h = { ...hs, plan };
        let minD = 1e9, minY = 1e9, minHome = 1e9, v = null, relT = Infinity, scoreT = Infinity, relX = 0, dead = false; // minHome: the ball's closest approach to our goal line
        const steps = plan === 'loopO' || plan === 'loopU' ? AI_LOOP_STEPS : AI_HELD_STEPS; // a loop needs time to come round
        for (let i = 0; i < steps && v === null; i++) {
            const k = aiNoKeys();
            if (!V.me.onBall) {                // let go: where does it go, and does it then hit us?
                relT = AI_PRE_H + i;
                relX = V.me.x;
                const rest = aiRestFromOwn(V.b, V.me.team);   // a toss that ends up upfield is a fine thing to do with a ball we cannot score with; dropping it near our own goal is not
                const restV = rest > NETX + 40 ? 30 : rest > NETX * 0.6 ? 0 : -60 * (1 - rest / (NETX * 0.6));
                v = Math.max(aiFlight(V.b, V.me.team) ? 200 - i * 0.05 : -40 + restV, aiBallHit(V.b, V.me) - 40) - (aiFlight(V.b, 1 - V.me.team) ? 300 : 0);
                let dk = null;
                for (let j = 0; j < AI_AFTER_STEPS; j++) {
                    if (j % 8 === 0) {                 // after letting go the AI dodges (see aiFree): judge the release with that, not with the AI standing frozen
                        dk = Math.hypot(V.b.x - V.me.x, V.b.y - V.me.y) < 170 ? aiDodge(V.me, V.b, V.me.r, W - V.me.r) : null;
                        n += 6;                        // (that look-ahead is not free: count it against the slice)
                    }
                    const kk = aiNoKeys();
                    if (dk) {
                        kk.l = dk.dir < 0;
                        kk.r = dk.dir > 0;
                        kk.up = dk.up;
                    }
                    const sc = aiSimStep(V, kk);
                    minD = Math.min(minD, aiGap(V));
                    minY = Math.min(minY, V.me.y);
                    minHome = Math.min(minHome, aiLeft(V.me.team) ? V.b.x : W - V.b.x);
                    if (aiDead(V)) {
                        v -= 1000;
                        dead = true;
                        break;
                    }
                    if (sc !== null) {
                        if (sc === V.me.team)
                            scoreT = relT + j + 1;
                        else
                            v -= 500;                  // the release ended in OUR goal (the swing / the toss went in): as bad as it gets
                        break;
                    }
                    if (++n % AI_SLICE_H === 0)
                        yield;
                }
                if (R && !dead && scoreT === Infinity) { // did not score inside the look-ahead: does it still, later? (only worth knowing in a race)
                    const e = aiRollEnd(V.b);
                    if (e.end === atk)
                        scoreT = relT + AI_AFTER_STEPS + e.steps;
                }
                break;
            }
            aiHeldKeys(V.me, V.b, h, k);
            const sc = aiSimStep(V, k);
            if (aiDead(V)) {
                v = -1000 + i;
                break;
            }
            if (sc !== null) {
                v = sc === V.me.team ? 250 : -500;
                if (sc === V.me.team)
                    scoreT = AI_PRE_H + i + 1;
                break;
            }
            minD = Math.min(minD, aiGap(V));
            minY = Math.min(minY, V.me.y);
            minHome = Math.min(minHome, aiLeft(V.me.team) ? V.b.x : W - V.b.x);
            if (++n % AI_SLICE_H === 0)
                yield;
        }
        if (v === null) {                      // never let go within the look-ahead
            v = 0;
            const room = (NETX - V.b.x) * s;   // how much room there is between the ball and the net, on our side
            if (plan === 'pull')
                v += room < 110 ? Math.max(0, room) * 0.3 : -40; // worth it only until there is room behind the ball for a shot
            else if (plan === 'push')
                v += room > 150 ? Math.min(45, (V.b.x - x0) * s * 0.12) : -30; // carry it upfield when it is stuck far back
            else if (plan !== 'hold')
                v -= 30;                       // never got to shoot (shootF / shootU / loops)
            if (V.b.vx * s < -60 && (V.b.x - (s > 0 ? 0 : W)) * s < 260)
                v -= 120;                      // heading for our own goal
        }
        if (R) {                               // THE SHOT RACE: another body is about to score on us
            if (relT < Infinity) {             // this plan lets go at relT
                const rec = aiCanReceive(R, relX, relT);
                if (scoreT + AI_RACE_MARGIN < R.T)
                    v += 100 + (rec ? 60 : 0); // our shot lands first: go for it (best of all if we can still pick up the receive)
                else
                    v = rec ? Math.min(v, -10) - relT * 0.05 : v - 400; // our shot is too slow: it is worth nothing now; what counts is being free in time to deal with theirs
            } else if (AI_PRE_H + steps >= R.D - AI_DEFEND_LEAD)
                v -= 400;                      // still holding on when their ball arrives: it scores while we are tied up
            out.race = true;
        }
        if (minD < 44)
            v -= (44 - minD) * 8;
        if (minHome < NETX * AI_GOAL_BUFFER)
            v -= (NETX * AI_GOAL_BUFFER - minHome) * AI_GOAL_PEN; // dragged or swung the ball right up to our own goal line: even if it did not go in during the look-ahead, that is a coin flip we do not need
        if (minY < AI_CEIL_MARGIN)
            v -= (AI_CEIL_MARGIN - minY) * AI_CEIL_PEN; // a plan that flings us up into the ceiling (fast ball + rope) ends with us and the ball in the same corner
        if (AI_LOW && minY < AI_ALT_SOFT) v -= (AI_ALT_SOFT - minY) * AI_ALT_PEN; // stay low: coming down from a high float is where shots get through
        if (plan === 'loopO' && v >= 90)
            v += AI_OVERHAND_BONUS;            // the overhand shot works in the look-ahead (its release scores or hits): prefer it to the other shots
        vals[plan] = v;
        v += plan === hs0.plan ? (aiCanDash(me0, hs0) ? 6 : AI_STICK) : 0; // keep the current plan unless another is clearly better (without a dash to spend, nothing else would ever commit it, and it flip-flopped between plans every 0.15 s)
        if (v > bestV) {
            bestV = v;
            out.plan = plan;
            out.val = v;
        }
    }
    // Nothing scores or hits anyone (usual without a dash) and 'hold' (0) beats every plan that merely tries: the AI stood still, timed out and dropped the ball at its own feet. Do the designed
    // opening instead: pull the ball back for room, then swing it over the top (loopO) and let the usual release rules take the shot. Never when the ball is already near our goal, and never if the rollout of that plan is bad.
    if (!R && !aiCanDash(me0, hs0) && Math.max(...Object.values(vals)) < 50 && (aiLeft(me0.team) ? x0 : W - x0) > NETX * 0.5) {
        const room0 = (NETX - x0) * s, looping = hs0.plan === 'loopO' || hs0.plan === 'loopU';
        const dflt = looping ? hs0.plan : (room0 < AI_PULL_ROOM && hs0.t < AI_PULL_MAX ? 'pull' : 'loopO'); // (once looping, stay looping: switching back to a pull is the back-and-forth)
        if (vals[dflt] !== undefined && vals[dflt] > -300) {
            out.plan = dflt;
            out.val = vals[dflt];
        }
    }
}
function aiAdvance(A) { // run one slice of the current job
    const fx = snapshotFx();                   // the copies nudge shared effect values: undo that
    A.job.out.now = A.job.age;                 // (the job skips jump delays that are already in the past by the time it gets to them)
    const r = A.job.gen.next();
    restoreFx(fx);
    A.job.age++;
    if (r.done)
        A.job.done = true;
}

// ================= SPECIALS =================
const aiGoalSign = me => (aiLeft(me.team) ? 1 : -1); // the goal we attack: +1 = right
function aiBallAt(n, body = ball) { // where the free body will be n ticks from now (real-physics forecast)
    const f = aiForecast(body);
    if (!f.path.length)
        return { x: body.x + body.vx * n * DT, y: body.y + body.vy * n * DT };
    return f.path[Math.max(0, Math.min(f.path.length - 1, aiTickN - f.stamp + n - 1))];
}
// Value of a ball future: advance the ball `delay` ticks, add a kick (kx, ky), play on. +260 kills an enemy, +300 scores for us, -400 scores on us, -1000 kills us, 0 nothing happens.
function aiPushValue(me, b0, delay, kx, ky, cancel) {
    const fx = snapshotFx(), atk = aiGoalSign(me), b = Object.assign(new Ball(), b0), self = aiEnemySnap(me);
    const foes = players.filter(q => q.team !== me.team && q.alive).map(aiEnemySnap);
    let v = 0;
    for (let n = 0; n < 150 + delay; n++) {
        if (n === delay && (kx || ky)) {
            if (cancel) { const m = Math.hypot(kx, ky), ux = kx / m, uy = ky / m; if (ux && b.vx * ux < 0) b.vx = 0; if (uy && b.vy * uy < 0) b.vy = 0; } // (marionette cancels motion against the shove)
            b.vx += kx;
            b.vy += ky;
            const s = Math.hypot(b.vx, b.vy);
            if (s > BALL_VMAX) b.boost = Math.max(b.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
        }
        const sc = b.step();
        aiEnemyStep(self);
        for (const e of foes) aiEnemyStep(e);
        if (Math.hypot(b.x - self.x, b.y - self.y) < self.r + b.r) { v = -1000; break; }
        if (foes.some(e => Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r)) { v = 260 - n * 0.4; break; }
        if (sc !== null || aiInGoal(b)) { v = (b.x < W / 2 ? -1 : 1) === atk ? 300 - n * 0.4 : -400; break; }
    }
    restoreFx(fx);
    return v;
}

function aiPegHelps(me, x, y) { // does a peg at (x, y) stop a shot that would score on us?
    const threat = -aiGoalSign(me), fx = snapshotFx();
    if (aiRollEnd(ball).end !== threat) return false;
    pegs.push({ x, y, vx: 0, vy: 0, r: PEG_R, team: me.team, owner: me, flash: 0, life: PEG_LIFE });
    const after = aiRollEnd(ball).end;
    pegs.pop();
    restoreFx(fx);
    return after !== threat;
}

// ---- MARIONETTE: shove the ball the way a rollout says is best (kill a holder, reverse a jumper's ball into their goal, deny a shot) ----
const AI_MARIO_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
function aiSpMarionette(me, A, k) {
    if (me.cd.marionette > 0 || me.onBall || me.rope || me.pending)
        return;
    if (players.some(q => q !== me && q.team === me.team && q.alive && q.onBall && q.tball === ball))
        return; // a teammate has it
    const foes = players.filter(q => q.team !== me.team && q.alive);
    const holder = foes.some(q => q.onBall && q.tball === ball), near = foes.some(q => Math.hypot(q.x - ball.x, q.y - ball.y) < 380), threat = aiForecast(ball).end === -aiGoalSign(me);
    const shot = (A.shotT || 0) > 0; // we have just let go of the ball: a shove may carry it into their goal
    if (!holder && !near && !threat && !shot)
        return; // (the rollouts are not free: only look when something is going on)
    const v0 = aiPushValue(me, ball, 0, 0, 0, false);
    let best = null;
    for (const [dx, dy] of AI_MARIO_DIRS) {
        if (me.ground && dy < 0) continue; // an up arrow on the floor would also jump
        const m = Math.hypot(dx, dy), v = aiPushValue(me, ball, 2, dx / m * MARIONETTE_V, dy / m * MARIONETTE_V, true);
        if (!best || v > best.v) best = { v, dx, dy };
    }
    if (best && ((best.v >= 200 && best.v - v0 >= 400 && best.v > 100) || (shot && best.v >= 240 && v0 < 100))) { // (the second case: it was going nowhere, and the shove puts it in their goal or on an enemy)
        k.sp = true;
        k.l = best.dx < 0; k.r = best.dx > 0; k.up = best.dy < 0; k.dn = best.dy > 0;
        A.sp = { id: 'mario', dx: best.dx, dy: best.dy }; // next tick: let go with the arrows still held = fire
    }
}

// ---- ARROW ----
function aiArrowAng(me, S, charge) {
    const V = ARROW_V_MIN + (ARROW_V_MAX - ARROW_V_MIN) * charge, T = S.kind === 'ball' ? ball : S.foe;
    let t = Math.hypot(T.x - me.x, T.y - me.y) / V, px = T.x, py = T.y;
    for (let i = 0; i < 2; i++) {
        if (S.kind === 'ball') { const p = aiBallAt(Math.round(t * 120)); px = p.x; py = p.y; }
        else { px = T.x + T.vx * t; py = T.y + T.vy * t + (T.ground ? 0 : 0.5 * G * t * t); }
        t = Math.hypot(px - me.x, py - me.y) / V;
    }
    return Math.atan2(py - 0.5 * ARROW_G * t * t - me.y, px - me.x); // aim high by the drop
}
function aiArrowPlan(me) {
    const dist = Math.hypot(ball.x - me.x, ball.y - me.y);
    if (dist < 1000) { // shoot the death ball when a rollout says it saves a goal or scores one
        const S = { kind: 'ball' }, ch = 0.8, V = ARROW_V_MIN + (ARROW_V_MAX - ARROW_V_MIN) * ch, n = Math.round(dist / V * 120), ang = aiArrowAng(me, S, ch);
        const v = aiPushValue(me, ball, n, Math.cos(ang) * V * ARROW_BALL_K, Math.sin(ang) * V * ARROW_BALL_K, false), v0 = aiPushValue(me, ball, 0, 0, 0, false);
        if (v >= v0 + 150 && v > -100)
            return { kind: 'ball', charge: ch };
    }
    let best = null, bd = 900; // cover fire: an enemy in the air, or one holding the ball (setting up a shot)
    for (const e of players)
        if (e.team !== me.team && e.alive && (!e.ground || e.onBall)) {
            const d = Math.hypot(e.x - me.x, e.y - me.y);
            if (d < bd) { bd = d; best = e; }
        }
    return best ? { kind: 'foe', foe: best, charge: 0.6 } : null;
}
function aiSpArrow(me, A, k) {
    if (me.cd.arrow > 0 || me.onBall || me.rope || me.pending || me.casts.length)
        return;
    if (Math.hypot(ball.x - me.x, ball.y - me.y) < 160 || aiPathMin(me, ball, 0, false, me.r, W - me.r) < AI_THREAT * 2)
        return; // aiming roots us to the spot: never with the death ball about to arrive
    const plan = aiArrowPlan(me);
    if (plan) { k.sp = true; A.sp = { id: 'arrow', t: 0, ...plan }; }
}
function aiArrowRun(me, A, k, S) {
    S.t += DT;
    const c = me.casting('arrow');
    if (!c || (S.kind === 'foe' && !S.foe.alive) || S.t > 2.2) { A.sp = null; A.spCool = 0.5; return; }
    const diff = wrapAng(aiArrowAng(me, S, S.charge) - c.ang), danger = !!aiDodge(me, ball, me.r, W - me.r);
    k.l = diff < -0.06; k.r = diff > 0.06; k.up = false; k.dn = false; // (RIGHT turns clockwise; a deadband avoids double taps, which would snap the aim)
    k.sp = true;
    if (danger || (c.charge >= S.charge && Math.abs(diff) < 0.08)) { // fire
        k.sp = false;
        A.sp = null;
        A.spCool = 0.3;
    }
}

// ---- PLINKO: a peg in the way of a shot (and step out of it), or a wall of pegs in front of our goal ----
const aiPlinkoWant = me => pegs.filter(q => q.owner === me).length < PEG_MAX && ((ball.x - NETX) * aiSide(me) >= 40 || players.some(q => q.team !== me.team && q.alive && q.onBall));
const aiPlinkoSpot = me => { const off = RUN + PL * (pegs.filter(q => q.owner === me).length ? 3.2 : 1.4); return aiLeft(me.team) ? off : W - off; };
const aiWaitX = me => (AI_SPECIALS && me.has('plinko') && me.cd.plinko <= 0 && aiPlinkoWant(me) ? aiPlinkoSpot(me) : aiMid(me));
function aiSpPlinko(me, A, k) {
    if (me.cd.plinko > 0 || me.onBall || me.casts.length)
        return;
    const f = aiForecast(ball), off = Math.max(0, aiTickN - f.stamp);
    if (f.path.length && (f.end === -aiGoalSign(me) || aiDodge(me, ball, me.r, W - me.r))) {
        let close = 1e9, at = null, when = 0;
        for (let n = off; n < Math.min(f.path.length, off + 100); n++) {
            const d = Math.hypot(f.path[n].x - me.x, f.path[n].y - me.y);
            if (d < close) { close = d; at = f.path[n]; when = n - off; }
        }
        if (at && close < 70 && when > 15) { // it passes right by us: peg goes where we stand, we get pushed out along the arrows (away from the ball)
            const ux = me.x - at.x, uy = me.y - at.y, m = Math.hypot(ux, uy) || 1;
            k.l = ux / m < -0.38; k.r = ux / m > 0.38; k.up = uy / m < -0.38; k.dn = uy / m > 0.38 && !me.ground;
            if (!k.l && !k.r && !k.up && !k.dn) k.up = true;
            k.sp = true;
            A.spCool = 0.4;
            return;
        }
    }
    if (me.ground && Math.abs(me.x - aiPlinkoSpot(me)) < 16 && aiPlinkoWant(me)) {
        k.sp = true;
        A.spCool = 0.5;
    }
}

// ---- DECOY: constant pressure on whoever is near ----
function aiSpDecoy(me, A, k) {
    if (me.cd.decoy > 0 || me.onBall || me.casts.length || !me.ground)
        return;
    if (aiForecast(ball).end === -aiGoalSign(me) || aiPathMin(me, ball, 0, false, me.r, W - me.r) < AI_THREAT * 2)
        return; // defend first
    let foe = null, fd = 1e9;
    for (const q of players)
        if (q.team !== me.team && q.alive) { const d = Math.hypot(q.x - me.x, q.y - me.y); if (d < fd) { fd = d; foe = q; } }
    if (!foe || !(fd < 420 || (foe.onBall && fd < 800)))
        return;
    const mine = decoys.find(d => d.owner === me);
    if (mine && Math.hypot(mine.x - foe.x, mine.y - foe.y) < 300)
        return; // the one we have is already on them
    k.sp = true;
    A.spCool = 1;
}

// ---- DASH (the loop dash is in aiHeldKeys): get back to a slow, far-away ball quickly ----
function aiSpDash(me, A, k) {
    if (!me.dashReady || me.cd.dash > 0 || me.onBall || me.casts.length || !me.ground || !aiCanGrip(me))
        return;
    const b = AIB, dx = b.x - me.x;
    if ((b.x - NETX) * aiSide(me) >= 40 || Math.abs(dx) < 650 || Math.hypot(b.vx, b.vy) > 200)
        return;
    k.sp = true; k.r = dx > 0; k.l = dx < 0; k.up = false; k.dn = false;
    A.spCool = 1;
}

function aiSpecialRun(me, A, k) {
    const S = A.sp;
    if (S.id === 'mario') { // let go with the arrows still held: the shove fires
        k.l = S.dx < 0; k.r = S.dx > 0; k.up = S.dy < 0; k.dn = S.dy > 0; k.sp = false;
        A.sp = null;
        A.spCool = 0.4;
    } else if (S.id === 'arrow')
        aiArrowRun(me, A, k, S);
    else
        A.sp = null;
}
function aiSpecial(me, A, k) {
    A.spCool = Math.max(0, (A.spCool || 0) - DT);
    if (me.stunT > 0) { A.sp = null; return; }
    if (A.sp) { aiSpecialRun(me, A, k); return; }
    const busy = A.E || A.X || A.V; // a committed jump is in flight; a look-ahead is not
    if (A.spCool > 0 || busy || (A.spT = (A.spT || 0) - 1) > 0)
        return;

    A.spT = 2;

    const f = {
        dash: aiSpDash,
        plinko: aiSpPlinko,
        marionette: aiSpMarionette,
        decoy: aiSpDecoy,
        arrow: aiSpArrow
    }[me.slots()[0][1]];

    if (f) {
        const before = A.sp;
        f(me, A, k);
        if (A.sp !== before || k.sp)
            A.job = null; // a special was started: drop the look-ahead
    }
}

// ---- RETREAT: get back over the net (a grapple jump up through the gap), planned by look-ahead like the other jumps ----
function aiRetreatKeys(me, R, k) {
    const s = aiSide(me), ours = s > 0 ? 'l' : 'r', theirs = s > 0 ? 'r' : 'l';
    if (!me.ground && R.j === 0) { k.up = true; k[ours] = true; R.t += DT; return; } // already in the air: float home
    if (R.j === 0 && Math.abs(me.x - NETX) < R.run) { k[theirs] = true; R.t += DT; return; } // room for the jump (the net would be the nearest thing to grapple)
    R.j += DT;
    const jt = R.j, taps = R.taps;
    k.up = jt < Math.max(AI_JUMP_HOLD, taps * AI_TAP_T + 0.55);
    if (taps) {
        const i = Math.floor(jt / AI_TAP_T);
        k.z = i < taps && jt - i * AI_TAP_T < AI_TAP_ON;
        k.x = jt < taps * AI_TAP_T;
    }
    k[ours] = true;
}
function* aiRetreatJob(me0, frozen, out) {
    const S = aiSimNew(me0), s = aiSide(me0);
    let n = 0;
    for (let i = 0; i < AI_PRE; i++) { aiSimStep(S, frozen); if (aiDead(S)) return; }
    for (const run of [0, 70, 140]) for (const taps of [3, 2, 4, 6]) {
        const V = aiSimFork(S), R = { t: 0, j: 0, taps, run };
        for (let i = 0; i < 360; i++) {
            const k = aiNoKeys();
            aiRetreatKeys(V.me, R, k);
            const sc = aiSimStep(V, k);
            if (aiDead(V) || (sc !== null && sc !== V.me.team))
                break;
            if (R.j > 0.4 && V.me.ground) {
                if ((V.me.x - NETX) * s < -20) { out.ok = true; out.taps = taps; out.run = run; return; }
                break;
            }
            if (++n % AI_SLICE === 0)
                yield;
        }
    }
}

function aiFree(i, me, A, k) { // keys for an AI that is not tethered
    const s = aiSide(me), b = AIB, dx = b.x - me.x, away = (me.x - NETX) * s > 0; // away: we are over the net, on their half (a dash shot carries us there)
    const left = aiLeft(me.team), lo = left || away ? me.r : NETX + me.r, hi = left && !away ? NETX - me.r : W - me.r; // the room to dodge in: our half, or the whole arena when we are on theirs (the dodge model clamps to it, so a clamp to the wrong half 'teleports' us to the net and hides the ball)
    const mine = (b.x - NETX) * s < 40 || (away && Math.abs(b.x - me.x) < 450);        // the ball is on our half (or right at the net)
    if (A.E) {                                 // in an engage jump: carry it out
        aiEngageKeys(me, b, A.E, k);
        if (me.ground && A.E.t > 0.3) {
            A.E = null;
            A.rescueHold = null;
            A.cool = 0.5;                      // landed without latching: breathe
        }
        return;
    }
    if (A.X) {                                 // hopping over the ball: carry it out
        aiCrossKeys(me, A.X, k);
        if (me.ground && A.X.t > 0.3) {
            A.X = null;
            A.cool = 0.3;
        }
        return;
    }
    if (A.V) {                                 // in an invade jump: carry it out
        if (!A.V.tgt.alive || (!me.ground && aiDodge(me, ball, lo, hi))) {
            A.V = null;                        // the target is gone, or the death ball is coming for us: stop, and let the normal logic dodge
            A.invCool = 2;
        } else {
            aiInvadeKeys(me, A.V.tgt, A.V, k);
            if (me.ground && A.V.t > (A.V.run || 0) + 0.3) {
                A.V = null;
                A.invCool = AI_INVADE_CD;
                A.cool = 0.3;
            }
            return;
        }
    }
    if (A.job && A.job.kind === 'invade') {    // an invade look-ahead is running
        const J = A.job;
        Object.assign(k, J.age < AI_PRE ? J.frozen : {});
        if (!J.done)
            aiAdvance(A);
        else
            J.age++;
        if (J.done && J.age >= AI_PRE) {
            A.job = null;
            if (J.out.ok && J.tgt.alive) {
                A.V = { t: 0, taps: J.out.taps, run: J.out.run, tgt: J.tgt };
                aiStats.invades++;
                aiInvadeKeys(me, A.V.tgt, A.V, k);
            } else
                A.invCool = 1;                 // nothing lands: look again in a second
        }
        return;
    }
    if (A.job && A.job.kind === 'cross') {     // a cross look-ahead is running
        const J = A.job;
        Object.assign(k, J.age < J.pre ? J.frozen : {});
        if (!J.done)
            aiAdvance(A);
        else
            J.age++;
        if (J.done && J.age >= J.pre) {
            A.job = null;
            if (J.out.ok) {
                A.crossFail = 0;
                A.X = { t: 0, hold: J.out.hold };
                aiCrossKeys(me, A.X, k);
            } else {
                A.jcool = 0.15;
                A.crossFail++;
            }
        }
        return;
    }
    if (A.R) { // walking / jumping home
        if (aiDodge(me, ball, lo, hi)) { A.R = null; A.retCool = 0.4; } // the death ball is on us: normal dodge logic
        else {
            aiRetreatKeys(me, A.R, k);
            if (((me.x - NETX) * s < -20 && me.ground) || A.R.t + A.R.j > 4) { A.R = null; A.retCool = 1; A.retFail = 0; }
            return;
        }
    }
    if (A.job && A.job.kind === 'retreat') {
        const J = A.job;
        Object.assign(k, J.age < AI_PRE ? J.frozen : {});
        if (!J.done) aiAdvance(A); else J.age++;
        if (J.done && J.age >= AI_PRE) {
            A.job = null;
            if (J.out.ok) A.R = { t: 0, j: 0, taps: J.out.taps, run: J.out.run };
            else { A.retFail = (A.retFail || 0) + 1; A.retCool = 0.3; A.R = A.retFail >= 2 ? { t: 0, j: 0, taps: 3, run: 70 } : null; }
            if (A.R) aiRetreatKeys(me, A.R, k);
        }
        return;
    }
    if (A.job && A.job.kind === 'jump') {      // a jump look-ahead is running (and maybe a scheduled jump after it)
        const J = A.job;
        Object.assign(k, J.age < AI_PRE ? J.frozen : {}); // what the look-ahead assumed: keep walking for AI_PRE ticks, then stand
        if (!J.done)
            aiAdvance(A);
        else
            J.age++;
        if (J.done && J.age >= AI_PRE) {
            if (!J.out.ok || J.age > J.out.delay + 3) { // nothing works (or we are far too late for it): back to normal
                A.job = null;
                A.jcool = 0.1;
                if (++A.fails % 6 === 0)
                    A.stand = AI_STANDS[(AI_STANDS.indexOf(A.stand) + 1) % AI_STANDS.length]; // standing still and failing: try another distance
            } else if (J.age >= J.out.delay + AI_LAG) {
                A.job = null;
                A.jcool = 0.1;
                A.fails = 0;
                if (me.ground) {
                    A.rescueHold = J.out.rescue !== undefined ? J.out.rescue : null; // a rescue grab lets go early (see aiHeldKeys)
                    A.E = { t: 0, mode: J.out.mode, taps: J.out.taps || 0 };
                    aiEngageKeys(me, b, A.E, k);
                }
            }
        }
        return;
    }
    const grip0 = aiCanGrip(me), mate = AI_TEAMWORK ? aiYield(me, b) : null;
    if (mate) {                                // a teammate has this ball (or is better placed): back them up (cover behind them) and stay clear of the death ball
        const anchor = s > 0 ? Math.min(b.x, mate.x) : Math.max(b.x, mate.x);
        const tx = Math.max(lo + 24, Math.min(hi, anchor - s * AI_SUPPORT_GAP));
        const gap = tx - me.x, toward = me.vx * Math.sign(gap);
        if (Math.abs(gap) > 16) {
            const brake = toward > 0 && Math.abs(gap) < toward * 0.5;
            k.r = gap > 0 !== brake;
            k.l = gap < 0 !== brake;
        }
        const dd = aiDodge(me, ball, lo, hi);
        if (dd) {
            k.l = dd.dir < 0;
            k.r = dd.dir > 0;
            k.up = dd.up;
        }
        A.invIdle = (A.invIdle || 0) + DT;
        if (AI_INVADE && !dd && grip0 && me.ground && !A.job && A.invCool <= 0 && A.invIdle > AI_INVADE_WAIT && aiInvadeSafe(me)) {
            const tgt = aiInvadeTarget(me, b);
            if (tgt) {                         // look for a jump that crashes into them (the keys we are pressing now are what the look-ahead assumes we keep pressing)
                A.out = {};
                A.job = { kind: 'invade', gen: aiInvadeJob(me, aiNoKeys(), tgt, A.out), out: A.out, tgt, frozen: aiNoKeys(), age: 0, done: false };
                Object.assign(k, aiNoKeys());  // stand still while it runs: the look-ahead plans from exactly here, so the real jump must start from exactly here
                A.invIdle = 0;
            }
        }
        return;
    }
    A.retCool = Math.max(0, (A.retCool || 0) - DT);
    if (AI_AWAY && away) { // across the net: crash somebody if a look-ahead finds a hard hit, grab the ball if it is close, otherwise get home
        const tgt = aiInvadeTarget(me, b);
        if (me.ground && grip0 && tgt && A.invCool <= 0 && aiInvadeSafe(me)) {
            A.out = {};
            A.job = { kind: 'invade', gen: aiInvadeJob(me, aiNoKeys(), tgt, A.out), out: A.out, tgt, frozen: aiNoKeys(), age: 0, done: false };
            Object.assign(k, aiNoKeys());
            return;
        }
        const ballClose = grip0 && Math.hypot(b.x - me.x, b.y - me.y) < 380;
        if (!ballClose && A.retCool <= 0) {
            if (!me.ground) { A.R = { t: 0, j: 0, taps: 3, run: 0 }; aiRetreatKeys(me, A.R, k); return; }
            A.out = {};
            A.job = { kind: 'retreat', gen: aiRetreatJob(me, aiNoKeys(), A.out), out: A.out, frozen: aiNoKeys(), age: 0, done: false };
            return;
        }
    } else if (AI_AWAY && !players.some(q => q !== me && q.team === me.team) && grip0 && me.ground && A.invCool <= 0 && aiInvadeSafe(me)) { // 1v1: an enemy holding the ball is busy: go and crash them
        const tgt = aiInvadeTarget(me, b);
        if (tgt && tgt.onBall) {
            A.out = {};
            A.job = { kind: 'invade', gen: aiInvadeJob(me, aiNoKeys(), tgt, A.out), out: A.out, tgt, frozen: aiNoKeys(), age: 0, done: false };
            Object.assign(k, aiNoKeys());
            return;
        }
    }
    // a shot coming at us: schedule a jump so that we are up over its path when it arrives
    const grip = aiCanGrip(me), arr = grip && me.ground && (A.cool <= 0 || b !== A.heldBody) && (A.jcool || 0) <= 0 ? aiArrival(me) : null; // (the sulking cooldown after a throw only applies to the body we just threw) // (no grip, no grab: with the grapple spent or locked out we only keep clear)
    const urgent = arr ? aiUrgent(me) : false; // a shot at our goal is worth a try even when it is nearly on us (a rescue grab only needs ~0.1 s of warning); otherwise a jump needs 0.3 s
    if (arr && arr.t > (urgent ? 0.1 : 0.3) && arr.t < 1.9) {
        // launch as early as the reaction time allows, then later: the look-ahead takes the first (earliest) one that latches the ball and holds it. 2 or 4 grapple-jump taps are the usual winners;
        // fast, high shots need the taps, slow ones a plain jump.
        const last = Math.round(arr.t * 120) + 6, delays = [...new Set([0, 6, 14, 24, 36, 50, 66].map(d => Math.max(AI_PRE, AI_PRE + d)).filter(d => d <= last))];
        if (!delays.length) delays.push(AI_PRE);
        A.out = {};
        A.job = { kind: 'jump', gen: aiJumpJob(me, aiNoKeys(), delays, ['toward', 'none'], A.out, AI_LOW ? [0, 2, 3, 4, 6] : [2, 4, 0, 3, 6], false, urgent), out: A.out, frozen: aiNoKeys(), age: 0, done: false };
        return;
    }
    // the ball is behind us (between us and our own goal), slow and low: get round it first (see aiCrossJob). If crossing keeps failing, the normal approach below takes over.
    const behind = mine && (me.x - b.x) * s > 25 && Math.hypot(b.vx, b.vy) < 220 && b.y > aiFloorY(b.x) - 70 && (s > 0 ? b.x : W - b.x) > AI_CROSS_ROOM; // (and enough room between the ball and our goal to land and shoot from there)
    if (!behind)
        A.crossFail = 0;
    if (behind && me.ground && A.crossFail < 3 && (A.jcool || 0) <= 0 && Math.abs(dx) < 190 && Math.abs(dx) > 40) { // (a plain hop needs no grapple meter, and the sulking cooldown after a throw is about not re-grabbing: it does not apply to hopping round it)
        const pre = Math.hypot(b.vx, b.vy) < 30 ? AI_PRE_X : AI_PRE; // a ball lying still does not change while we think
        A.out = {};
        A.job = { kind: 'cross', gen: aiCrossJob(me, aiNoKeys(), A.out, pre), out: A.out, frozen: aiNoKeys(), age: 0, done: false, pre };
        return;
    }
    // the approach: run at the ball on t[2, 4, 0]he side we are already on, stopping a stand-off short of it (the jump check below picks the moment to go)
    let tx = null;
    if (AI_CONTEST && grip && mine && !arr && aiUrgent(me)) { // the ball is going in and no jump is planned: go and stand where it will be, do not wait on the midline
        const f = aiForecast(), p = f.path.length ? f.path[Math.min(f.path.length - 1, Math.max(0, aiTickN - f.stamp) + 45)] : b;
        tx = Math.max(lo, Math.min(hi, p.x + (me.x >= p.x ? 1 : -1) * (A.stand || AI_STAND)));
    } else if (grip && mine && Math.abs(dx) < 500) {
        const side = me.x >= b.x ? 1 : -1, closing = -side * b.vx;
        const slow = Math.hypot(b.vx, b.vy) < 150 && me.ground; // a ball creeping along our floor (maybe towards our own goal): go right up to it and hop over it, do not hover at a safe stand-off while it trickles in
        tx = Math.max(lo, Math.min(hi, b.x + side * (slow ? 45 : (A.stand || AI_STAND))));
        if (closing > 90 && Math.abs(dx) < 220)
            tx = me.x;                         // it is rolling at us: hold, it will be grabbed or dodged
    } else
        tx = aiMid(me);                        // otherwise wait on the midline of our half (Midline Defense), not up against the net (Quell Rank Range)
    const gap = tx - me.x, toward = me.vx * Math.sign(gap);
    if (Math.abs(gap) > 12) {
        const brake = toward > 0 && Math.abs(gap) < toward * 0.5; // too fast to stop in time: back off the throttle
        k.r = gap > 0 !== brake;
        k.l = gap < 0 !== brake;
    }
    A.jcool = Math.max(0, (A.jcool || 0) - DT);
    A.idle = mine && Math.hypot(b.vx, b.vy) < 30 ? (A.idle || 0) + DT : 0; // a resting ball on our half that we are not getting anywhere with:
    if (A.idle > 4) {
        A.idle = 0;
        A.stand = AI_STANDS[(AI_STANDS.indexOf(A.stand) + 1) % AI_STANDS.length]; // come at it from a different distance
    }
    if (grip && mine && me.ground && A.cool <= 0 && A.jcool <= 0 && Math.hypot(dx, b.y - me.y) < 260) { // worth asking whether a jump latches (no longer waits for the dash to be ready: openings do not depend on it)
        if (Math.abs(dx) < 66) { k.l = k.r = false; }           // too close to keep running while we think
        A.out = {};
        A.job = { kind: 'jump', gen: aiJumpJob(me, { ...k }, [AI_PRE], ['toward', 'none', 'away'], A.out, dx * s > 20 ? AI_OVERHAND_TAPS : AI_LOW ? [0, 2, 4] : [2, 4, 0], true), out: A.out, frozen: { ...k }, age: 0, done: false };
        return;
    }
    const dodge = aiDodge(me, ball, lo, hi);    // the DEATH ball is going to reach us: pick the steering that keeps us furthest from it (a decoy cannot kill us: never dodge one)
    // In the air with the ball about to be where we come down (a slow ball creeping under us, or one rolling at our landing spot): we cannot steer out of it for ever, and the grapple only
    // grabs the nearest thing, so if the ball is that, grab it NOW and let the held plans (which look ahead for a safe release) decide what to do with it.
    if (!me.ground && grip && (A.cool <= 0 || b !== A.heldBody) && mine && (b === ball ? dodge : aiUrgent(me))) {
        const gd = Math.hypot(dx, b.y - me.y);
        if (gd < RANGE - 15 && gd > me.r + b.r + 6) {
            const near = aiNearest(me, b);
            if (near && near.b && near.ball === b) {
                if (!(A.airT > 0)) {           // (a rollout is not free: redo it every few ticks, not every tick)
                    A.airOk = aiAirGrabSafe(me);
                    A.airT = 4;
                }
                A.airT--;
                if (A.airOk) {
                    k.z = true;
                    return;
                }
            }
        }
    }
    if (dodge) {
        k.l = dodge.dir < 0;
        k.r = dodge.dir > 0;
        k.up = dodge.up;
    }
}
function aiDrive(i) {
    if (i <= aiLastI)
        aiTickN++;                             // a new tick (aiDrive runs once per AI per tick, in order)
    aiLastI = i;
    const me = players[i], A = ai[i], k = aiNoKeys();
    AIB = A.fb = aiPickFocus(me, A);           // the body every prediction below is about (see aiPickFocus)
    A.t -= DT;
    A.cool = Math.max(0, (A.cool || 0) - DT);
    A.invCool = Math.max(0, (A.invCool || 0) - DT);
    A.shotT = Math.max(0, (A.shotT || 0) - DT); // time left in the window after letting go of the ball, when a follow-up shove / arrow may finish the shot
    A.noGrab = Math.max(0, A.noGrab - DT);
    if (me.onBall) {
        if (!A.held) {                         // just latched on
            A.held = true;
            A.hs = { t: 0, dashT: null, n: 0, plan: 'hold', next: 0.05, noDash: Math.random() >= AI_DASH_USE };
            if (A.rescueHold != null) {       // this grab is a rescue: hold the 'hold' plan for the planned moment, then let go (no replanning)
                A.hs.rescue = A.rescueHold;
                A.hs.next = A.rescueHold; // (the normal plans take over once the rescue hold is over)
                A.rescueHold = null;
            }
            A.E = null;
            A.job = null;
        }
        const hs = A.hs;
        A.heldBody = AIB;                      // (remembered for the cooldown after we let go)
        if (me.tball === AIB && !A.job && hs.t >= hs.next && hs.dashT === null && !hs.commit) { // (re)plan; not once the dash is spent, that plan is committed
            A.out = { race: AI_RACE ? aiOtherThreat(me) : null };
            A.job = { kind: 'held', gen: aiHeldJob(me, hs, A.out), out: A.out, age: 0, done: false };
        }
        if (A.job && A.job.kind === 'held') {
            aiAdvance(A);
            if (A.job.done && A.job.age >= AI_PRE_H) {
                if (A.job.out.plan)
                    hs.plan = A.job.out.plan;
                if (!A.job.out.race && A.job.out.val >= AI_COMMIT_V && !aiCanDash(me, hs) && /^(shoot|sling|loop)/.test(hs.plan))
                    hs.commit = true;           // a shot that works in the look-ahead, and no dash to commit us: stop second-guessing it
                A.raceMode = !!A.job.out.race;  // (if we let go during a race, it is to go and deal with the other ball: no sulking cooldown)
                hs.next = hs.t + 0.15;
                A.job = null;
            }
        }
        aiHeldKeys(me, AIB, hs, k);
        if (me.tball !== ball && aiPathMin(me, ball, 0, false, me.r, W - me.r) < me.r + ball.r + 12)
            k.z = false;                       // holding a decoy while the DEATH ball is about to reach us: let go and dodge
        if (me.tball === AIB && players.some(q => q.team !== me.team && q.alive && q.onBall && q.tball === AIB)) { // tug of war: an enemy has it too
            hs.tug = (hs.tug || 0) + DT;
            if (hs.patience === undefined)
                hs.patience = 0.8 + Math.random() * 1.8; // random, so the two do not give up in lockstep
            if (hs.tug > hs.patience)
                k.z = false;                   // let go; the other one is left holding it and will shoot
        }
    } else {
        if (A.held) {                          // just let go (a throw): do not snatch it straight back
            A.held = false;
            A.hs = null;
            A.job = null;
            A.cool = A.raceMode ? 0.05 : 1;
            A.shotT = 1.5;
            A.raceMode = false;
            A.t = 0;
        }
        aiFree(i, me, A, k);
    }
    if (AI_SPECIALS) aiSpecial(me, A, k);
    Object.assign(me.keys, k);
}