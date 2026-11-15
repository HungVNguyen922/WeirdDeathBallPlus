// Campaign structure on the real sim. Run: node js/test/campaign-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
let sim = loadSim();
const R = c => sim.run(c);
const finish = () => { for (let i = 0; i < 120 * 5 && R('pause > 0'); i++) R('update()'); }; // sit out the pause after a stage ends
sim.run('swapOn = true; resetMatch()');
sim.run('campaignStart()');

console.log('STRUCTURE');
check(R('campaign.on && campaign.stage === 0 && ai[1].on && !ai[0].on'), 'starts at stage 1 with a computer boss on seat 1 and you on seat 0');
check(R('JSON.stringify(CAMPAIGN_STAGES.map(s => s.goal))') === '[5,9,5,7,7,9]', 'goals are 5, 9, 5, 7, 7, 9');
check(R('swapOn === false'), 'sides do not swap in the campaign');
check(R('players[1].special') === R('campaignStage().special'), 'the boss has its stage ability');
check(R('NET_GAP === CAMPAIGN_STAGES[0].gap && NETSEGS[0][1] === NET_GAP && NET_GAP === NET_GAP_CLASSIC'), 'stage 1: the classic net');

console.log('POINTS DO NOT END THE ROUND');
R('players[1].x = W * 0.8; players[1].y = H - 40; ball.x = 300; ball.y = 300; ball.vx = 500; ball.vy = 100');
R('point(0, "scores!")');
check(R('pause === 0 && !over && score[0] === 1'), 'a point is scored with no pause and no stage end');
check(R('Math.abs(ball.x - NETX) < 1 && ball.y < NET_GAP + 40 && Math.abs(ball.vx) < 50 && ball.vy === 0'), 'the ball respawns at the top of the net');
for (let i = 0; i < 90; i++) R('update()');
check(R('ball.y > 100 && ball.vy > 50 && Math.abs(ball.x - NETX) < 60'), 'and falls down the net line');
R('players[0].alive = false; players[0].x = 50');
R('point(1, "wipes out the other team!")');
check(R('players[0].alive && score[1] === 1 && pause === 0'), 'a killed player respawns straight away');
R('players[0].alive = false; players[1].alive = false; update()');
check(R('players[0].alive && players[1].alive && pause === 0'), 'a double KO respawns both with no pause');

console.log('STAGES, NETS, AND LOSING');
const gaps = [], stages = R('CAMPAIGN_STAGES.length');
for (let st = 0; st < stages; st++) {
    R('score = [0, 0]; over = false; pause = 0');
    const goal = R('CAMPAIGN_STAGES[' + st + '].goal');
    check(R('campaign.stage') === st, `on stage ${st + 1}`);
    check(R('NET_GAP === CAMPAIGN_STAGES[' + st + '].gap && NETSEGS[0][1] === NET_GAP'), `stage ${st + 1}: the net follows the stage (gap ${R('NET_GAP')})`);
    for (let i = 0; i < goal - 1; i++) R('point(0, "scores!")');
    check(R('!over'), `stage ${st + 1}: ${goal - 1} points is not enough`);
    R('point(0, "scores!")');
    check(R('over'), `stage ${st + 1}: ${goal} points clears it`);
    finish();
    if (st < stages - 1) check(R('campaign.on && campaign.stage === ' + (st + 1) + ' && score[0] === 0 && score[1] === 0'), `then stage ${st + 2} starts at 0-0`);
}
check(R('!campaign.on'), 'clearing the last stage ends the campaign');
check(R('swapOn === true && NET_GAP === NET_GAP_CLASSIC && players[1].dashN === 1 && !players[1].dual'), 'the borrowed settings, the classic net and the normal boss body come back');
sim.run('campaignStart(); campaign.stage = 3; campaignApply(); resetMatch()');
for (let i = 0; i < 6; i++) R('point(1, "scores!")');
check(R('!over'), 'stage 4: the boss at 6 of 7 has not won yet');
R('point(1, "scores!")');
check(R('over && msg.includes("lose")'), 'the boss reaching 7 ends the stage as a loss');
finish();
check(R('campaign.stage === 0 && campaign.continues === 1 && score[0] === 0 && score[1] === 0 && NET_GAP === CAMPAIGN_STAGES[0].gap'), 'a loss starts the whole run again from stage 1');
R('setTeamSize(2)');
check(R('!campaign.on'), '2v2 ends the campaign');

console.log('BOSS 1: TWO DASHES');
sim = loadSim(); // a clean game
sim.run('campaignStart(); ai[1].on = false; players.forEach(p => { for (const k in p.cd) p.cd[k] = 0; }); players[1].x = W * 0.8; players[1].y = 150; players[1].vx = 0; players[1].vy = 0');
const press = () => { R('players[1].keys.r = true; players[1].keys.sp = true'); for (let i = 0; i < 3; i++) R('update()'); R('players[1].keys.sp = false'); for (let i = 0; i < 20; i++) R('update(); players[1].y = 150; players[1].vy = 0; players[1].ground = false'); };
check(R('players[1].dashN === 2 && players[1].has("dash") && players[1].dashSlot() === 0'), 'boss 1 has two dashes');
press();
check(R('players[1].cd.dash > 4 && players[1].cd.dash2 === 0 && players[1].dashSlot() === 1'), 'the first dash goes and the second is still there');
press();
check(R('players[1].cd.dash2 > 4 && players[1].dashSlot() === -1'), 'the second goes too, a third does not exist');
R('players[1].dashCut = [0, 0]; players[1].cd.dash = 0; players[1].cd.dash2 = 0; players[1].dashReady = players[1].dash2Ready = true');
for (let i = 0; i < 6; i++) R('campaignOnPoint(' + (i % 2) + ')');
check(Math.abs(R('players[1].dashCut[0] + players[1].dashCut[1]') - 3) < 1e-9, 'every point shaves 0.5 s off one of the two dashes (6 points = 3.0 s)');
R('players[1].dashCut = [0, 0]'); for (let i = 0; i < 40; i++) R('campaignOnPoint(0)');
check(R('players[1].dashCut[0] <= DASH_COOLDOWN - 0.5 && players[1].dashCut[1] <= DASH_COOLDOWN - 0.5'), 'a dash cooldown never drops below 0.5 s');
R('campaignApply()');
check(R('players[1].dashCut[0] === 0 && players[1].dashCut[1] === 0'), 'the cuts start from nothing on a new try');

console.log('BOSS 2: DASH + ARROWS, 1PL GAP');
sim.run('campaign.stage = 1; campaignApply(); resetMatch()');
check(R('NET_GAP === PL'), 'stage 2: a 1 PL gap');
check(R('JSON.stringify(players[1].slots())') === '[["sp","arrow"],["sp2","dash"]]', 'boss 2 has arrow on its first key and dash on its second');
check(R('JSON.stringify(players[0].slots())') === '[["sp","dash"]]' || R('players[0].slots().length') === 1, 'you still have one special');

console.log('THE AI PLAYS EACH BOSS');
for (const st of [0, 1]) {
    const s = loadSim();
    s.run(`campaignStart(); campaign.stage = ${st}; campaignApply(); resetMatch(); pick.on = false; pause = 0; players[0].keys.l = false;`);
    let used = { dash: 0, dash2: 0, arrow: 0 }, prev = { dash: 0, dash2: 0, arrow: 0 }, err = null;
    try {
        for (let i = 0; i < 120 * 40; i++) {
            s.run('update(); if (over) { score = [0, 0]; over = false; pause = 0; }');
            const cd = s.run('players[1].cd');
            for (const k in used) { if (cd[k] > prev[k] + 0.5) used[k]++; prev[k] = cd[k]; }
        }
    } catch (e) { err = e; }
    check(!err, `stage ${st + 1}: 40 s of boss AI with no errors` + (err ? ' ' + err.message : ''));
    console.log(`       boss uses over 40 s (you standing still): ${JSON.stringify(used)}; score ${JSON.stringify(s.run('score'))}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
