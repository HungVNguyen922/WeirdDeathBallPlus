// PHYSICS - the simulated bodies: up to four players (1v1 or 2v2), the death ball, plinko pegs and decoys.
const pegs = []; // floating bounce pegs {x, y, vx, vy, r, team, owner, flash, life}
const decoys = []; // decoy balls (Ball instances with .decoy = true, .team and .owner)
// Player ids: 0 = Blue, 1 = Red (always in play); 2 = Blue's teammate, 3 = Red's teammate (2v2 only).
const BLUE = '#42a5f5', RED = '#ef5350';
const p1 = new Player(0, 250, BLUE, 0), p2 = new Player(1, W - 250, RED, 1);
const p3 = new Player(0, 0, BLUE, 2), p4 = new Player(1, 0, RED, 3);
const allPlayers = [p1, p2, p3, p4];
const players = [p1, p2], ball = new Ball(); // `players` = who is in the current match (edited in place by layoutTeams)
// 2v2 spawns: one player this far from the ball (center to center), the other this far from the goal scoop (measured from where the ramp meets the floor).
const SPAWN_BALL_D = 4 * PL, SPAWN_SCOOP_D = 2 * PL;
function layoutRoster(ids, teams = ids.map(id => id % 2)) { // teams[k] = the team of ids[k]; takes effect on the next newRound()
    players.length = 0;
    ids.forEach((id, k) => {
        const p = allPlayers[id];
        p.team = teams[k];
        p.color = p.team === 0 ? BLUE : RED;
        players.push(p);
    });
    for (const t of [0, 1]) { // each team spawns spread along its own side: the first player nearest the ball, the others toward the goal scoop
        const mine = players.filter(p => p.team === t), n = mine.length;
        const hi = NETX - SPAWN_BALL_D, span = Math.max(hi - (RUN + SPAWN_SCOOP_D), (n - 1) * 40); // (at least 40 u apart, so four fit)
        mine.forEach((p, k) => {
            const x = n === 1 ? 250 : hi - span * k / (n - 1);
            p.sx = t === 0 ? x : W - x;
        });
    }
}
function layoutTeams(size) { // 1 = 1v1, 2 = 2v2 (offline)
    layoutRoster(size === 2 ? [0, 1, 2, 3] : [0, 1]);
}
function removeDecoy(d) { // gone (recast, fell out, round over): anyone tethered to it lets go
    const i = decoys.indexOf(d);
    if (i >= 0)
        decoys.splice(i, 1);
    for (const p of allPlayers)
        if (p.tball === d) {
            p.rope = null;
            p.onBall = false;
            p.tball = null;
        }
}
function spawnSwarmBall(owner, x) { // the campaign's swarm: an extra death ball that kills the other team on touch, never scores, and does not replace anything
    const d = new Ball();
    d.x = x; d.y = d.r + 10;
    d.decoy = true;
    d.swarm = true;
    d.age = 0;
    d.team = owner.team;
    d.owner = owner;
    decoys.push(d);
    return d;
}
function spawnDecoy(owner, x, y) { // one decoy per player: a new one replaces that player's old one (a swarm ball is not a decoy)
    for (const d of decoys.filter(d => d.owner === owner && !d.swarm))
        removeDecoy(d);
    const d = new Ball();
    d.x = x; d.y = y;
    d.decoy = true;
    d.team = owner.team;
    d.owner = owner;
    decoys.push(d);
}
