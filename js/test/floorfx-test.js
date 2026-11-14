// Headless tests for Hyper / Xeric (see the FLOOR WEIGHT block in physics/constants.js). Run:  node js/test/floorfx-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const P = (sim, e, i = 0) => sim.run(`players[${i}].` + e);
const ticks = (sim, s) => { for (let i = 0; i < Math.round(s * 120); i++) sim.tick(); };
function fresh() {
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run('pause = 0; pick.on = false; ai.forEach(a => a.on = false); players[0].x = 200; players[1].x = 720; players.forEach(p => { p.vx = 0; p.vy = 0; })');
    return sim;
}
// Peak height (lowest y reached) of player 1 doing a grapple jump from the floor, while player 0 does `other` (code run each tick before ticking).
function peak(setup, weighted) {
    const sim = fresh();
    let top = 1e9;
    sim.run(`players[1].keys.z = true; players[1].keys.x = ${weighted}`);
    for (let t = 0; t < 120; t++) {
        setup(sim, t);
        sim.tick();
        top = Math.min(top, P(sim, 'y', 1));
    }
    return top;
}
const idle = () => {};
const hyper = sim => sim.run('players[0].keys.x = true; players[0].keys.z = true');
const xeric = sim => sim.run('players[0].keys.x = true; players[0].keys.z = false');

// 1) HYPER: another player's weight+grapple on the floor makes my grapple jump go higher
{
    const base = peak(idle, false), hy = peak(hyper, false);
    check(hy < base - 5, `hyper: grapple jump peak y ${hy.toFixed(0)} vs ${base.toFixed(0)} without (higher = smaller y)`);
}
// 2) XERIC: another player holding weight on the floor wrecks my WEIGHTED grapple jump, leaves an unweighted one alone
{
    const base = peak(idle, true), xe = peak(xeric, true), plain = peak(idle, false), plainX = peak(xeric, false);
    check(xe > base + 10, `xeric: weighted grapple jump peak y ${xe.toFixed(0)} vs ${base.toFixed(0)} without (lower = smaller jump)`);
    check(Math.abs(plainX - plain) < 1, `xeric: an unweighted grapple jump is untouched (${plainX.toFixed(1)} vs ${plain.toFixed(1)})`);
    
}

{
    const sim = fresh();
    sim.run('players[0].xericT = 1; players[1].ground = false; players[1].rope = null; players[1].onBall = false');
    check(sim.run('players[1].floorFx().xeric') === false, 'xeric: a player in the air is not affected');
    sim.run('players[1].ground = true');
    check(sim.run('players[1].floorFx().xeric') === true, 'xeric: a player on the floor is affected');
    sim.run('players[1].ground = false; players[1].rope = { x: 0, y: 0 }; players[1].ropeGround = true');
    check(sim.run('players[1].floorFx().xeric') === true, 'xeric: a player hooked to the floor is affected');
}

// 2b) display timers: boostFx / fizzleFx fire on the affected player only, when their jump is actually boosted / cut
{
    const run = (setup, weighted) => { const sim = fresh(); sim.run(`players[1].keys.z = true; players[1].keys.x = ${weighted}`); for (let t = 0; t < 30; t++) { setup(sim); sim.tick(); } return sim; };
    let sim = run(hyper, false);
    check(P(sim, 'boostFx', 1) > 0 || sim.run('players[1].gjT') < 0.3, 'hyper: the boosted player gets the boost burst timer');
    sim = run(hyper, false); check(P(sim, 'fizzleFx', 1) === 0, 'hyper: no fizzle on them');
    sim = run(xeric, true);  check(P(sim, 'fizzleFx', 1) > 0 && P(sim, 'boostFx', 1) === 0, 'xeric: the weakened player gets the fizzle burst timer');
    check(P(sim, 'fizzleFx', 0) === 0 && P(sim, 'boostFx', 0) === 0, 'the aura owner gets no burst of their own');
    sim = run(xeric, false); check(P(sim, 'fizzleFx', 1) === 0, 'xeric: an unweighted jump is not cut, so no fizzle');
}
// 1b) the smaller hyper: another player holding the grapple on the floor WITHOUT weight boosts a little (less than a weighted hyper), and the two kinds act on each other
{
    const lite = sim => sim.run('players[0].keys.x = false; players[0].keys.z = true');
    const base = peak(idle, false), li = peak(lite, false), hy = peak(hyper, false);
    check(li < base - 2 && li > hy, `hyper lite: grapple jump peak y ${li.toFixed(0)} sits between no hyper (${base.toFixed(0)}) and a weighted hyper (${hy.toFixed(0)})`);
    check(peak(lite, true) < peak(idle, true) - 1, 'hyper lite: boosts a weighted grapple jump too');
    const sim = fresh(), fxH = i => sim.run(`players[${i}].floorFx().hyper`), LITE = sim.run('HYPER_LITE');
    sim.run('players.forEach(p => { p.hyperT = 0; p.hyperLiteT = 0; })');
    check(fxH(1) === 0 && fxH(0) === 0, 'hyper strength is 0 with no hypers up');
    sim.run('players[0].hyperLiteT = 1');
    check(Math.abs(fxH(1) - LITE) < 1e-9 && fxH(0) === 0, 'an unweighted hyper gives HYPER_LITE to the others and nothing to its owner');
    sim.run('players[0].hyperT = 1');
    check(fxH(1) === 1, 'one player gives one hyper: overlapping weighted + unweighted timers count once, as the strongest');
    sim.run('players[0].hyperT = 0; players[0].hyperLiteT = 0; players[1].hyperLiteT = 1');
    check(Math.abs(fxH(0) - LITE) < 1e-9, 'the kinds act on each other: a weighted-hyper player is boosted by the other\'s unweighted hyper');
    check(sim.run('hyperMul(3, 0)') === 1 && sim.run('hyperMul(3, 1)') === 3 && Math.abs(sim.run('hyperMul(3, 2)') - 5) < 1e-9, 'hyperMul is additive: strength 2 on a x3 bonus gives x5, not x9');
    if (sim.run('players.length') >= 3) {
        sim.run('players.forEach(p => { p.hyperT = 0; p.hyperLiteT = 0; }); players[0].hyperT = 1; players[2].hyperLiteT = 1');
        check(Math.abs(fxH(1) - (1 + LITE)) < 1e-9, 'hypers from different players ADD (weighted + unweighted = 1 + HYPER_LITE)');
        sim.run('players[2].hyperT = 1; players[2].hyperLiteT = 0');
        check(fxH(1) === 2, 'two weighted hypers add to 2');
    }
}
// 3) the owner is never affected by their own auras
{
    const a = peak(idle, false);
    const sim = fresh(); let top = 1e9;
    sim.run('players[0].keys.z = true; players[0].keys.x = false');
    for (let t = 0; t < 120; t++) { sim.tick(); top = Math.min(top, P(sim, 'y', 0)); }
    check(Math.abs(top - a) < 40, `my own jump is a normal jump (${top.toFixed(0)} vs ${a.toFixed(0)}, mirror-side spawn)`);
}
// 7) XERIC vs the seesaw: the same pop gives a xeric player a much smaller kick
{
    const kick = xer => {
        const sim = fresh();
        sim.run('players[1].x = 840; players[1].y = H - players[1].r; players[1].keys.x = ' + xer);
        ticks(sim, 0.3);
        sim.run('sawHit(100, 2000)'); // a slam on the far left raises the right far half
        let top = 0;
        for (let t = 0; t < 40; t++) { sim.tick(); top = Math.max(top, -P(sim, 'vy', 1)); }
        return top;
    };
    const plain = kick(false), xe = kick(true);
    check(plain > 20 && xe < plain * 0.5, `xeric soaks up the seesaw pop: peak upward speed ${xe.toFixed(0)} vs ${plain.toFixed(0)} u/s`);
}
// 7b) the quake graphic (quakeFx): set by a real seesaw slam only, decays, survives save / load, and is cleared by a reset
{
    const sim = fresh();
    sim.run('sawHit(300, 100)'); // too weak to move the floor
    check(sim.run('quakeFx.t') === 0, 'a slam too weak to tip the floor starts no quake graphic');
    sim.run('sawHit(470, 5000)'); // right by the net: the pop weight there is ~0
    check(sim.run('quakeFx.t') === 0, 'a slam right at the net (no pop) starts no quake graphic');
    sim.run('sawHit(100, 2000)');
    check(sim.run('quakeFx.t') > 0.6 && sim.run('quakeFx.x') === 100 && sim.run('quakeFx.s') > 0.9, 'a real slam starts it at the impact point with its strength');
    const snap = JSON.parse(JSON.stringify(sim.save()));
    ticks(sim, 0.3); const mid = sim.run('quakeFx.t');
    check(mid > 0.3 && mid < 0.45, `it counts down with the simulation (${mid.toFixed(2)} s left after 0.3 s)`);
    ticks(sim, 0.6); check(sim.run('quakeFx.t') === 0, 'and ends');
    sim.load(snap); check(sim.run('quakeFx.t') > 0.6 && sim.run('quakeFx.x') === 100, 'save / load keeps it');
    sim.run('sawReset()'); check(sim.run('quakeFx.t') === 0, 'a floor reset clears it');
    // the AI's planning snapshot restores it too
    sim.run('sawHit(100, 2000)'); const sn = sim.run('snapshotFx()'); sim.run('quakeFx.t = 0; quakeFx.s = 0'); sim.run('restoreFx(' + JSON.stringify(sn) + ')');
    check(sim.run('quakeFx.t') > 0.6, 'the AI snapshot / restore keeps it');
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
