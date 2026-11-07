// PHYSICS - mines: the MINES special. Never draws (see render/mines.js).
// Load order: after swap.js (it reads players, ball, decoys, arrows, the terrain lists and the seesaw) and before game/rules.js (which calls stepMines() and clearMines()).
// Tuning numbers live in constants.js (MINE_*).
//
// HOW IT PLAYS: press the special key and a mine is planted on the nearest surface 1 s later (nothing floats: no surface within MINE_REACH of you means nothing happens). Up to MINE_MAX
// mines per player. Mines planted within MINE_STACK_R of one of your own join it: a stack of n is one mine that counts n times. Hold the special key and press WEIGHT to blow them all up:
// every player, the death ball, every decoy and every arrow within MINE_R of a mine is pushed away from it, n times as hard for a stack, and the pushes of all your nearby mines add up.
const mines = []; // { id, x, y, lift, nx, ny, n, owner, team, flash }  y is the surface point WITHOUT the seesaw offset; lift says which part of the seesaw carries it; (nx, ny) points out of the surface
let mineSeq = 0;  // last mine id handed out (saved, so a rollback hands out the same ids)

// Every surface a mine can go on: [x1, y1, x2, y2, lift]. lift: 'l' / 'r' = rides that side's seesaw end (ramps, tunnel floors, hatchets), '' = never moves.
// (The flat floor between the ramps is handled separately in nearestSurface: it is a curve, lift 'f'.)
const MINE_SEGS = [];
for (const s of SEGS.slice(0, 2)) MINE_SEGS.push([...s, s[0] < NETX ? 'l' : 'r']);      // the two ramps
for (const s of SEGS.slice(2)) MINE_SEGS.push([...s, '']);                             // the middle peak
MINE_SEGS.push([PL, 0, W - PL, 0, '']);                                                // ceiling (between the goal juts)
for (const s of LEDGES) MINE_SEGS.push([...s, '']);                                    // goal walls
for (const s of NETSEGS) MINE_SEGS.push([...s, '']);                                   // the net
// goal barrier: the thick team-coloured strip across each goal opening (10 u wide, so the mine sits on its middle)
MINE_SEGS.push([5, GOAL_Y0, 5, GOAL_Y1, ''], [W - 5, GOAL_Y0, W - 5, GOAL_Y1, '']);

const mineLift = m => (m.lift === 'f' ? sawY(m.x) : m.lift === 'l' ? sawY(0) : m.lift === 'r' ? sawY(W) : 0); // how far the seesaw has moved the surface this mine sits on
const mineY = m => m.y + mineLift(m);                                                                        // its real height right now
const mineCount = p => mines.reduce((n, m) => n + (m.owner === p ? m.n : 0), 0);

// The closest point on any mineable surface to (px, py): { x, y, lift, nx, ny, d }. (nx, ny) is the unit vector from the surface to (px, py), so it faces the side you were on.
function nearestSurface(px, py) {
    let best = null;
    const consider = (wx, wy, y, lift) => { // wx, wy = the point in the world now; y = the same point without the seesaw offset
        const d = Math.hypot(px - wx, py - wy);
        if (best && d >= best.d)
            return;
        const m = d || 1;
        best = { x: wx, y, lift, nx: d > 1e-6 ? (px - wx) / m : 0, ny: d > 1e-6 ? (py - wy) / m : -1, d };
    };
    const fx = Math.max(RUN, Math.min(W - RUN, px)); // the flat floor between the ramps (it follows the quake)
    consider(fx, H + sawY(fx), H, 'f');
    for (const [x1, y1, x2, y2, lift] of MINE_SEGS) {
        const off = lift === 'l' ? sawY(0) : lift === 'r' ? sawY(W) : 0, dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1 - off) * dy) / len2));
        consider(x1 + t * dx, y1 + t * dy + off, y1 + t * dy, lift);
    }
    return best;
}

function clearMines() { // new round
    mines.length = 0;
    for (const p of allPlayers) {
        p.mineFx = null;
        p.minePrevX = false;
    }
}

// The 1 s cast ran out: the mine goes in (or joins one of yours that is close enough). Returns false if there was no room.
function placeMine(p, c) {
    if (p.sim || mineCount(p) >= MINE_MAX)
        return false;
    const wx = c.x, wy = c.y + mineLift(c);
    let near = null, nd = MINE_STACK_R;
    for (const m of mines)
        if (m.owner === p) {
            const d = Math.hypot(m.x - wx, mineY(m) - wy);
            if (d <= nd) {
                nd = d;
                near = m;
            }
        }
    if (near) {
        near.n++;
        near.flash = 1;
    } else
        mines.push({ id: ++mineSeq, x: c.x, y: c.y, lift: c.lift, nx: c.nx, ny: c.ny, n: 1, owner: p, team: p.team, flash: 1 });
    return true;
}

// Blow up all of p's mines. Returns true if any went off.
function detonateMines(p) {
    const mine = mines.filter(m => m.owner === p);
    if (!mine.length)
        return false;
    const hits = [];
    p.mineFx = { t: MINE_FX, pts: mine.map(m => ({ x: m.x, y: mineY(m), n: m.n })), hits };
    const bodies = [...players.filter(q => q.alive), ball, ...decoys.filter(d => !d.dead), ...projOf('arrow'), ...projOf('block')];
    for (const q of bodies) {
        const isArrow = q.stuck !== undefined, qr = q.r === undefined ? ARROW_R : q.r;
        if (isArrow && q.immune > 0)
            continue;
        let kx = 0, ky = 0;
        for (const m of mine) { // every mine pushes it away from itself; a stack of n pushes n times as hard
            const my = mineY(m), dx = q.x - m.x, dy = q.y - my, d = Math.hypot(dx, dy), reach = MINE_R + qr;
            if (d > reach)
                continue;
            const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1; // (exactly on top of it: straight up)
            const power = Math.pow(1 - Math.min(1, d / reach), MINE_FALLOFF);
            const k = (m.n * MINE_STACK_FACTOR) * (MINE_KICK_MIN + (MINE_KICK_MAX - MINE_KICK_MIN) * power);
            kx += nx * k;
            ky += ny * k;
        }
        const km = Math.hypot(kx, ky);
        if (km < 1e-6)
            continue;
        if (km > MINE_KICK_CAP) {
            kx *= MINE_KICK_CAP / km;
            ky *= MINE_KICK_CAP / km;
        }
        hits.push({ x: q.x, y: q.y, r: qr, ux: kx / km, uy: ky / km, k: Math.min(1, km / MINE_KICK_MAX) });
        if (isArrow)
            arrowKnock(q, q.vx + kx, q.vy + ky);
        else {
            q.vx += kx;
            q.vy += ky;
        }
        if (q.boost !== undefined) { // a ball already flying fast: lift its speed cap for a moment so the push is not clipped (same as Explode)
            const s = Math.hypot(q.vx, q.vy);
            if (s > BALL_VMAX)
                q.boost = Math.max(q.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
        }
    }
    for (let i = mines.length - 1; i >= 0; i--)
        if (mines[i].owner === p)
            mines.splice(i, 1);
    return true;
}

function stepMines() { // once per tick, after the bodies have moved
    for (const m of mines)
        m.flash = Math.max(0, (m.flash || 0) - DT / MINE_FX);
    for (const p of players) {
        const wt = !!p.keys.x, press = wt && !p.minePrevX, held = p.slots().some(([key, id]) => id === 'mines' && p.keys[key]);
        p.minePrevX = wt;
        if (p.alive && held && press && detonateMines(p)) {
            for (const c of p.casts.filter(c => c.type === 'mine'))
                p.endCast(c); // a plant that was in progress is dropped
            p.cd.mines = MINE_COOLDOWN;
        }
    }
}