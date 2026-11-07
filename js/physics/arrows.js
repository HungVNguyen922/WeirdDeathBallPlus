// PHYSICS - arrows: the ARROW special's aim / charge logic and its projectiles. Never draws.
// Load order: after bodies.js (it reads players, ball and decoys at runtime) and before game/rules.js (which calls stepProjectiles()).
// Tuning numbers live in constants.js (ARROW_*).
const stuckSegs = []; // centre lines [x1, y1, x2, y2] of the arrows stuck in the terrain: solid for players, the death ball and decoys (thickness ARROW_HALF_W)
const ARROW_SNAP = { l: Math.PI, r: 0, u: -Math.PI / 2, d: Math.PI / 2 }; // angles are screen angles: 0 = right, -PI/2 = up, PI/2 = down, PI = left
const wrapAng = a => Math.atan2(Math.sin(a), Math.cos(a));
// Everything an arrow sticks into. [segment list, extra thickness]: the juts / tunnel ceilings are drawn thick, so they count as thick.
const ARROW_SOLIDS = [[SEGS, 0], [OUTSEGS, 0], [PADS, 0], [LEDGES, LEDGE_T], [OUTCEIL, LEDGE_T]];

// One physics step of an arrow cast, called from Player.step while the special key is held. c = the cast, k = the player's keys.
// Charge: fills over ARROW_CHARGE_T and then just stays full (that is the cap). Aim: starts pointing up; holding RIGHT turns it clockwise and LEFT
// counter-clockwise, all the way round (so it can point below the player too); tapping any arrow key twice within ARROW_DBL_T snaps it that way at once.
function arrowAimStep(c, k) {
    c.charge = Math.min(1, c.charge + DT / ARROW_CHARGE_T);
    const now = { l: !!k.l, r: !!k.r, u: !!k.up, d: !!k.dn };
    for (const id in now) {
        c.tap[id] = Math.max(0, c.tap[id] - DT);
        if (now[id] && !c.prev[id]) { // a fresh press
            if (c.tap[id] > 0) { // the second tap, in time: snap
                c.ang = ARROW_SNAP[id];
                c.tap[id] = 0;
                c.noTilt = true; // the second tap is still held down: it must not keep turning the arrow
            } else
                c.tap[id] = ARROW_DBL_T;
        }
        c.prev[id] = now[id];
    }
    if (!now.l && !now.r)
        c.noTilt = false;
    if (now.l !== now.r && !c.noTilt) // exactly one of LEFT / RIGHT is held: RIGHT turns the aim clockwise, LEFT counter-clockwise, all the way round (screen y points down, so +angle is clockwise)
        c.ang = wrapAng(c.ang + (now.r ? 1 : -1) * ARROW_TURN * DT);
}

function arrowHitsTerrain(a) {
    if (a.y - ARROW_R < 0)
        return true; // ceiling
    if (a.x > 0 && a.x < W && a.y + ARROW_R > H)
        return true; // floor
    for (const [list, t] of ARROW_SOLIDS)
        for (const sg of list) {
            const q = nearestOnSeg(sg, a.x, a.y);
            if (Math.hypot(a.x - q.x, a.y - q.y) < ARROW_R + t)
                return true;
        }
    return false;
}

// An arrow reached a living enemy or a ball. Returns true if it was used up. Teammates and the shooter are passed through.
function arrowStrike(a) {
    for (const p of players)
        if (p.alive && p.team !== a.team && Math.hypot(p.x - a.x, p.y - a.y) < p.r + ARROW_R) {
            if (ARROW_KILLS) {
                p.alive = false;
                p.rope = null;
                p.onBall = false;
            } else {
                p.vx += a.vx * ARROW_KNOCK;
                p.vy += a.vy * ARROW_KNOCK;
            }
            return true;
        }
    for (const b of [ball, ...decoys])
        if (Math.hypot(b.x - a.x, b.y - a.y) < b.r + ARROW_R) { // the death ball (or a decoy) takes a share of the arrow's velocity
            b.vx += a.vx * ARROW_BALL_K;
            b.vy += a.vy * ARROW_BALL_K;
            const s = Math.hypot(b.vx, b.vy);
            if (s > BALL_VMAX) // big hits raise the ball's speed cap briefly, like a hatchet hit
                b.boost = Math.max(b.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
            return true;
        }
    return false;
}

// An impulse (bat, blast) sets a loose arrow's velocity: it is dislodged if stuck, flies again, and cannot be hit again for ARROW_IMMUNE_T s.
// team / owner: pass them to hand the arrow to another team (a batted arrow).
function arrowKnock(a, vx, vy, team = null, owner = null) {
    const s = Math.hypot(vx, vy), k = s > ARROW_VCAP ? ARROW_VCAP / s : 1;
    a.vx = vx * k;
    a.vy = vy * k;
    if (a.stuck) {
        a.stuck = false;
        a.ghost = ARROW_GHOST_T;
    }
    if (ARROW_REARM)
        a.spent = false;
    a.life = Math.max(a.life, ARROW_KNOCK_LIFE);
    a.ang = Math.atan2(a.vy, a.vx);
    a.immune = ARROW_IMMUNE_T;
    if (team !== null) {
        a.team = team;
        a.owner = owner;
    }
}

// Players are solid for a loose arrow that cannot strike them: teammates, the shooter (after a short grace) and any spent arrow. The arrow is light, so it takes almost all of the
// change in relative velocity along the contact line. A live enemy arrow is not handled here: arrowStrike hits them instead.
function arrowBumpPlayers(a) {
    for (const p of players) {
        if (!p.alive || (!a.spent && p.team !== a.team))
            continue;
        if (p === a.owner && ARROW_LIFE - a.life < ARROW_BUMP_GRACE)
            continue;
        const dx = a.x - p.x, dy = a.y - p.y, d = Math.hypot(dx, dy), min = p.r + ARROW_R;
        if (d >= min || d === 0)
            continue;
        const nx = dx / d, ny = dy / d, vn = (a.vx - p.vx) * nx + (a.vy - p.vy) * ny;
        a.x = p.x + nx * min; // out of the player
        a.y = p.y + ny * min;
        if (vn >= 0)
            continue; // already moving apart
        const vx0 = a.vx, vy0 = a.vy, j = -(1 + ARROW_BUMP_E) * vn;
        a.vx += j * nx;
        a.vy += j * ny;
        crashPush(p.crashK, a, vx0, vy0); // Awakened: the push you give is multiplied
        const s = Math.hypot(a.vx, a.vy);
        if (s > ARROW_VCAP) {
            a.vx *= ARROW_VCAP / s;
            a.vy *= ARROW_VCAP / s;
        }
        if (!a.spent)
            a.ang = Math.atan2(a.vy, a.vx);
    }
}

// A loose arrow that touches a plinko peg is reflected off it, like light off a mirror: the velocity component along the line from the peg's centre
// to the arrow is reversed (scaled by PEG_ARROW_E). Pegs are fixed, so nothing is transferred to them. Returns true if it bounced.
function arrowPegBounce(a) {
    for (const q of pegs) {
        const dx = a.x - q.x, dy = a.y - q.y, d = Math.hypot(dx, dy), min = a.r + q.r;
        if (d >= min || d === 0)
            continue;
        const nx = dx / d, ny = dy / d;
        a.x = q.x + nx * min;                      // out of the peg
        a.y = q.y + ny * min;
        const vn = a.vx * nx + a.vy * ny;
        if (vn >= 0)
            continue;                              // already moving away
        a.vx -= (1 + PEG_ARROW_E) * vn * nx;
        a.vy -= (1 + PEG_ARROW_E) * vn * ny;
        const s = Math.hypot(a.vx, a.vy);
        if (s > ARROW_VCAP) {
            a.vx *= ARROW_VCAP / s;
            a.vy *= ARROW_VCAP / s;
        }
        a.ang = Math.atan2(a.vy, a.vx);
        a.life = Math.max(a.life, ARROW_KNOCK_LIFE);
        if (PEG_CLAIMS_ARROWS) {
            a.team = q.team;
            a.owner = q.owner;
            if (ARROW_REARM)
                a.spent = false;
        }
        q.flash = 1;                               // the peg's hit effect (the renderer reads these)
        q.nx = -nx;
        q.ny = -ny;
        q.hits = (q.hits | 0) + 1;
        return true;
    }
    return false;
}

PROJ_TYPES.arrow = {
    r: ARROW_R, life: ARROW_LIFE, g: ARROW_G, swappable: true,
    steer(a) {
        a.immune = Math.max(0, (a.immune || 0) - DT);
        a.ghost = Math.max(0, (a.ghost || 0) - DT);
        if (a.x < -OUT_D || a.x > W + OUT_D || a.y > H + PIT)
            return 'remove';
        if (a.stuck)
            return 'hold'; // stuck arrows still tick their life down, but do not move
    },
    sub(a) {
        arrowPegBounce(a);
        arrowBumpPlayers(a);
        const hitBlock = arrowVsBlocks(a); // a live arrow reaching a block pushes it and is used up; a spent one just bounces off
        if (!a.spent && (hitBlock || arrowStrike(a))) { // one hit: bounces off limp and keeps falling
            arrowBumpPlayers(a);
            a.spent = true;
            a.vx *= -ARROW_SPENT_K;
            a.vy *= -ARROW_SPENT_K;
            return 'stop';
        }
        if (!(a.ghost > 0) && arrowHitsTerrain(a)) {
            a.stuck = true;
            a.vx = a.vy = 0;
            a.life = ARROW_STICK_T;
            return 'stop';
        }
    },
    after(a) { if (!a.stuck && !a.spent) a.ang = Math.atan2(a.vy, a.vx); }, // nose-dives with gravity
};
function fireArrow(p, c) {
    const ux = Math.cos(c.ang), uy = Math.sin(c.ang), v = ARROW_V_MIN + (ARROW_V_MAX - ARROW_V_MIN) * c.charge, d = p.r + ARROW_R + 2;
    spawnProjectile('arrow', p, p.x + ux * d, p.y + uy * d, ux * v, uy * v, { ang: c.ang, stuck: false, immune: 0, ghost: 0 });
}