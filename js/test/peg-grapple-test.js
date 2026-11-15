// Headless tests: plinko pegs can be grappled (see PEG_GRAPPLE in physics/constants.js). Run:  node js/test/peg-grapple-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const ticks = (sim, s) => { for (let i = 0; i < Math.round(s * 120); i++) sim.tick(); };
function fresh() {
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run('pause = 0; pick.on = false; ai.forEach(a => a.on = false); players.forEach(p => { p.vx = 0; p.vy = 0; })');
    // player 1 hangs in mid air, a peg a short way above them (closer than the ceiling, the walls and the ball)
    sim.run('players[1].x = 720; players[1].y = H / 2; pegs.length = 0; pegs.push({ x: 720, y: H / 2 - 90, vx: 0, vy: 0, r: PEG_R, team: players[1].team, owner: players[0], flash: 0, life: 99 })');
    return sim;
}

{ // 1) a peg in reach is a candidate, and it is what the hook takes when it is the nearest thing
    const sim = fresh();
    check(sim.run('players[1].candidates(ball).some(o => o.peg)'), 'a peg within reach is a grapple candidate');
    sim.run('players[1].keys.z = true');
    ticks(sim, 0.4);
    check(sim.run('!!players[1].rope && !!players[1].pegHook && !players[1].onBall && !players[1].ropeGround'), 'the hook lands on the peg as a plain (non-floor) tether');
    check(sim.run('Math.hypot(players[1].rope.x - 720, players[1].rope.y - (H / 2 - 90))') <= sim.run('PEG_R') + 0.5, 'the pivot sits on the peg\'s edge');
}
{ // 2) the rope lets go when the peg fizzles out, and keeps its hold while the peg is there
    const sim = fresh();
    sim.run('players[1].keys.z = true');
    ticks(sim, 0.4);
    check(sim.run('!!players[1].pegHook'), 'hooked to the peg');
    ticks(sim, 0.2);
    check(sim.run('!!players[1].pegHook'), 'still hooked while the peg is up');
    sim.run('pegs.length = 0');
    sim.tick();
    check(sim.run('players[1].pegHook === null'), 'the peg is gone: no longer hooked to it');
}
{ // 3) the hook survives a save / load (pegs are re-created on load, so the link is by position)
    const sim = fresh();
    sim.run('players[1].keys.z = true');
    ticks(sim, 0.4);
    const snap = JSON.parse(JSON.stringify(sim.save()));
    sim.load(snap);
    sim.tick();
    check(sim.run('!!players[1].pegHook'), 'save / load keeps the peg hook');
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
