// Does each special actually help the AI? Run: node js/test/ai-special-test.js
const { loadSim } = require('../server/sim-node.js');
const SP = ['dash', 'plinko', 'marionette', 'decoy', 'arrow'], TICKS = 120 * 600;
function run(special, seat) {
    const sim = loadSim(), other = 1 - seat;
    sim.run(`swapOn = false; resetMatch(); ai[0].on = true; ai[1].on = true;
      var __pts = { me: [0, 0], opp: [0, 0] }, __uses = 0, __prev = 1e9;
      events.onPoint = (t, why) => { __pts[t === ${seat} ? 'me' : 'opp'][why === 'scores!' ? 0 : 1]++; };
      events.onNewRound = () => { __prev = 1e9; };
      function __t() {
        players[${seat}].special = '${special}'; players[${other}].special = 'dash';
        const c = players[${seat}].cd['${special}'];
        if (c > __prev + 0.5) __uses++;
        __prev = c;
        update();
      }`);
    for (let i = 0; i < TICKS; i++) sim.run('__t()');
    return { pts: sim.run('__pts'), uses: sim.run('__uses') };
}
for (const sp of SP) {
    const a = run(sp, 0), b = run(sp, 1); // both seats, so side bias cancels
    const me = [0, 1].map(i => a.pts.me[i] + b.pts.me[i]), opp = [0, 1].map(i => a.pts.opp[i] + b.pts.opp[i]);
    console.log(sp.padEnd(11), `uses ${a.uses + b.uses}`.padEnd(10), `ours: ${me[0]} goals ${me[1]} wipeouts`.padEnd(30), `theirs: ${opp[0]} goals ${opp[1]} wipeouts`);
}