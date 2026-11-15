// Campaign structure on the real sim. Run: node js/test/campaign-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const sim = loadSim();
const R = c => sim.run(c);
sim.run('swapOn = true; resetMatch()');
sim.run('campaignStart()');
check(R('campaign.on && campaign.stage === 0 && ai[1].on && !ai[0].on'), 'starts at stage 1 with a computer boss on seat 1 and you on seat 0');
check(R('JSON.stringify(CAMPAIGN_STAGES.map(s => s.goal))') === '[5,5,5,7,7,9]', 'goals are 5, 5, 5, 7, 7, 9');
check(R('swapOn === false'), 'sides do not swap in the campaign');
check(R('players[1].special') === R('campaignStage().special'), 'the boss has its stage ability');
// score the stages by hand
const win = () => { R('point(0, "scores!")'); };
for (let st = 0; st < 6; st++) {
    const goal = R('CAMPAIGN_STAGES[' + st + '].goal');
    check(R('campaign.stage') === st, `on stage ${st + 1}`);
    for (let i = 0; i < goal - 1; i++) { win(); R('pause = 0; newRound()'); }
    check(R('!over'), `stage ${st + 1}: ${goal - 1} points is not enough`);
    win();
    check(R('over'), `stage ${st + 1}: ${goal} points clears it`);
    for (let i = 0; i < 120 * 5 && R('pause > 0'); i++) R('update()');
    if (st < 5) check(R('campaign.on && campaign.stage === ' + (st + 1) + ' && score[0] === 0 && score[1] === 0'), `then stage ${st + 2} starts at 0-0`);
}
check(R('!campaign.on'), 'clearing stage 6 ends the campaign');
check(R('swapOn === true'), 'the borrowed settings come back');
// losing retries the stage
sim.run('campaignStart(); campaign.stage = 3; campaignApply(); resetMatch()');
for (let i = 0; i < 6; i++) { R('point(1, "scores!"); pause = 0; newRound()'); }
check(R('!over'), 'stage 4: the boss at 6 of 7 has not won yet');
R('point(1, "scores!")');
check(R('over && msg.includes("lose")'), 'the boss reaching 7 ends the stage as a loss');
for (let i = 0; i < 120 * 5 && R('pause > 0'); i++) R('update()');
check(R('campaign.stage === 3 && campaign.continues === 1 && score[0] === 0 && score[1] === 0'), 'it retries the same stage with the score reset');
// changing the match type quits the campaign
R('setTeamSize(2)');
check(R('!campaign.on'), '2v2 ends the campaign');
// the lag knob
sim.run('ai[1].on = true; ai[1].lvl = 0.5');
check(R('(() => { const a = ai[1], seq = []; for (let i = 0; i < 20; i++) seq.push(aiLag(a, { l: i, r: false }).l); return seq.slice(0, 7).join() })()') === '0,0,0,0,0,0,0', 'lvl 0.5 holds the first keys for ' + 7 + ' ticks, then replays them delayed');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
