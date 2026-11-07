// Headless tests for the Reel special. Run:  node js/test/reel-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + (ok ? '' : '') + msg); if (!ok) fails++; };
const P = (sim, e) => sim.run('players[0].' + e);
const ticks = (sim, n) => { for (let i = 0; i < n; i++) sim.tick(); };

function tethered(onBall = true) { // a player hooked to the ball (or the floor), reel ready
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run("players[0].special = 'reel'; pause = 0; players[0].cd.reel = 0");
    if (onBall)
        sim.run('players[0].x = 200; players[0].y = 480; players[0].vx = 0; players[0].vy = 0; ball.x = 280; ball.y = 440; ball.vx = ball.vy = 0; ball.w = 0');
    else
        sim.run('ball.x = 800; ball.y = 100; ball.vx = ball.vy = 0; players[0].x = 300; players[0].y = 500; players[0].vx = players[0].vy = 0');
    sim.run('players[0].keys.z = true');
    ticks(sim, 40);
    return sim;
}
const special = sim => { sim.run('players[0].keys.sp = true'); sim.tick(); };            // press (and keep holding) the special key
const weight = (sim, on) => { sim.run(`players[0].keys.x = ${!!on}`); sim.tick(); };    // press / release weight
const release = sim => { sim.run('players[0].keys.sp = false; players[0].keys.x = false'); sim.tick(); };
const sp = sim => sim.run('Math.hypot(ball.vx, ball.vy)');
const CD = sim => sim.run('REEL_COOLDOWN');

{
    const sim = loadSim();
    sim.run('resetMatch()'); sim.run("players[0].special = 'reel'; pause = 0; players[0].cd.reel = 0");
    special(sim);
    check(P(sim, 'cd.reel') === 0 && P(sim, 'casts.length') === 0, 'with no rope out, pressing does nothing and costs nothing');
}
{
    const sim = tethered(true);
    check(P(sim, 'onBall'), 'scenario: hooked to the ball');
    const len0 = P(sim, 'len');
    special(sim);
    check(Math.abs(P(sim, 'cd.reel') - CD(sim)) < 0.05, `the cooldown starts at once (${P(sim, 'cd.reel').toFixed(2)} s)`);
    check(P(sim, 'len') - len0 < 15, `the rope pays out smoothly, not all in one tick (+${(P(sim, 'len') - len0).toFixed(1)} after the first tick)`);
    ticks(sim, 60);
    check(P(sim, 'len') > len0 + 50, `...and ends up longer (${len0.toFixed(0)} -> ${P(sim, 'len').toFixed(0)})`);
    check(P(sim, 'casts.length') === 1, 'the cast stays up while the key is held');
    release(sim);
    check(P(sim, 'casts.length') === 0, 'letting go ends it');
    sim.run('players[0].keys.sp = true'); sim.tick();
    check(P(sim, 'cd.reel') > CD(sim) - 1.5, 'pressing again during the cooldown pays out nothing new');
}
{ // the combo: pay out, then (still holding) weight to pull, while the cooldown runs
    const sim = tethered(true);
    special(sim); ticks(sim, 20);
    const lenMid = P(sim, 'len');
    weight(sim, true); ticks(sim, 40);
    check(P(sim, 'casts[0].rem') === 0, 'weight during the pay-out cuts the rest of it short');
    check(P(sim, 'len') < lenMid - 15, `and reels in (${lenMid.toFixed(0)} -> ${P(sim, 'len').toFixed(0)})`);
    check(P(sim, 'cd.reel') > CD(sim) - 1, 'the pull neither needs nor resets the cooldown');
    weight(sim, false); release(sim);
    check(P(sim, 'casts.length') === 0, 'letting go ends it');
}
{ // pulling needs no pay-out and no ready cooldown
    const sim = tethered(true);
    sim.run('players[0].cd.reel = 4');
    const len0 = P(sim, 'len');
    sim.run('players[0].keys.x = true'); sim.tick(); special(sim); ticks(sim, 30);
    check(P(sim, 'casts[0].type') === 'reel' && P(sim, 'len') < len0 - 20, 'weight + special pulls even with the cooldown running');
    check(Math.abs(P(sim, 'cd.reel') - 4) < 0.5, 'and does not touch the cooldown');
}
{ // looping: the ball keeps its swing through the pay-out
    const sim = tethered(true);
    sim.run('ball.vx = 0; ball.vy = -500'); ticks(sim, 30);
    const before = sp(sim);
    special(sim); ticks(sim, 80);
    check(sp(sim) > before * 0.8, `a swinging ball does not lose its speed to the pay-out (${before.toFixed(0)} -> ${sp(sim).toFixed(0)} u/s)`);
}
{
    const sim = tethered(false);
    check(P(sim, 'rope') !== null && !P(sim, 'onBall'), 'scenario: hooked to a surface');
    const dist = () => Math.hypot(P(sim, 'x') - P(sim, 'rope.x'), P(sim, 'y') - P(sim, 'rope.y')), d0 = dist();
    special(sim); ticks(sim, 25);
    check(dist() > d0 + 5, `on a platform, pay-out pushes the player away from it (${d0.toFixed(0)} -> ${dist().toFixed(0)})`);
}
{
    const sim = tethered(false);
    sim.run('players[0].cd.reel = 4');
    const d0 = Math.hypot(P(sim, 'x') - P(sim, 'rope.x'), P(sim, 'y') - P(sim, 'rope.y'));
    sim.run('players[0].keys.x = true'); sim.tick(); special(sim); ticks(sim, 40);
    check(P(sim, 'rope') === null || Math.hypot(P(sim, 'x') - P(sim, 'rope.x'), P(sim, 'y') - P(sim, 'rope.y')) < d0, 'on a platform, reel-in pulls the player toward it');
}
{
    const sim = tethered(true);
    special(sim); ticks(sim, 10);
    const snap = JSON.parse(JSON.stringify(sim.save()));
    sim.run('players[0].casts.length = 0'); sim.load(snap);
    check(P(sim, 'casts.length') === 1 && P(sim, 'casts[0].type') === 'reel' && P(sim, 'casts[0].rem') > 0, 'save -> JSON -> load keeps the pay-out mid-way');
}
console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);