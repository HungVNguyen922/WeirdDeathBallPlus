const projectiles = [];
let projSeq = 0; // last projectile id handed out (saved, so a rollback hands out the same ids)
const PROJ_TYPES = {}; // each special registers its own type
const projOf = type => projectiles.filter(p => p.type === type);
function spawnProjectile(type, owner, x, y, vx, vy, extra = {}) { // extra overrides anything (r, life, ang...) and adds per-type fields
    const T = PROJ_TYPES[type];
    const p = { type, id: ++projSeq, x, y, vx, vy, ang: Math.atan2(vy, vx), r: T.r, team: owner.team, owner, life: T.life, pLock: 0, ...extra };
    projectiles.push(p);
    return p;
}
function clearProjectiles() { projectiles.length = 0; stuckSegs.length = 0; }
function rebuildStuck() { // stuck arrows are solid for players and balls (stuckSegs lives in arrows.js)
    stuckSegs.length = 0;
    for (const a of projectiles)
        if (a.stuck)
            stuckSegs.push([a.x - Math.cos(a.ang) * ARROW_LEN, a.y - Math.sin(a.ang) * ARROW_LEN, a.x, a.y]);
}

function projTargets(p, T) {
    const out = [ball, ...decoys.filter(d => !d.dead)];
    for (const q of players)
        if (q.alive && q !== p.owner && (T.hitsTeammates || q.team !== p.team))
            out.push(q);
    return out;
}
function projDefaultSub(p, T) { // die on terrain, or on the first thing T.onHit uses it up on
    if (boomBlocked(p.x, p.y, p.r))
        return 'remove';
    for (const b of projTargets(p, T))
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.r + (b.r || 0) && T.onHit(p, b))
            return 'remove';
}

// Hooks a type may define (all optional):
//   steer(p)   once per tick, before moving.      returns 'remove' | 'hold' (skip movement this tick)
//   g          gravity (u/s^2)
//   sub(p, T)  after every sub-step move.         returns 'remove' | 'stop' (end this tick's sub-steps). Default: projDefaultSub
//   after(p)   once per tick after moving.        returns 'remove'
function stepProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i], T = PROJ_TYPES[p.type];
        let end = !T || (p.life -= DT) <= 0;
        const s = !end && T.steer ? T.steer(p) : null;
        if (s === 'remove')
            end = true;
        if (!end && s !== 'hold') {
            if (T.g)
                p.vy += T.g * DT;
            const n = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy) * DT / p.r));
            for (let k = 0; k < n && !end; k++) {
                p.x += p.vx * DT / n;
                p.y += p.vy * DT / n;
                portalPass(p, true);
                const r = (T.sub || projDefaultSub)(p, T);
                if (r === 'remove') end = true;
                else if (r === 'stop') break;
            }
            if (!end && T.after && T.after(p) === 'remove')
                end = true;
        }
        if (end)
            projectiles.splice(i, 1);
    }
    rebuildStuck();
}
function spawnBurst(p, mv) { // a ring of n shots from the player
    const b = mv.burst, gap = p.r + PROJ_TYPES[b.type].r + 2;
    for (let i = 0; i < b.n; i++) {
        const a = b.a0 + i * Math.PI * 2 / b.n, ux = Math.cos(a), uy = Math.sin(a);
        if (!boomBlocked(p.x + ux * gap, p.y + uy * gap, PROJ_TYPES[b.type].r)) // against a wall: that one fizzles
            spawnProjectile(b.type, p, p.x + ux * gap, p.y + uy * gap, ux * b.speed, uy * b.speed);
    }
}