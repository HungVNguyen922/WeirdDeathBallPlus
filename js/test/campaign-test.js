// Campaign structure on the real sim. Run: node js/test/campaign-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
let sim = loadSim();
const R = c => sim.run(c);
const finish = () => { for (let i = 0; i < 120 * 5 && R('pause > 0'); i++) R('update()'); }; // sit out the pause after a stage ends
const skip = () => { for (let i = 0; i < 120 * 12 && R('campaign.on && (campaign.draft.on || campaign.bannerT > 0)'); i++) { if (R('campaign.draft.on && campaign.draft.lock <= 0 && campaign.draft.t > 0.5')) R('campaignDraftPick(1)'); R('update()'); } }; // take the middle card of any draft, sit out the banner
sim.run('swapOn = true; resetMatch()');
sim.run('campaignStart()');

console.log('LOADOUT DRAFT AND STAGE BANNER');
{
    const d = JSON.parse(R('JSON.stringify(campaign.draft)'));
    check(d.on && d.slot === 0 && d.offer.length === 3 && new Set(d.offer).size === 3 && !d.offer.includes('fighter'), 'a run opens with a draft of 3 different specials: ' + d.offer.join(', '));
    check(R('twoSpecials === true && players[0].slots().length === 1'), 'two-special game, but only one special until stage 2');
    check(JSON.stringify(d.offer) === '["dash","plinko","arrow"]', 'stage 1 offers dash, plinko and arrow');
    const b = R('ball.y');
    R('players[0].keys.r = true'); R('update()'); R('players[0].keys.r = false'); R('update()');
    check(R('campaign.draft.cur') === 1, 'keys are ignored while the cards deal in');
    for (let i = 0; i < 60; i++) R('update()');
    check(R('ball.y') === b, 'the world holds still while the draft is open');
    R('players[0].keys.l = true'); R('update()'); R('players[0].keys.l = false'); R('update()');
    check(R('campaign.draft.cur') === 0, 'left moves the cursor');
    R('players[0].keys.z = true'); R('update()'); R('players[0].keys.z = false');
    check(R('players[0].special') === d.offer[0] && R('campaign.draft.chosen') === 0, 'grapple takes the highlighted card');
    for (let i = 0; i < 120 * 0.8; i++) R('update()');
    check(R('!campaign.draft.on && campaign.bannerT > 0'), 'then the stage banner plays');
    const b2 = R('ball.y');
    for (let i = 0; i < 60; i++) R('update()');
    check(R('ball.y') === b2, 'the world holds still during the banner');
    for (let i = 0; i < 120 * 2.3; i++) R('update()');
    check(R('campaign.bannerT === 0') && R('ball.y') > b2, 'and play starts when it ends');
}

console.log('STRUCTURE');
skip();
check(R('campaign.on && campaign.stage === 0 && ai[1].on && !ai[0].on'), 'starts at stage 1 with a computer boss on seat 1 and you on seat 0');
check(R('JSON.stringify(CAMPAIGN_STAGES.map(s => s.goal))') === '[5,5,7,7,7,9]', 'goals are 5, 5, 7, 7, 7, 9');
check(R('swapOn === false'), 'sides do not swap in the campaign');
check(R('players[1].special') === R('campaignStage().special'), 'the boss has its stage ability');
check(R('NET_GAP === CAMPAIGN_STAGES[0].gap && NETSEGS[0][1] === NET_GAP'), 'stage 1: its own net');
const DS = R('CAMPAIGN_STAGES.findIndex(s => s.dashes > 1)'); // the double-dash boss
check(DS >= 0, 'a stage has the double-dash boss: stage ' + (DS + 1));

console.log('POINTS DO NOT END THE ROUND');
R('players[0].special2 = "plinko"; players[1].x = W * 0.8; players[1].y = H - 40; ball.x = 300; ball.y = 300; ball.vx = 500; ball.vy = 100');
R('point(0, "scores!")');
check(R('pause === 0 && !over && score[0] === 1'), 'a point is scored with no pause and no stage end');
check(R('Math.abs(ball.x - NETX) < 1 && ball.y < NET_GAP + 40 && ball.vx === 0 && ball.vy === 0 && ball.w === 0'), 'the ball respawns at the top of the net with no speed or spin left');
for (let i = 0; i < 90; i++) R('update()');
check(R('ball.y > 80 && ball.vy > 50 && Math.abs(ball.x - NETX) < 0.01'), 'and falls dead straight down the net line');
R('players[0].alive = false; players[0].x = 50');
R('point(1, "wipes out the other team!")');
check(R('players[0].alive && score[1] === 1 && pause === 0'), 'a killed player respawns straight away');
R('players[0].alive = false; players[1].alive = false; update()');
check(R('players[0].alive && players[1].alive && pause === 0'), 'a double KO respawns both with no pause');

R('players[0].special = "decoy"; players[0].special2 = "plinko"; players[0].cd.decoy = 0; players[0].x = 300; players[0].y = H - 40; players[0].keys.sp = true');
for (let i = 0; i < 150; i++) R('update()');
R('players[0].keys.sp = false');
const nd = R('decoys.length');
check(nd > 0, 'a decoy is out (' + nd + ')');
R('players[1].alive = true; point(0, "scores!")');
check(R('decoys.length') === nd, 'the decoy carries over to the next point (like arrows do)');
R('players[0].special = "dash"; players[0].special2 = null');
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
    if (st === 0) check(R('campaign.draft.on && campaign.draft.slot === 1 && JSON.stringify(campaign.draft.offer) === \'["bat","warp","decoy"]\''), 'stage 2 opens with the second draft (bat, warp, decoy)');
    if (st === 1) check(R('!campaign.draft.on && campaign.bannerT > 0'), 'stage 3 has just the banner');
    skip();
    if (st === 0) check(R('players[0].slots().length === 2 && players[0].special2 !== players[0].special'), 'after stage 2\'s draft you have two specials');
    if (st < stages - 1) check(R('campaign.on && campaign.stage === ' + (st + 1) + ' && score[0] === 0 && score[1] === 0'), `then stage ${st + 2} starts at 0-0`);
}
check(R('!campaign.on'), 'clearing the last stage ends the campaign');
check(R('swapOn === true && NET_GAP === NET_GAP_CLASSIC && players[1].dashN === 1 && !players[1].dual'), 'the borrowed settings, the classic net and the normal boss body come back');
sim.run('campaignStart(); campaign.stage = 3; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0');
for (let i = 0; i < 6; i++) R('point(1, "scores!")');
check(R('!over'), 'stage 4: the boss at 6 of 7 has not won yet');
R('point(1, "scores!")');
check(R('over && msg.includes("lose")'), 'the boss reaching 7 ends the stage as a loss');
finish();
check(R('campaign.stage === 0 && campaign.continues === 1 && score[0] === 0 && score[1] === 0 && NET_GAP === CAMPAIGN_STAGES[0].gap'), 'a loss starts the whole run again from stage 1');
check(R('campaign.draft.on && campaign.draft.slot === 0 && players[0].special2 === null'), '... with a fresh first draft and no second special');
R('setTeamSize(2)');
check(R('!campaign.on'), '2v2 ends the campaign');

console.log('BOSS 1: TWO DASHES');
sim = loadSim(); // a clean game
sim.run('campaignStart(); campaign.stage = ' + DS + '; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; ai[1].on = false; players.forEach(p => { for (const k in p.cd) p.cd[k] = 0; }); players[1].x = W * 0.8; players[1].y = 150; players[1].vx = 0; players[1].vy = 0');
const press = () => { R('players[1].keys.r = true; players[1].keys.sp = true'); for (let i = 0; i < 3; i++) R('update()'); R('players[1].keys.sp = false'); for (let i = 0; i < 20; i++) R('update(); players[1].y = 150; players[1].vy = 0; players[1].ground = false'); };
check(R('players[1].dashN === 2 && players[1].has("dash") && players[1].dashSlot() === 0'), 'boss 1 has two dashes');
press();
check(R('players[1].cd.dash > 4 && players[1].cd.dash2 === 0 && players[1].dashSlot() === 1'), 'the first dash goes and the second is still there');
press();
check(R('players[1].cd.dash2 > 4 && players[1].dashSlot() === -1'), 'the second goes too, a third does not exist');
R('players[1].dashCut = [0, 0]; players[1].cd.dash = 0; players[1].cd.dash2 = 0; players[1].dashReady = players[1].dash2Ready = true');
for (let i = 0; i < 4; i++) R('campaignOnPoint(' + (i % 2) + ')');
check(Math.abs(R('players[1].dashCut[0] + players[1].dashCut[1]') - 4) < 1e-9, 'every point shaves 1 s off one of the two dashes (4 points = 4.0 s)');
R('players[1].dashCut = [0, 0]; players[1].cd.dash = 5; players[1].cd.dash2 = 5; campaignOnPoint(0)');
check(Math.abs(R('players[1].cd.dash + players[1].cd.dash2') - 9) < 1e-9, 'the cooldown that is running is cut by 1 s too');
R('players[1].dashCut = [0, 0]'); for (let i = 0; i < 40; i++) R('campaignOnPoint(0)');
check(R('players[1].dashCut[0] <= DASH_COOLDOWN - 0.5 && players[1].dashCut[1] <= DASH_COOLDOWN - 0.5'), 'a dash cooldown never drops below 0.5 s');
R('campaignApply()');
check(R('players[1].dashCut[0] === 0 && players[1].dashCut[1] === 0'), 'the cuts start from nothing on a new try');

{ // uptime: with the first dash cooling down, the second one still takes her back into play; her shot making is not touched
    sim.run('campaignStart(); campaign.stage = ' + DS + '; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; players.forEach(p => { for (const k in p.cd) p.cd[k] = 0; }); players[0].x = 100; players[0].y = H - 40');
    R('players[1].x = W - 60; players[1].y = H - 40; ball.x = W * 0.55; ball.y = H - 40; ball.vx = 0; ball.vy = 0; players[1].cd.dash = 5');
    let t = -1;
    for (let i = 0; i < 120 * 2 && t < 0; i++) { R('ball.x = W * 0.55; ball.vx = 0; update()'); if (R('players[1].cd.dash2 > 0')) t = i; }
    check(t >= 0 && R('players[1].cd.dash > 3'), 'a far, slow ball and the first dash cooling down: the second dash goes (after ' + t + ' ticks)');
    check(R('JSON.stringify(aiCanDash.toString().includes("dashSlot"))') === 'true', 'the AI asks for any ready dash');
}
console.log('A BOSS WITH TWO SPECIALS');
sim.run('campaign.stage = 3; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; players[0].special = "dash"; players[0].special2 = "plinko"');
check(R('NET_GAP === CAMPAIGN_STAGES[3].gap'), 'stage 4: its own net');
check(R('JSON.stringify(players[1].slots())') === '[["sp","explode"],["sp2","bat"]]', 'boss 4 has explode on its first key and bat on its second');
check(R('players[0].slots().length') === 2 && R('players[1].slots().length') === 2, 'both have two keys');

console.log('THE AI PLAYS EACH BOSS');
for (const st of [DS, 3]) {
    const s = loadSim();
    s.run(`campaignStart(); campaign.stage = ${st}; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; players[0].keys.l = false;`);
    let used = { dash: 0, dash2: 0, explode: 0, bat: 0 }, prev = { dash: 0, dash2: 0, explode: 0, bat: 0 }, err = null;
    try {
        for (let i = 0; i < 120 * 40; i++) {
            s.run('update(); if (over) { score = [0, 0]; over = false; pause = 0; }');
            const cd = s.run('players[1].cd');
            for (const k in used) { if (cd[k] > prev[k] + 0.5) used[k]++; prev[k] = cd[k]; }
        }
    } catch (e) { err = e; }
    console.log(`       dashes used: ${used.dash + used.dash2} (stage ${st + 1})`);
    check(!err, `stage ${st + 1}: 40 s of boss AI with no errors` + (err ? ' ' + err.message : ''));
    console.log(`       boss uses over 40 s (you standing still): ${JSON.stringify(used)}; score ${JSON.stringify(s.run('score'))}`);
}

console.log('SKINS AND THE STAGE 6 SWARM');
{
    const s = loadSim();
    s.run('campaignStart(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0;');
    check(s.run('CAMPAIGN_STAGES.every(t => Array.isArray(t.skin) && t.skin.length > 2)'), 'every stage has a skin');
    const SD = require('../skin-data.js');
    const raw = JSON.parse(s.run('JSON.stringify(CAMPAIGN_STAGES.map(t => t.skin))'));
    check(raw.every(k => SD.skinClean(k).length === k.length), 'every skin layer is valid (nothing is dropped by skinClean)');
    check(s.run('(() => { const a = []; for (let i = 0; i < 6; i++) { campaign.stage = i; a.push(JSON.stringify(campaignSkin())); } return new Set(a).size === 6; })()'), 'the boss wears a different skin on every stage');
    s.run('campaign.stage = 5; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pause = 0; players[0].special = "dash"; players[0].special2 = "plinko"');
    for (let i = 0; i < 120 * 6.5; i++) s.run('update(); if (over) { score = [0, 0]; over = false; pause = 0; }');
    check(s.run('decoys.filter(d => d.swarm).length') >= 1, 'stage 6: after ~6 s an extra death ball has spawned on her half');
    check(s.run('decoys.filter(d => d.swarm).every(d => (d.x - NETX) * aiSide(allPlayers[1]) < 0 && d.team === 1)'), 'on her side, owned by her team');
    for (let i = 0; i < 120 * 40; i++) s.run('update(); if (over) { score = [0, 0]; over = false; pause = 0; }');
    const n = s.run('decoys.filter(d => d.swarm).length');
    check(n >= 2 && n <= 4, 'the swarm grows but is capped (' + n + ' out)');
    check(s.run('(() => { let m = 0; for (let i = 0; i < 400; i++) { const d = spawnSwarmBall(allPlayers[1], NETX - aiSide(allPlayers[1]) * (120 + Math.random() * 260)); m = Math.max(m, d.x); removeDecoy(d); } return m; })()') < 880, 'swarm balls spawn clear of the wall (the goal jut starts near x = 925)');
    s.run('campaign.stage = 0; campaignApply()');
    check(s.run('decoys.filter(d => d.swarm).length') === 0, 'leaving the stage clears the swarm');
    // marionette shoves every swarm ball
    const t = loadSim();
    t.run('campaignStart(); campaign.stage = 5; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pause = 0; ai[1].on = false');
    t.run('const b = allPlayers[1]; b.cd.marionette = 0; b.x = NETX + 380; b.y = H - 40; spawnSwarmBall(b, NETX + 150); spawnSwarmBall(b, NETX + 300); decoys.forEach(d => { d.vx = 0; d.vy = 0; d.y = 200; }); ball.vx = 0; ball.vy = 0');
    t.run('allPlayers[1].keys.sp = true; allPlayers[1].keys.l = true');
    for (let i = 0; i < 40; i++) t.run('update()');
    t.run('allPlayers[1].keys.sp = false');
    for (let i = 0; i < 3; i++) t.run('update()');
    const vx = t.run('decoys.map(d => d.vx)');
    check(vx.length === 2 && vx.every(v => v < -300), 'one marionette shove sends every swarm ball left (' + vx.map(v => Math.round(v)) + ')');
    check(t.run('ball.vx < -300'), 'and the real ball too');
}
// the AI fires the swarm at you
{
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 5; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; players[0].keys.l = false');
    s.run('const b = allPlayers[1], me = allPlayers[0]; b.cd.marionette = 0; me.x = NETX - 500; me.y = H - 40; me.vx = 0; me.vy = 0;');
    let fired = 0, err = null;
    try {
        for (let i = 0; i < 120 * 60 && !fired; i++) {
            s.run('players[0].x = NETX - 500; players[0].y = H - 40; update(); if (over) { score = [0, 0]; over = false; pause = 0; }');
            if (s.run('players[1].cd.marionette > 5')) fired = i;
        }
    } catch (e) { err = e; }
    check(!err, 'the AI runs the swarm with no errors' + (err ? ' ' + err.message : ''));
    console.log('       marionette fired after ' + fired + ' ticks; swarm balls: ' + s.run('decoys.filter(d => d.swarm).length'));
}

console.log('SPAWN PROTECTION, SPREAD ARROWS, THE DECOY + ARROW BOSS');
{
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 4; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; ai[1].on = false');
    s.run('players[0].alive = false; campaignRespawn()');
    check(s.run('players[0].alive && players[0].invT > 0.9 && players[1].invT === 0'), 'a player who respawns gets ~1 s of protection (the one who stayed alive does not)');
    s.run('const p = players[0]; spawnDecoy(players[1], p.x, p.y)');
    s.run('update()');
    check(s.run('players[0].alive'), 'a decoy sitting on their spawn does not kill them during it');
    let died = -1;
    for (let i = 0; i < 120 * 2 && died < 0; i++) { s.run('players[0].x = decoys[0].x; players[0].y = decoys[0].y; update()'); if (s.run('score[1] > 0')) died = i; }
    check(died > 100 && died < 140, 'and it kills them once the protection runs out (after ' + died + ' ticks)');
    const t = loadSim();
    t.run('resetMatch()');
    check(t.run('players.every(p => p.invT === 0)'), 'outside the campaign nobody is ever protected');
    t.run('spawnDecoy(players[1], players[0].x, players[0].y); update()');
    check(t.run('!players[0].alive'), 'and a decoy on a player still kills (normal game unchanged)');
    const u = loadSim();
    u.run('campaignStart(); campaign.stage = 4; campaignApply(); resetMatch(); players[1].arrowN = 3; projectiles.length = 0; fireArrow(players[1], { ang: -1.2, charge: 1 })');
    check(u.run('projectiles.filter(a => a.type === "arrow").length') === 3, 'stage 5: one shot = 3 arrows');
    check(u.run('CAMPAIGN_STAGES[4].arrows === 3 && allPlayers[1].arrowN === 3'), 'set by the stage');
    u.run('campaign.stage = 0; campaignApply()');
    check(u.run('allPlayers[1].arrowN === 1 && ai[1].combo === null'), 'and gone again on another stage');
}
{
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 4; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; players[0].keys.l = false');
    s.run('var nd = 0, nf = 0; const os = spawnDecoy; spawnDecoy = function (a, b, c) { nd++; return os(a, b, c); }; const of_ = fireArrow; fireArrow = function (p, c) { nf++; return of_(p, c); }');
    let err = null;
    try {
        for (let i = 0; i < 120 * 90; i++)
            s.run('players[0].x = NETX - 450; players[0].y = H - 40; players[0].vx = 0; update(); if (over) { score = [0, 0]; over = false; pause = 0; }');
    } catch (e) { err = e; }
    const decoyN = s.run('nd'), arrows = s.run('nf');
    check(!err, 'the decoy + arrow boss runs 90 s with no errors' + (err ? ' ' + err.message : ''));
    console.log(`       decoys placed ${decoyN}, arrow volleys ${arrows}, score ${JSON.stringify(s.run('score'))}`);
    check(decoyN >= 2 && arrows >= 2, 'she places decoys and fires arrows (both keys are used)');
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
