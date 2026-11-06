// GAME - rules and the fixed-step update loop: rounds, scoring, kills, decoy collisions, and the optional special-ability pick screens.
// Drives the physics modules and never draws. The renderer subscribes through `events`.
const WIN = 9; // points to win the match
const SWAP_EVERY = 5; // points between side swaps (0 = never)
const SWAP_BANNER_T = 1.2; // seconds the "SIDE CHANGE" banner holds the game after the teams trade ends
const POINT_PAUSE = 1.6; // s the world holds still after a point (the goal celebration plays across it)
const WIN_PAUSE = 4;     // s after the point that wins the match (the victory celebration plays across it)
const FLEX_RESPAWN_T = 2; // sandbox: seconds before a dead player comes back
const isSandbox = () => players.length > 0 && (!players.some(p => p.team === 0) || !players.some(p => p.team === 1)); // a team is empty: nothing to beat, nothing to score
let swapBanner = 0; // > 0: the banner is showing and the world is frozen (counts down; part of the saved state)
let swapAt = -1; // the score total the last swap happened at, so one total can only swap once (a double KO must not swap twice)
let score = [0, 0], pause = 0, over = false, msg = '';
let teamSize = 1; // 1 = 1v1, 2 = 2v2
let swapOn = true; // the menu toggle: sides trade places every SWAP_EVERY points (set to false here to make it off by default)
let twoSpecials = false; // the menu toggle: every player has two specials (keys sp and sp2) instead of one
// Hooks the renderer fills in (see main.js). They default to no-ops so the simulation runs headless.
const events = {
    onPoint(team, why) {}, // a point was awarded
    onBodyStep(b) {}, // a body (player, death ball or decoy) just advanced one step
    onPauseTick() {}, // one step of the between-rounds pause
    onNewRound() {}, // the round was reset
    onImpact(p, x, y, ux, uy, speed) {}, // player p hit something at (x, y) hard enough to show it; (ux, uy) points away from what it hit, speed = how hard (u/s)
    onBatHit(p, target, x, y, ux, uy, power) {}, // p's bat hit a ball / decoy / player at (x, y), launching it along (ux, uy); power 0..1
};

// ---- Special-ability pick screens (the "Specials: Pick screens" option in the menu) ----
// With pickFixed on, a special can only be changed on a pick screen. One opens before the first point of a match and after every PICK_EVERY-th point scored.
// The screen is part of the simulation (its state is `pick`, saved by saveState), so online play, prediction and rollback need nothing special: everybody steers it with
// their normal keys. On the screen: left / right / up / down move the cursor over a grid PICK_COLS wide, grapple or special locks the choice in, weight takes it back.
// The computer always takes Dash (it is the only special the AI knows how to use). When everybody is locked in, a short countdown runs and the point starts.
const PICK_EVERY = 5, PICK_COLS = 5, PICK_GO_T = 0.9; // points between screens, icons per row, seconds of "get ready" after the last lock-in
const PICK_LIST = ['dash', 'plinko', 'marionette', 'decoy', 'arrow', 'bat', 'barbwire', 'warp', 'awakened', 'explode', 'hopper', 'boomerang', 'portal', 'swap', 'smoke', 'pong', 'mines', 'split', 'accelerator', 'builder', 'fighter' ]; // the grid, in reading order (same ids as SPECIALS in render/special-menu.js)
const PICK_DUAL = ['fighter']; // abilities that take both slots: they get their own row(s) at the bottom
const pickRows = (() => { // rows of PICK_LIST indices
    const norm = [], dual = [], rows = [];
    PICK_LIST.forEach((id, i) => (PICK_DUAL.includes(id) ? dual : norm).push(i));
    for (const list of [norm, dual])
        for (let i = 0; i < list.length; i += PICK_COLS)
            rows.push(list.slice(i, i + PICK_COLS));
    return rows;
})();
let pickFixed = false; // the toggle: true = specials are only chosen on pick screens, false = swap any time from the keycap
const pick = { on: false, t: 0, go: 0, at: -1, cur: [0, 0, 0, 0], ready: [false, false, false, false], prev: [0, 0, 0, 0], stage: [0, 0, 0, 0] };
const keyBits = k => (k.l ? 1 : 0) | (k.r ? 2 : 0) | (k.up ? 4 : 0) | (k.dn ? 8 : 0) | (k.z ? 16 : 0) | (k.x ? 32 : 0) | (k.sp ? 64 : 0) | (k.sp2 ? 128 : 0);
function openPick() {
    pick.on = true;
    pick.t = 0;
    pick.go = 0;
    pick.at = score[0] + score[1];
    for (const p of allPlayers) {
        pick.cur[p.id] = Math.max(0, PICK_LIST.indexOf(p.special)); // the cursor starts on what you already have
        pick.ready[p.id] = false;
        pick.prev[p.id] = keyBits(p.keys); // a key already held when the screen opens is not a press
        pick.stage[p.id] = 0;
    }
}
function closePick() {
    pick.on = false;
    pick.go = 0;
    for (const p of players) { // keys still held from the screen must not start a cast / kick on the first tick of the point
        p.prevSp = p.keys.sp;
        p.prevSp2 = p.keys.sp2;
        p.prevX = p.keys.x;
    }
}
function maybeOpenPick() { // call right after a round has been set up
    const total = score[0] + score[1];
    if (pickFixed && total % PICK_EVERY === 0 && pick.at !== total) // (the pick.at check stops a double KO from opening the same screen twice)
        openPick();
}
function maybeSwapSides() { // call right before a round is set up
    const total = score[0] + score[1];
    if (swapOn && SWAP_EVERY > 0 && total > 0 && total % SWAP_EVERY === 0 && swapAt !== total) {
        sidesSwapped = !sidesSwapped;
        swapAt = total;
        swapBanner = SWAP_BANNER_T;
    }
}
function pickStep() { // one physics step of an open pick screen
    pick.t += DT;
    if (pick.go > 0) { // everybody is locked in: count down, then play
        pick.go -= DT;
        if (pick.go <= 0)
            closePick();
        return;
    }
    const rows = pickRows.length, rowLen = r => pickRows[r].length;
    for (const p of players) {
        const id = p.id, bits = keyBits(p.keys), fresh = bits & ~pick.prev[id];
        pick.prev[id] = bits;
        if (ai[id].on) { // the computer takes Dash after a moment
            pick.cur[id] = 0;
            if (!pick.ready[id] && pick.t > 0.7 + 0.2 * id) {
                p.special = 'dash';
                pick.ready[id] = true;
            }
            continue;
        }
        if (pick.ready[id]) {
            if (fresh & 32)
                pick.ready[id] = false; // weight takes the choice back (with two specials you are back on your second one)
            continue;
        }
        if (twoSpecials && pick.stage[id] === 1 && (fresh & 32)) { // weight on the second choice: back to the first
            pick.stage[id] = 0;
            pick.cur[id] = Math.max(0, PICK_LIST.indexOf(p.special));
            continue;
        }
        let row = pickRows.findIndex(r => r.includes(pick.cur[id])), col = pickRows[row].indexOf(pick.cur[id]);
        if (fresh & 1)
            col = (col + rowLen(row) - 1) % rowLen(row);
        if (fresh & 2)
            col = (col + 1) % rowLen(row);
        if (fresh & 4)
            row = (row + rows - 1) % rows;
        if (fresh & 8)
            row = (row + 1) % rows;
        col = Math.min(col, rowLen(row) - 1); // the last row is shorter
        pick.cur[id] = pickRows[row][col];
        if (fresh & (16 | 64 | 128)) { // grapple or either special key locks it in
            const choice = PICK_LIST[pick.cur[id]];
            if (choice === 'fighter' && !twoSpecials) continue;           // not available
            if (!twoSpecials) {
                p.special = choice;
                pick.ready[id] = true;
            } else if (pick.stage[id] === 0) { // first choice made: now pick the second
                p.special = choice;
                if (choice === 'fighter') { p.special2 = 'fighter'; pick.ready[id] = true; continue; } // takes both slots
                pick.stage[id] = 1;
                if (p.special2 === choice || p.special2 === 'fighter') p.special2 = PICK_LIST.find(s => s !== choice && s !== 'fighter');
                pick.cur[id] = Math.max(0, PICK_LIST.indexOf(p.special2));
            } else if (choice !== p.special && choice !== 'fighter') { // (the second one cannot be the same as the first: the press does nothing)
                p.special2 = choice;
                pick.ready[id] = true;
            }
        }
    }
    if (players.every(p => pick.ready[p.id]))
        pick.go = PICK_GO_T;
}
function setPickMode(on) { // the menu toggle: restarts the match, so the first pick screen comes up straight away
    pickFixed = !!on;
    resetMatch();
}
// Equip a special in slot 0 (first) or 1 (second). No ability can be in both slots: picking the one the other slot has swaps them.
function equipSpecial(p, slot, id) {
    if (id === 'fighter') {
        if (!twoSpecials || ai[p.id].on) return; // two-special matches only, human only
        p.special = p.special2 = 'fighter';
        return;
    }
    const a = slot ? 'special2' : 'special', b = slot ? 'special' : 'special2';
    if (p[b] === 'fighter')
        p[b] = PICK_LIST.find(s => s !== 'fighter' && s !== id); // leaving Fighter frees the other slot
    else if (p[b] === id)
        p[b] = p[a];
    p[a] = id;
}

function setTwoSpecials(on) { // the menu toggle: restarts the match
    twoSpecials = !!on;
    for (const p of allPlayers) {
        if (!twoSpecials && (p.special === 'fighter' || p.special2 === 'fighter')) {
            p.special = 'dash'; // Fighter only exists with two specials: it turns back into plain specials
            p.special2 = 'plinko';
        }
        if (p.special2 === p.special)
            p.special2 = PICK_LIST.find(s => s !== p.special && s !== 'fighter');
    }
    resetMatch();
}

function setSwapMode(on) { // the menu toggle: restarts the match so the sides start the right way round
    swapOn = !!on;
    resetMatch();
}
function newRound() { 
    pegs.length = 0; 
    decoys.length = 0; 
    clearPortals();
    clearSwaps();
    clearMines();
    clearStatics();
    clearProjectiles();
    ai.forEach((a, i) => aiReset(i)); // forget any look-ahead / plan from the last round
    players.forEach(p => p.reset()); 
    ball.reset(); 
    sawReset(); 
    events.onNewRound(); 
}
function point(t, why) {
    score[t]++;
    events.onPoint(t, why);
    over = score[t] >= WIN;
    msg = `${t === 0 ? 'Blue' : 'Red'} ${why}` + (over ? ' - wins the match!' : '');
    pause = over ? WIN_PAUSE : POINT_PAUSE;
}
function setTeamSize(size) { // 1 = 1v1, 2 = 2v2: restarts the match
    teamSize = size;
    layoutTeams(size);
    resetMatch();
}
function setRoster(ids, teams = ids.map(id => id % 2)) { // the online server and Flex: exactly these players, teams[k] = the team of ids[k]. Restarts the match
    layoutRoster(ids, teams);
    teamSize = [0, 1].some(t => players.filter(p => p.team === t).length > 1) ? 2 : 1;
    resetMatch();
}
function resetMatch() { // R key
    score = [0, 0];
    over = false;
    msg = '';
    pause = 0;
    sidesSwapped = false;
    swapAt = -1;
    swapBanner = 0;
    allPlayers.forEach(p => { p.exploCarry = false; }); // a refund carries into the next ROUND, never into a new match
    newRound();
    pick.on = false;
    pick.go = 0;
    pick.at = -1;
    maybeOpenPick(); // a new match starts with a pick screen when they are on
}
// Barbwire: while its owner holds the special key, their grapple rope kills any other player it touches. The rope is the segment from the owner to the hook; while the hook is
// still in flight it is the part of the line that has reached out so far (the same line the renderer draws). A player counts as touching it when the segment passes within
// their radius (plus BARBWIRE_HALF_W for the rope's own thickness).
function ropeEnd(p) { // where the owner's rope currently ends: the pivot, or the hook's tip in flight; null = no rope out
    if (p.rope)
        return p.rope;
    if (p.pending && p.keys.z) {
        const f = Math.min(1, 1 - p.pending.t / p.pending.t0);
        return { x: p.x + (p.pending.p.x - p.x) * f, y: p.y + (p.pending.p.y - p.y) * f };
    }
    return null;
}
function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function barbedRopeKills() {
    for (const p of players) {
        if (!p.alive || !p.casting('barbwire'))
            continue;
        const e = ropeEnd(p);
        if (!e)
            continue;
        for (const q of players)
            if (q !== p && q.alive && (BARBWIRE_HITS_TEAMMATES || q.team !== p.team) && distToSeg(q.x, q.y, p.x, p.y, e.x, e.y) < q.r + BARBWIRE_HALF_W) {
                q.alive = false; // caught on the wire
                q.rope = null;
                q.pending = null;
                q.onBall = false;
                q.tball = null;
            }
    }
}
// True when the net stands between two players: they are on opposite sides of it, and the line joining their centres crosses it below the
// gap at the top (NET_GAP). Above the gap there is nothing in the way, so touching there still counts.
function netBetween(a, b) {
    if ((a.x < NETX) === (b.x < NETX))
        return false;
    const t = (NETX - a.x) / (b.x - a.x);
    return a.y + t * (b.y - a.y) > NET_GAP;
}
function update() {
    sawStep();
    for (const q of pegs) {
        q.flash = Math.max(0, q.flash - DT / 0.3);
        q.life -= DT;
    }
    for (let i = pegs.length - 1; i >= 0; i--)
        if (pegs[i].life <= 0)
            pegs.splice(i, 1); // fizzled out
    if (!players.length)
        return;
    const sandbox = isSandbox();
    if (swapBanner > 0) { // the sides just changed: hold the world still while the banner plays
        swapBanner = Math.max(0, swapBanner - DT);
        return;
    }
    if (pick.on) { // a pick screen is open: the world holds still until everybody has chosen
        pickStep();
        return;
    }
    if (pause > 0) {
        pause -= DT;
        events.onPauseTick();
        if (pause <= 0) {
            if (over) {
                score = [0, 0];
                over = false;
                pick.at = -1;
                sidesSwapped = false; // a new match starts on the normal sides
                swapAt = -1;
                allPlayers.forEach(p => { p.exploCarry = false; }); // the Explode refund carries between points, never into a new match (resetMatch does the same)
            }
            msg = '';
            maybeSwapSides(); // before newRound, so the players spawn on their new sides
            newRound();
            maybeOpenPick(); // before the first point and after every PICK_EVERY-th point
        }
        return;
    }
    for (const p of players)
        if (ai[p.id].on && p.alive)
            aiDrive(p.id);
    for (const p of players)
        p.auraStep(); // hyper / xeric bookkeeping for everyone first, so no player's step depends on who happens to be stepped first
    for (const p of players)
        if (p.alive) {
            p.step(ball);
            events.onBodyStep(p);
        }
    barbedRopeKills(); // before the body collisions below, so a barbed rope wins over the "touching an enemy overcharges your grapple" rule
    for (let i = 0; i < players.length; i++) // players are solid: everyone bumps everyone (teammates too)
        for (let j = i + 1; j < players.length; j++)
            if (players[i].alive && players[j].alive) {
                const a = players[i], b = players[j];
                if (a.team !== b.team && !netBetween(a, b) && Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r + 0.5) { // touching an enemy with the grapple out (rope, or hook in flight) overcharges you: no body-blocking on a rope
                    if (a.rope || a.pending)
                        a.overcharge();
                    if (b.rope || b.pending)
                        b.overcharge();
                }
                const avx = a.vx, avy = a.vy, bvx = b.vx, bvy = b.vy, hit = collide(a, b, PLAYER_M, PLAYER_M, PLAYER_BOUNCE);
                crashPush(a.crashK, b, bvx, bvy); // Awakened: the push you give the other player is multiplied (both ways if both are awake)
                crashPush(b.crashK, a, avx, avy);
                if (hit > IMPACT_V0) { // each player's sparks fly off on their own side of the contact
                    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
                    events.onImpact(a, a.x + nx * a.r, a.y + ny * a.r, -nx, -ny, hit);
                    events.onImpact(b, b.x - nx * b.r, b.y - ny * b.r, nx, ny, hit);
                }
            }
    stepProjectiles();
    const scorer = ball.step();
    events.onBodyStep(ball);
    if (ball.pull)
        ball.pull.t = Math.max(0, ball.pull.t - DT);
    if (scorer !== null) {
        if (!sandbox)
            return point(sideSwap(scorer), 'scores!');
        ball.reset(); // sandbox: nothing is scored, the ball just goes back to the middle
        events.onNewRound();
    }
    for (const d of [...decoys]) { // decoys: the same physics as the death ball, but they can never score (see the veils in ball.js)
        d.step();
        events.onBodyStep(d);
        if (d.dead)
            removeDecoy(d);
    }
    for (let i = 0; i < decoys.length; i++) { // decoys are solid: they bump into players, the death ball and each other (the death ball itself still just kills)
        const d = decoys[i];
        for (const p of players)
            if (p.alive) {
                if (p.team !== d.team && Math.hypot(p.x - d.x, p.y - d.y) < p.r + d.r) { // an opponent touching it: a crash shot, then dead (checked BEFORE collide(), which pushes them apart)
                    const hit = crashShot(p, d);
                    if (hit > IMPACT_V0) {
                        const dx = d.x - p.x, dy = d.y - p.y, m = Math.hypot(dx, dy) || 1;
                        events.onImpact(p, p.x + dx / m * p.r, p.y + dy / m * p.r, dx / m, dy / m, hit);
                    }
                    if (p.awakeT > 0)
                        continue; // Awakened: unkillable, the crash bounces you off instead
                    p.alive = false;
                    p.rope = null;
                    p.pending = null;
                    p.onBall = false;
                    p.tball = null;
                    continue;
                }
                const dvx = d.vx, dvy = d.vy, hit = collide(p, d, 1, BALL_M, DECOY_BOUNCE_PLAYER); // the owner and teammates just bump it, as before
                crashPush(p.crashK, d, dvx, dvy);
                if (hit > IMPACT_V0) {
                    const dx = d.x - p.x, dy = d.y - p.y, m = Math.hypot(dx, dy) || 1;
                    events.onImpact(p, p.x + dx / m * p.r, p.y + dy / m * p.r, dx / m, dy / m, hit);
                }
            }
        collide(ball, d, BALL_M, BALL_M, DECOY_BOUNCE_BALL);
        for (let j = i + 1; j < decoys.length; j++)
            collide(d, decoys[j], BALL_M, BALL_M, DECOY_BOUNCE_BALL);
    }
    stepStatics(); // STATICS: placed things (ACCELERATOR lines slow whatever crosses them), after everything has moved
    stepSwaps(); // SWAP: casts and swaps (before the portals, so a swapped body that lands in a portal goes through it this same tick)
    stepPortals(); // PORTAL: carries players, the ball and decoys through, and opens / closes portals
    stepMines(); // MINES: blasts (hold special + press weight)
    stepSplit();
    for (const p of players) if (!p.alive && p.clones.length) splitSurvive(p); // one place catches every kind of death
    for (const p of players) { // the Death Ball kills on any touch, but the player's momentum goes into it first (crash shot)
        if (p.alive && Math.hypot(p.x - ball.x, p.y - ball.y) < p.r + ball.r) {
            const hit = crashShot(p, ball);
            if (hit > IMPACT_V0) {
                const dx = ball.x - p.x, dy = ball.y - p.y, m = Math.hypot(dx, dy) || 1;
                events.onImpact(p, p.x + dx / m * p.r, p.y + dy / m * p.r, dx / m, dy / m, hit);
            }
            if (p.awakeT > 0)
                continue; // Awakened: unkillable, the crash bounces you off instead
            p.alive = false;
            p.rope = null;
            p.onBall = false;
        }
    }
    for (const p of players) if (!p.alive && p.clones.length) splitSurvive(p); // one place catches every kind of death
    const dead = players.filter(q => !q.alive).length; // Explode: any death (a kill, or your own) within EXPLODE_WINDOW s of a blast refunds that blast's cooldown
    for (const p of players)
        if (p.exploT > 0 && dead > p.exploDead)
            p.explodeRefund();
    if (sandbox) { // nobody to beat: a dead player comes back at their spawn a moment later
        for (const p of players)
            if (!p.alive && (p.deadT += DT) >= FLEX_RESPAWN_T) {
                p.reset();
                for (const k in p.cd)
                    p.cd[k] = 0; // practice: abilities are ready again
            }
        return;
    }
    const teamAlive = t => players.some(p => p.team === t && p.alive); // a team is out when all its players are dead
    if (!teamAlive(0) && !teamAlive(1)) {
        msg = 'Double KO';
        pause = 1.6;
    }
    else if (!teamAlive(0))
        point(1, 'wipes out the other team!');
    else if (!teamAlive(1))
        point(0, 'wipes out the other team!');
}



