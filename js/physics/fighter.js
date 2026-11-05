// PHYSICS - Fighter: the FIGHTER special. Never draws (see render/fighter.js).
// Adds methods to Player (see mixin() in player.js); load after player.js (and after constants.js, which holds the FIGHTER_* numbers).
// Tuning numbers that apply to every move live in constants.js (FIGHTER_*); the numbers of each individual move live in the FIGHTER_MOVES table below.
//
// HOW IT PLAYS: Fighter takes BOTH special slots (so it only exists when the match uses two specials per player). The two special keys become two attack buttons:
// sp = P (punch), sp2 = K (kick). A plain press is a normal; a motion on the arrow keys just before the press (street-fighter style) is a special move.
//
// FACING: forward is always TOWARD THE NET. On the left half you face right, on the right half you face left, so an invader's "forward" points back at their own side.
// Facing only changes while no move is running (and not while stunned), and holds inside a small dead zone around the net line (FIGHTER_NET_DEAD).
//
// MOTIONS are written as numpad digits RELATIVE TO WHERE THE PLAYER FACES (6 = toward the front / the net, 4 = back, 2 = down, 8 = up):
//        7 8 9
//        4 5 6        236 = quarter-circle forward (down, down-forward, forward)      623 = dragon punch (forward, down, down-forward)      44 = double tap back
//        1 2 3
// The history stores ABSOLUTE directions (6 = screen right) and the recognizer mirrors the motion by p.face when it looks.
//
// LENIENCY (the knobs are FIGHTER_MOTION_T / FIGHTER_LEAD_T in constants.js, and fighterMatch below):
//   - neutral (5) between steps is ignored, so a keyboard player who lets go of every key between two directions still gets the motion;
//   - a diagonal step may be skipped (26 counts as 236, 62 as 623), a straight step may not;
//   - the same direction either side of a neutral counts as TWO steps (that is how a double tap like 44 works);
//   - the motion has to be finished within FIGHTER_MOTION_T of leaving its first direction, and within FIGHTER_LEAD_T of the button press.
//   - if both horizontal keys are held, the one pressed most recently wins.
//
// STATE (all plain data, so saveState / rollback / prediction carry it with no extra work):
//   p.face      1 = facing screen right, -1 = left. Toward the net; frozen while a move runs. (Over the network it is blended between snapshots, so read it as p.face >= 0.)
//   p.dirHist   [[direction 1..9, tick], ...] entries, only when the direction changes, oldest first, about FIGHTER_BUFFER_T seconds long
//   p.fTick     this player's own tick counter (counts only while Fighter is equipped)
//   p.move      null, or { id, t, hits, dir }: the move being performed, t = ticks since it started, hits = bit mask of what it has already hit, dir = the direction it was latched with (+1 right / -1 left)
//   p.hLast, p.pL, p.pR   which horizontal key was pressed last, and whether left / right were down last tick
// A move has three phases, in ticks (120 = 1 s): STARTUP (nothing hurts yet), ACTIVE (the hitbox is live), RECOVERY (committed, nothing hurts). Steering is locked for all of it.

const FIGHTER_MIRROR = [0, 3, 2, 1, 6, 5, 4, 9, 8, 7]; // numpad digit -> its mirror image (left <-> right)
const FIGHTER_DIAG = [1, 3, 7, 9];

// THE ROSTER. One row per move: add a row to add a move, edit numbers to balance it. (No code to touch for a plain hitbox move.)
//   motion    numpad string, or '' for a plain button press (a "normal")
//   button    'sp' (P) or 'sp2' (K)
//   zone      optional: 'home' (only while on your own half) or 'invader' (only while on the enemy half). Two rows may share a motion and button if their zones differ.
//   back      optional: the move goes AWAY from the net (dir = -face) instead of toward it
//   startup / active / recovery   ticks
//   hit       ... or { x, y, rx, ry }: an ellipse centred there (rx wide, ry tall) instead of a circle
//   away      optional: knock x points away from the fighter (by which side the target is on) instead of in the move's direction
//   knock     { x, y }: the velocity a hit gives its target (x is mirrored by the move's direction); ballKnock overrides it for the death ball and decoys
//   vx, vy    optional: the fighter's OWN velocity, set the moment the active phase starts (vx is mirrored by the move's direction)
//   rehit     optional: ticks between hits of a multi-hit move (the hit mask is cleared every this many ticks of the active phase)

const FIGHTER_MOVES = [
    // Physical Attacks
    // Forwards
    //qcf
    { id: 'uppercut', name: 'UPPERCUT', motion: '236', button: 'sp', startup: 6, active: 14, recovery: 34, vx: 80, vy: -420, hit: { x: 22, y: -26, r: 28 }, knock: { x: 140, y: -640 }, ballKnock: { x: 200, y: -820 }, stun: { t: 0.5 }, cancel: true },
    { id: 'plunge', name: 'PLUNGE', motion: '896', button: 'sp', startup: 15, active: 16, recovery: 30, vy: 500, hit: { x: 30, y: 30, rx: 30, ry: 60 }, knock: { x: 150, y: 400 }, ballKnock: { x: 150, y: 800 }, stun: { t: 1 }, cancel: false },
    { id: 'throw', name: 'THROW', motion: '478', button: 'sp', startup: 15, active: 16, recovery: 30, vy: -0, hit: { x: -30, y: -30, rx: 45, ry: 45 }, knock: { x: 500, y: -500 }, ballKnock: { x: -500, y: 500 }, stun: { t: .25 }, cancel: false },
    { id: 'stomp', name: 'STOMP', motion: '412', button: 'sp', startup: 15, active: 16, recovery: 30, vy: -0, hit: { x: -30, y: 30, rx: 45, ry: 45 }, knock: { x: -300, y: 300 }, ballKnock: { x: 300, y: 300 }, stun: { t: .75 }, cancel: true },

    //qcb
    { id: 'tatsu', name: 'TATSU', motion: '632', button: 'sp', startup: 8, active: 36, recovery: 28, rehit: 6, vx: 200, vy: 0, hit: { x: 0, y: 0, rx: 60, ry: 22 }, away: true, knock: { x: 90, y: -140 }, ballKnock: { x: 450, y: -300 }, stun: { t: 0.3 } },
    { id: 'whirlwind', name: 'WHIRLWIND', motion: '698', button: 'sp', startup: 8, active: 20, recovery: 32, sweep: { r: 2 * PL, a0: 0, a1: Math.PI, hitR: 24, speed: 500, ballSpeed: 500, steer: true, carry: 1 }, stun: { t: 0.5 }, cancel: true },
    { id: 'blowback', name: 'BLOWBACK', motion: '874', button: 'sp', startup: 8, active: 36, recovery: 28, rehit: 6, vx: -200, vy: 0, hit: { x: -40, y: 0, rx: 60, ry: 16 }, away: true, knock: { x: 90, y: -140 }, ballKnock: { x: 450, y: -300 }, stun: { t: 0.3 } },
    { id: 'trip', name: 'TRIP', motion: '214', button: 'sp', startup: 8, active: 36, recovery: 28, rehit: 6, vx: 0, vy: 0, hit: { x: 0, y: 10, rx: 80, ry: 8 }, away: true, knock: { x: 90, y: -840 }, ballKnock: { x: 200, y: -820 }, stun: { t: 1 }, cancel: false },

    // 2keys
    { id: 'backdash', name: 'BACKDASH', motion: '64', button: 'sp', back: true, startup: 4, active: 10, recovery: 20, vx: 400 },
    { id: 'rush', name: 'RUSH', motion: '46', button: 'sp', startup: 10, active: 16, recovery: 26, vx: 200, hit: { x: 30, y: 0, r: 26 }, knock: { x: 150, y: -40 }, ballKnock: { x: 700, y: -80 }, stun: { t: 0.5 }, cancel: true },
    
    // Special Attacks
    { id: 'fireball', name: 'FIREBALL', motion: '236', button: 'sp2', startup: 14, active: 2, recovery: 34, fire: { x: 36, y: -2, vx: 500, r: PL / 2, life: 2, knock: { x: 200, y: 0 }, ballKnock: { x: 200, y: 0 }, stun: { t: 0.25 } } },
    { id: 'nova', name: 'NOVA', motion: '214', motionT: 0.7, button: 'sp2', startup: 12, active: 2, recovery: 36, burst: { type: 'chevron', n: 24, speed: 700, a0: -Math.PI / 2 } },
];

function drawFighterInputs() { // debug: the recent directions, as seen from the player's facing (so a fireball reads 2 3 6)
    cx.save();
    cx.font = 'bold 12px ui-monospace, monospace'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.lineWidth = 3; cx.strokeStyle = 'rgba(8,10,16,.85)';
    for (const p of players) {
        if (!p.alive || !p.has('fighter') || !p.dirHist)
            continue;
        const steps = fighterSeq(p.dirHist, p.fTick).slice(-6).map(s => (p.face >= 0 ? s.d : FIGHTER_MIRROR[s.d]));
        if (!steps.length)
            continue;
        const txt = steps.join(' '), y = p.y - p.r - 18;
        cx.strokeText(txt, p.x, y);
        cx.fillStyle = p.color; cx.fillText(txt, p.x, y);
    }
    cx.restore();
}

function fighterCircle() { // a full circle from any starting point, either way round
    const ring = [4, 1, 2, 3, 6, 9, 8, 7], out = [];
    for (const d of [1, -1])
        for (let s = 0; s < 8; s++) {
            let m = '';
            for (let k = 0; k < 8; k++)
                m += ring[(s + d * k + 16) % 8];
            out.push(m);
        }
    return out.join('|');
}

// ---- fireballs: straight-flying projectiles. They knock what they hit (nothing dies), then vanish. ----
PROJ_TYPES.fireball = {
    r: PL / 2, life: 2, hitsTeammates: FIGHTER_HITS_TEAMMATES,
    onHit(f, b) {
        const dir = Math.cos(f.ang) >= 0 ? 1 : -1, kn = b.boost !== undefined ? f.ballKnock : f.knock; // heading, not f.dir: a portal can turn it round
        b.vx = dir * kn.x;
        b.vy = kn.y;
        if (b instanceof Player)
            fighterStun(b, f.stun);
        if (b.boost !== undefined) {
            const s = Math.hypot(b.vx, b.vy);
            if (s > BALL_VMAX)
                b.boost = Math.max(b.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
        }
        if (f.owner && !f.owner.sim) {
            const sp = Math.hypot(b.vx, b.vy) || 1;
            events.onBatHit(f.owner, b, f.x, f.y, b.vx / sp, b.vy / sp, Math.min(1, sp / 1500));
        }
        return true;
    },
    sub(f, T) {
        if (projDefaultSub(f, T) === 'remove')
            return 'remove';
        for (const g of projectiles) // opposing fireballs cancel (marked now, removed next tick)
            if (g !== f && g.type === 'fireball' && g.team !== f.team && Math.hypot(g.x - f.x, g.y - f.y) < g.r + f.r) {
                g.life = 0;
                f.life = 0;
                return;
            }
    },
};
PROJ_TYPES.chevron = {
    r: PL / 2, life: 3, g: 0, hitsTeammates: true,
    stun: 0.2, knock: 100, // u/s: barely a nudge
    onHit(p, b) { // returns true if the projectile is used up
        const T = PROJ_TYPES.chevron, sp = Math.hypot(p.vx, p.vy) || 1;
        b.vx += p.vx / sp * T.knock;
        b.vy += p.vy / sp * T.knock;
        if (b instanceof Player)
            fighterStun(b, { t: T.stun }); // Awakened players shrug it off inside fighterStun
        return true;
    },
};

function spawnFireball(p, mv, f = p.face >= 0 ? 1 : -1) {
    const fb = mv.fire, x = p.x + f * fb.x, y = p.y + fb.y;
    if (boomBlocked(x, y, fb.r))
        return;
    const mine = projOf('fireball').filter(q => q.owner === p);
    while (mine.length >= FIGHTER_FIREBALL_MAX)
        projectiles.splice(projectiles.indexOf(mine.shift()), 1);
    spawnProjectile('fireball', p, x, y, f * fb.vx, 0, { r: fb.r, life: fb.life, knock: fb.knock, ballKnock: fb.ballKnock || fb.knock, stun: fb.stun });
}

const FIGHTER_BY_ID = {};
for (const mv of FIGHTER_MOVES)
    FIGHTER_BY_ID[mv.id] = mv;
const FIGHTER_ORDER = [...FIGHTER_MOVES].sort((a, b) => b.motion.length - a.motion.length); // longest motion first, plain presses last: a dragon punch beats the fireball it contains

// True while the player stands on their own half of the arena (the half of the team they belong to, taking side swaps into account).
const homeSide = p => (sideSwap(p.team) === 0) === (p.x < NETX);

// ---- reading the keys ----
// The numpad digit for the arrow keys held right now, in ABSOLUTE terms (6 = screen right, 2 = down, 8 = up). x = the horizontal part, already resolved (see fighterRecord).
function fighterDir(k, x = (k.r ? 1 : 0) - (k.l ? 1 : 0)) {
    const y = (k.dn ? 1 : 0) - (k.up ? 1 : 0); // screen y points down
    return 5 + x - 3 * y;
}
// The history as a list of steps with neutral left out: [{ d, t0, t1 }], t0 = tick the direction began, t1 = tick the next entry began (or `now` if it is still held).
// The same direction either side of a neutral stays TWO steps, so a double tap (44, 66) can be recognized.
function fighterSeq(hist, now) {
    const out = [];
    for (let i = 0; i < hist.length; i++) {
        const d = hist[i][0];
        if (d === 5)
            continue;
        out.push({ d, t0: hist[i][1], t1: i + 1 < hist.length ? hist[i + 1][1] : now });
    }
    return out;
}
// Does the sequence end with this motion (digits, already facing the right way)? Matched backwards from the newest step.
function fighterMatch(seq, motion, now, motionT = FIGHTER_MOTION_T) {
    let i = seq.length - 1, last = null, first = null, used = 0;
    for (let j = motion.length - 1; j >= 0; j--) {
        const m = motion[j];
        if (i >= 0 && seq[i].d === m) {
            if (!last)
                last = seq[i];
            first = seq[i];
            used++;
            i--;
        } else if (!FIGHTER_DIAG.includes(m))
            return false; // a missing diagonal is forgiven, a missing straight step is not
    }
    if (used < 2)
        return false;
    const T = s => Math.round(s / DT);
    return now - last.t1 <= T(FIGHTER_LEAD_T) && now - first.t1 <= T(motionT);
}
function fighterMotionOk(hist, motion, face, now, motionT) {
    const digits = motion.split('').map(c => (face < 0 ? FIGHTER_MIRROR[+c] : +c));
    return fighterMatch(fighterSeq(hist, now), digits, now, motionT);
}

// ---- hitboxes ----
function fighterBox(p, hb, f = p.face >= 0 ? 1 : -1) { // where a hitbox is right now; f = the direction the move was latched with
    if (hb.rx)
        return { x: p.x + f * hb.x, y: p.y + hb.y, r: hb.ry, rx: hb.rx, ry: hb.ry }; // r (the short radius) only places the contact sparks
    return { x: p.x + f * hb.x, y: p.y + hb.y, r: hb.r };
}
// One tick of an active hitbox: everything whose circle overlaps it, and was not hit already by this move, is knocked. Hits the death ball, decoys, other players (teammates only if
// FIGHTER_HITS_TEAMMATES) and arrows. Nothing here kills: only the death ball kills.
function fighterSweepDir(p, mv) { // which way the swing opens: the horizontal key held right now, else the way the fighter faces
    const h = (p.keys.r ? 1 : 0) - (p.keys.l ? 1 : 0);
    return mv.sweep.steer && h ? h : (p.face >= 0 ? 1 : -1);
}
function fighterSweep(p, m, mv) {
    const sw = mv.sweep, f = m.dir, s = Math.sign(sw.a1 - sw.a0) || 1; // f was latched when the move started
    const u = Math.max(0, Math.min(1, (m.t - mv.startup + 0.5) / mv.active)), a = sw.a0 + (sw.a1 - sw.a0) * u;
    return { x: p.x + f * sw.r * Math.cos(a), y: p.y - sw.r * Math.sin(a), r: sw.hitR, tx: -f * Math.sin(a) * s, ty: -Math.cos(a) * s };
}
function fighterHits(p, m, mv, ball) {
    const f = m.dir, box = mv.sweep ? fighterSweep(p, m, mv) : fighterBox(p, mv.hit, f), targets = [ball];
    for (const d of decoys)
        if (!d.dead)
            targets.push(d);
    for (const q of players)
        if (q !== p && q.alive && (FIGHTER_HITS_TEAMMATES || q.team !== p.team))
            targets.push(q);
    for (const a of projOf('arrow'))
        targets.push(a);
    for (let i = 0; i < targets.length; i++) {
        const b = targets[i], isArrow = b.stuck !== undefined, bit = isArrow ? 0 : 1 << i, seen = !isArrow && (m.hits & bit);
        if (isArrow ? b.immune > 0 : (seen && !mv.sweep))
            continue; // a sweep keeps hold of what is inside it; everything else hits a target once
        const dx = b.x - box.x, dy = b.y - box.y, d = Math.hypot(dx, dy), tr = b.r === undefined ? ARROW_R : b.r;
        if (box.rx ? (dx / (box.rx + tr)) ** 2 + (dy / (box.ry + tr)) ** 2 >= 1 : d >= box.r + tr)
            continue; // (an ellipse is tested by growing its radii by the target's radius: close enough to the true shape)
        m.hits |= bit;
        const isBall = b.boost !== undefined;
        let nvx, nvy;
        if (mv.sweep) { // flung along the swing: front -> up -> over -> behind
            const sw = mv.sweep, sp = isBall ? (sw.ballSpeed || sw.speed) : sw.speed, c = sw.carry === undefined ? FIGHTER_CARRY : sw.carry; // c = how much of your own velocity the target takes
            nvx = box.tx * sp + p.vx * c;
            nvy = box.ty * sp + p.vy * c;
        } else {
            const kn = isBall && mv.ballKnock ? mv.ballKnock : mv.knock;
            const side = mv.away ? (b.x >= p.x ? 1 : -1) : f; // away: pushed out from the fighter, whichever side it is on
            nvx = side * kn.x + p.vx * FIGHTER_CARRY;
            nvy = kn.y + p.vy * FIGHTER_CARRY;
        }
        if (isArrow)
            arrowKnock(b, nvx, nvy, p.team, p);
        else {
            b.vx = nvx;
            b.vy = nvy;
            if (b instanceof Player)
                fighterStun(b, mv.stun);
        }
        if (isBall) { // (was `if (ball)`, which is always true and would write NaN into a player's boost)
            const s = Math.hypot(b.vx, b.vy);
            if (s > BALL_VMAX)
                b.boost = Math.max(b.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
        }
        if (!p.sim && !seen) { // the effect only fires on the first contact
            const sp = Math.hypot(nvx, nvy) || 1, cd = Math.min(box.r, d);
            events.onBatHit(p, b, box.x + (d > 1 ? dx / d : 0) * cd, box.y + (d > 1 ? dy / d : 0) * cd, nvx / sp, nvy / sp, Math.min(1, sp / 1500));
        }
    }
}

function fighterStun(q, st) { // st = { t } seconds. Awakened players shrug it off.
    if (!st || q.awakeT > 0)
        return;
    q.stunT = Math.max(q.stunT, st.t);
    q.move = null; q.fBuf = null; q.casts.length = 0; q.arrowQueued = false;
    q.rope = null; q.pending = null; q.onBall = false; q.tball = null; q.driveT = 0; q.kickReq = false; q.stretchT = 0;
    q.hopT = 0; q.clinging = false;
}

mixin(Player, {
    // Is a move (or a stun) holding the player? (Player.step zeroes steering while it is.)
    moveLocked() { return this.stunT > 0 || !!this.move; },
    // Once per tick BEFORE the key presses are handled (so a press this very tick sees this tick's direction): keep the direction history and the facing.
    fighterRecord() {
        if (!this.has('fighter')) { // swapped away, or one-special mode: forget everything
            if (this.dirHist.length || this.move) {
                this.dirHist = [];
                this.move = null;
            }
            return;
        }
        this.fTick++;
        const k = this.keys;
        if (k.l && !this.pL) this.hLast = -1; // both horizontal keys held: the one pressed most recently counts
        if (k.r && !this.pR) this.hLast = 1;
        this.pL = k.l; this.pR = k.r;
        const hx = k.l && k.r ? this.hLast : (k.r ? 1 : 0) - (k.l ? 1 : 0);
        const d = fighterDir(k, hx), h = this.dirHist, old = this.fTick - Math.round(FIGHTER_BUFFER_T / DT);
        if (!h.length || h[h.length - 1][0] !== d)
            h.push([d, this.fTick]);
        while (h.length > 1 && h[1][1] <= old)
            h.shift(); // (the entry before the window stays, so what was held when the window opened is still known)
        if (!this.move && this.stunT <= 0) { // forward = toward the net; frozen while a move runs, so crossing the net mid-move cannot flip it
            const off = this.x - NETX;
            if (Math.abs(off) > FIGHTER_NET_DEAD)
                this.face = off < 0 ? 1 : -1;
        }
    },
    // A Fighter button went down (called from startAbility, once for 'sp' and once for 'sp2'). Returns true if a move started.
    fighterPress(key, at = this.fTick) {
        if (this.move) {
            const cur = FIGHTER_BY_ID[this.move.id];
            // a normal (no motion) can be cancelled into a special once it is active (and, by default, only if it hit something)
            const cancel = cur && cur.cancel && this.move.t >= cur.startup && (!FIGHTER_CANCEL_NEEDS_HIT || this.move.hits !== 0);
            if (!cancel) {
                this.fBuf = { key, t: this.fTick }; // remember it: it fires when the move ends
                return false;
            }
        }
        if (!this.dirHist.length)
            return false;
        const hist = at === this.fTick ? this.dirHist : this.dirHist.filter(e => e[1] <= at); // a buffered press is judged as of when it was pressed
        for (const mv of FIGHTER_ORDER) {
            if (mv.button !== key)
                continue;
            if (this.move && mv.id === this.move.id)
                continue; // no cancelling a move into itself
            if (mv.zone && (mv.zone === 'home') !== homeSide(this))
                continue; // home-only / invader-only moves
            if (mv.motion && !mv.motion.split('|').some(m => fighterMotionOk(hist, m, this.face, at, mv.motionT)))
                continue;
            const f = this.face >= 0 ? 1 : -1;
            this.move = { id: mv.id, t: 0, hits: 0, dir: mv.sweep ? fighterSweepDir(this, mv) : (mv.back ? -f : f) };
            this.fBuf = null;
            if (mv.motion)
                this.dirHist = [this.dirHist[this.dirHist.length - 1]]; // the motion is spent
            return true;
        }
        return false;
    },
    fighterBuffered() { // a move just ended: fire a press that was waiting
        const b = this.fBuf;
        this.fBuf = null;
        if (b && this.fTick - b.t <= Math.round(FIGHTER_BTN_BUFFER_T / DT))
            this.fighterPress(b.key, b.t);
    },
    // Once per tick AFTER the key presses: advance the move that is running.
    fighterStep(ball) {
        const m = this.move;
        if (!m)
            return;
        const mv = FIGHTER_BY_ID[m.id];
        if (!mv) {
            this.move = null;
            return;
        }
        if (m.t === mv.startup) { // the active phase begins: the move's own lunge / hop is ADDED to what you are already doing
            if (mv.vx !== undefined)
                this.vx += m.dir * mv.vx;
            if (mv.vy !== undefined)
                this.vy = Math.min(this.vy, 0) + mv.vy; // keeps upward speed you already have, but never adds to a fall
            if (mv.fire && !this.sim)
                spawnFireball(this, mv, m.dir);
            if (mv.burst && !this.sim)
                spawnBurst(this, mv);
        }
        if (mv.rehit && m.t > mv.startup && (m.t - mv.startup) % mv.rehit === 0)
            m.hits = 0; // multi-hit moves forget what they hit, so the next pulse can hit it again
        if ((mv.hit || mv.sweep) && m.t >= mv.startup && m.t < mv.startup + mv.active && !this.sim)
            fighterHits(this, m, mv, ball);
        if (++m.t >= mv.startup + mv.active + mv.recovery) {
            this.move = null;
            this.fighterBuffered();
        }
    },
});