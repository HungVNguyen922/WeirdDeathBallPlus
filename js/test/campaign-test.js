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
check(R('ball.y > 55 && ball.vy > 50 && Math.abs(ball.x - NETX) < 0.01'), 'and falls dead straight down the net line');
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
check(R('campaignHome.on && campaignHome.view === "list" && campaignHome.note.includes("CLEAR")'), 'and lands on the campaign home screen');
R('campaignHomeClose()');
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
check(R('JSON.stringify(players[1].slots())') === '[["sp","explode"],["sp2","warp"]]', 'boss 4 has explode on its first key and warp on its second');
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

console.log('CAMPAIGN HOME SCREEN, PRACTICE, STAGE 5 SENDS BALLS');
{
    const s = loadSim(), R2 = c => s.run(c);
    const press = (k, n = 3) => { R2(`players[0].keys.${k} = true`); for (let i = 0; i < n; i++) R2('update()'); R2(`players[0].keys.${k} = false`); for (let i = 0; i < 3; i++) R2('update()'); };
    R2('campaignHomeOpen()');
    for (let i = 0; i < 40; i++) R2('update()');
    const y0 = R2('ball.y');
    for (let i = 0; i < 60; i++) R2('update()');
    check(R2('ball.y') === y0, 'the world holds still behind the home screen');
    check(R2('campaignHomeRows().map(r => r.label).join("|")') === 'THE SIX BOSSES|BACK TO BASE GAME', 'the list shows the campaign and BACK TO BASE GAME');
    press('dn');
    check(R2('campaignHome.cur') === 1, 'down moves the cursor');
    press('x');
    check(R2('!campaignHome.on && !campaign.on'), 'weight on the first screen goes back to the base game');
    R2('campaignHomeOpen()'); for (let i = 0; i < 40; i++) R2('update()');
    press('z');
    check(R2('campaignHome.view') === 'mode', 'grapple opens the campaign');
    press('x');
    check(R2('campaignHome.view') === 'list' && R2('campaignHome.on'), 'weight goes back one level');
    press('z'); press('dn'); press('z');
    check(R2('campaignHome.view') === 'stages' && R2('campaignHomeRows().length') === 7, 'stage select lists the six stages and BACK');
    press('dn'); press('dn'); press('dn'); press('z'); // stage 4
    check(R2('campaign.on && campaign.practice === 3 && !campaignHome.on && campaign.draft.on && campaign.draft.slot === 0'), 'practising stage 4 starts with the first draft');
    for (let i = 0; i < 40; i++) R2('update()');
    press('z', 3);
    for (let i = 0; i < 120; i++) R2('update()');
    check(R2('campaign.draft.on && campaign.draft.slot === 1 && campaign.stage === 1'), 'then the second draft');
    for (let i = 0; i < 40; i++) R2('update()');
    press('z', 3);
    for (let i = 0; i < 120; i++) R2('update()');
    check(R2('campaign.stage === 3 && !campaign.draft.on && campaign.bannerT > 0 && players[0].slots().length === 2'), 'then stage 4 itself, with both specials');
    for (let i = 0; i < 400; i++) R2('update()');
    for (let i = 0; i < 6; i++) R2('point(1, "scores!")');
    R2('point(1, "scores!")');
    check(R2('over && msg.includes("try it again")'), 'losing a practice stage says so');
    for (let i = 0; i < 900 && R2('over'); i++) R2('update()');
    check(R2('campaign.on && campaign.stage === 3 && !campaign.draft.on && score[0] === 0 && score[1] === 0'), 'and retries the same stage with the same loadout');
    for (let i = 0; i < 400; i++) R2('update()');
    for (let i = 0; i < 7; i++) R2('point(0, "scores!")');
    for (let i = 0; i < 900 && !R2('campaignHome.on'); i++) R2('update()');
    check(R2('!campaign.on && campaignHome.on && campaignHome.note === "STAGE 4 CLEARED"'), 'clearing a practice stage lands on the campaign screen');
    check(R2('swapOn === true && NET_GAP === NET_GAP_CLASSIC'), 'with the base game restored');
}
{
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 4; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; ai[1].on = false');
    check(s.run('allPlayers[1].arrowSend === 700'), 'stage 5: her arrows send balls at 700');
    s.run('const b = allPlayers[1], me = allPlayers[0]; me.x = NETX - 300; me.y = H - 40; ball.x = NETX + 200; ball.y = 200; ball.vx = 0; ball.vy = 0; projectiles.length = 0; spawnProjectile("arrow", b, ball.x + 4, ball.y, 0, 0, { ang: 0, stuck: false, immune: 0, ghost: 0 }); update()');
    const sp = s.run('Math.hypot(ball.vx, ball.vy)'), dir = s.run('ball.vx');
    check(Math.abs(sp - 700) < 40 && dir < 0, 'an arrow hitting the real ball sends it at the player at ~700 (' + Math.round(sp) + ')');
    s.run('spawnDecoy(allPlayers[1], NETX + 200, 300); const d = decoys[0]; d.vx = 0; d.vy = 0; projectiles.length = 0; spawnProjectile("arrow", allPlayers[1], d.x + 4, d.y, 0, 0, { ang: 0, stuck: false, immune: 0, ghost: 0 }); update()');
    check(Math.abs(s.run('Math.hypot(decoys[0].vx, decoys[0].vy)') - 700) < 40, 'and a decoy too');
}
{
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 4; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; players[0].keys.l = false');
    s.run('var nd = 0, nf = 0, fast = 0; const os = spawnDecoy; spawnDecoy = function (a, b, c) { nd++; return os(a, b, c); }; const of_ = fireArrow; fireArrow = function (p, c) { nf++; return of_(p, c); }');
    let err = null;
    try {
        for (let i = 0; i < 120 * 90; i++) {
            s.run('players[0].x = NETX - 450; players[0].y = H - 40; players[0].vx = 0; update(); if (over) { score = [0, 0]; over = false; pause = 0; } if (decoys.some(d => Math.hypot(d.vx, d.vy) > 600) || Math.hypot(ball.vx, ball.vy) > 650) fast++');
        }
    } catch (e) { err = e; }
    check(!err, 'the new stage 5 AI runs 90 s with no errors' + (err ? ' ' + err.message : ''));
    console.log(`       decoys ${s.run('nd')}, arrow volleys ${s.run('nf')}, ticks with a ball sent fast ${s.run('fast')}, score ${JSON.stringify(s.run('score'))}`);
    check(s.run('nd') >= 5 && s.run('nf') >= 8 && s.run('fast') > 20, 'she throws decoys constantly and sends balls at you');
}

console.log('STAGE 5 BOSS GRAPPLES HER DECOY');
{
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 4; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; players[0].keys.l = false; var hd = 0, hb = 0, fa = 0, df = 0, pa = 0, pd = 0; const of_ = fireArrow; fireArrow = function (p, c) { fa++; return of_(p, c); }; const op = point; point = function (t, m) { const me = players[0]; if (t === 1) { if (decoys.some(d => Math.hypot(d.x - me.x, d.y - me.y) < 90)) pd++; else pa++; } return op(t, m); }');
    for (let i = 0; i < 120 * 90; i++)
        s.run('players[0].x = NETX - 450; players[0].y = H - 40; players[0].vx = 0; update(); if (over) { score = [0, 0]; over = false; pause = 0; } { const t = players[1].tball; if (t && decoys.includes(t)) hd++; else if (t === ball) hb++; }');
    const hd = s.run('hd') / 120, hb = s.run('hb') / 120;
    console.log(`       holding a decoy ${hd.toFixed(1)} s, the ball ${hb.toFixed(1)} s, arrows ${s.run('fa')}, points by decoy ${s.run('pd')} / other ${s.run('pa')}`);
    check(hd > 4, 'the stage 5 boss grapples her decoy');
    check(hb > 1, 'and the death ball');
    check(s.run('pd') >= 2, 'and swings it into the other player');
    check(s.run('fa') < 25, 'while saving her arrows for a good angle');
}

console.log('CAMPAIGN 1 STAGE TABLE, CLOCK AND SCORING');
{
    const s = loadSim();
    const st = JSON.parse(s.run('JSON.stringify(campaignStages().map(x => ({ goal: x.goal, time: x.time || null, gap: x.gap / PL, special: x.special, special2: x.special2 || null })))'));
    check(JSON.stringify(st.map(x => x.gap)) === '[6,6,4,4,4,4]', 'net gaps are 6, 6, 4, 4, 4, 4 PL');
    check(JSON.stringify(st.map(x => x.goal)) === '[5,5,7,7,7,9]', 'goals are 5, 5, 7, 7, 7, 9');
    check(JSON.stringify(st.map(x => x.time)) === '[60,90,120,180,210,null]', 'time limits are 1:00, 1:30, 2:00, 3:00, 3:30 and none');
    check(st[3].special === 'explode' && st[3].special2 === 'warp' && st[5].special === 'marionette' && st[5].special2 === 'bat', 'stage 4 has explode + warp, stage 6 marionette + bat');
    const fresh = () => { const t = loadSim(); t.run('localStorage = undefined; campaignStart(); campaign.stage = 0; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0'); return t; };
    let t = fresh();
    t.run('campaign.pts = 0; campaignOnPoint(0, "scores!")');
    check(t.run('campaign.pts') === 500, 'a goal is worth 500');
    t.run('campaign.pts = 0; campaignOnPoint(0, "wipes out the other team!")');
    check(t.run('campaign.pts') === 300, 'a kill is worth 300');
    t = fresh();
    t.run('score = [2, 1]; campaign.pts = 0; campaign.timeT = 0.001; campaignClockTick()');
    check(t.run('over') === true && t.run('campaign.won') === 0 && t.run('campaign.pts') === 100, 'time up while ahead is a win worth 100 (not perfect: she scored)');
    t = fresh();
    t.run('score = [1, 1]; campaign.pts = 0; campaign.timeT = 0.001; campaignClockTick()');
    check(t.run('over') === true && t.run('campaign.won') === 1 && t.run('campaign.pts') === 0, 'a tie when time is up is a loss');
    t = fresh();
    t.run('score = [2, 0]; campaign.pts = 0; campaign.timeT = 0.001; campaignClockTick()');
    check(t.run('campaign.pts') === 600, 'a timeout win with the boss on zero is 100 + a perfect 500');
    t = fresh();
    t.run('campaign.pts = 0; score = [5, 2]; over = true; campaignOverText(0)');
    check(t.run('campaign.pts') === 300, 'a proper win is worth 300');
    // graze: an object passing close without touching
    t = fresh();
    t.run('const me = allPlayers[0]; me.x = 200; me.y = H - 40; me.invT = 0; ball.x = me.x + me.r + ball.r + 10; ball.y = me.y; ball.vx = 0; ball.vy = -400; ball.lastGrab = 1; campaign.pts = 0; campaignGrazeTick()');
    check(t.run('campaign.pts') === 300, 'a fast death ball the boss touched last, passing close, pays a 300 graze');
    t.run('campaignGrazeTick()');
    check(t.run('campaign.pts') === 300, 'but the same object does not pay again straight away');
    t = fresh();
    t.run('const me = allPlayers[0]; me.x = 200; me.y = H - 40; me.invT = 0; ball.x = me.x + me.r + ball.r + 10; ball.y = me.y; ball.vx = 0; ball.vy = -400; ball.lastGrab = 0; campaign.pts = 0; campaignGrazeTick()');
    check(t.run('campaign.pts') === 0, 'a ball the PLAYER touched last pays nothing');
    // high score
    t = fresh();
    t.run('var store = {}; localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } }; campaign.practice = null; campaign.pts = 900; campaignRecordHi()');
    check(t.run('campaign.newHi') === true && t.run('campaignHi(CAMPAIGN_LIST[0].id)') === 900, 'a better run is saved as the high score');
    t.run('campaign.pts = 400; campaignRecordHi()');
    check(t.run('campaign.newHi') === false && t.run('campaignHi(CAMPAIGN_LIST[0].id)') === 900, 'a worse one is not');
    // speed of light
    t = loadSim();
    t.run('campaignStart(); campaign.stage = 2; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; score = [4, 0]; campaignOnPoint(1, "scores!")');
    check(t.run('allPlayers[1].dashCut[0] + allPlayers[1].dashCut[1]') > 0 && t.run('allPlayers[1].dashMin') === 0.5, 'stage 3: every point either way shortens one of her dashes');
    t.run('score = [5, 0]; campaignOnPoint(0, "scores!")');
    check(t.run('allPlayers[1].dashMin') === 0 && t.run('allPlayers[1].cd.dash') === 0 && t.run('allPlayers[1].cd.dash2') === 0, 'player on 5 points: SPEED OF LIGHT, her dashes have no cooldown');
    t.run('const c0 = allPlayers[1].dashCut.slice(); campaignOnPoint(1, "scores!"); var same = JSON.stringify(c0) === JSON.stringify(allPlayers[1].dashCut)');
    check(t.run('same') && t.run('allPlayers[1].dashMin') === 0, 'and it stays that way');
}

console.log('SPECIALTIES: DRIVING, SWEEP, TRANSMISSION, PLINKO, SWEEP BAT');
{
    const s = loadSim();
    const f = n => JSON.parse(s.run('campaignStart(); campaign.stage = ' + n + '; campaignApply(); JSON.stringify([ai[1].plunge, ai[1].drive, ai[1].sweep, ai[1].plinkoBoost, allPlayers[1].explodeCd, ai[1].combo])'));
    check(f(0)[0] > 0 && f(2)[0] > 0 && f(1)[0] === 0, 'plunge belongs to stages 1 and 3');
    check(f(3)[1] > 0 && f(4)[1] > 0 && f(0)[1] === 0, 'driving belongs to stages 4 and 5');
    check(f(5)[2] > 0 && f(4)[2] === 0, 'sweep belongs to stage 6');
    check(f(1)[3] === true && f(0)[3] === false, 'plinko boosting belongs to stage 2');
    check(f(3)[4] > 0 && f(3)[4] < 10 && f(3)[5] === 'transmit', 'stage 4: Instant Transmission and a short blast cooldown (so she can chain them)');
    check(f(0)[4] === 0, 'other bosses keep the normal blast cooldown');
}
{   // stage 4: she teleports next to the ball and blasts
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 3; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; var tp = 0, ex = 0, dmax = 0; var lw = null;');
    let err = null;
    try {
        for (let i = 0; i < 120 * 70; i++)
            s.run('allPlayers[0].x = NETX - 300; allPlayers[0].y = H - 40; allPlayers[0].vx = 0; update(); if (over) { score = [0, 0]; over = false; pause = 0; } { const p = allPlayers[1]; if (p.warpFx && p.warpFx.t > WARP_FX - 0.009) { tp++; dmax = Math.max(dmax, Math.hypot(p.x - ball.x, p.y - ball.y)); } if (p.explodeFx && p.explodeFx.t > EXPLODE_FX - 0.009) ex++; }');
    } catch (e) { err = e; }
    check(!err, 'the stage 4 AI runs 70 s with no errors' + (err ? ' ' + err.message : ''));
    console.log(`       teleports ${s.run('tp')}, blasts ${s.run('ex')}, farthest arrival from the ball ${Math.round(s.run('dmax'))}`);
    check(s.run('tp') >= 1 && s.run('ex') >= 1, 'she teleports and blasts');
    check(s.run('dmax') <= 80, 'she arrives right next to the ball (within about 2 PL of it) and never inside it');
}
{   // stage 6: the sweep: bat and marionette
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 5; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; var bat = 0, mar = 0, pb = 0, pm = 0;');
    let err = null;
    try {
        for (let i = 0; i < 120 * 80; i++)
            s.run('allPlayers[0].x = NETX - 300; allPlayers[0].y = H - 40; allPlayers[0].vx = 0; update(); if (over) { score = [0, 0]; over = false; pause = 0; } { const p = allPlayers[1]; if (p.cd.bat > BAT_COOLDOWN - 0.02 && pb <= BAT_COOLDOWN - 0.02) bat++; pb = p.cd.bat; if (p.cd.marionette > MARIONETTE_COOLDOWN - 0.02 && pm <= MARIONETTE_COOLDOWN - 0.02) mar++; pm = p.cd.marionette; }');
    } catch (e) { err = e; }
    check(!err, 'the stage 6 AI runs 80 s with no errors' + (err ? ' ' + err.message : ''));
    console.log(`       bat swings ${s.run('bat')}, marionette shoves ${s.run('mar')}`);
    check(s.run('mar') >= 1, 'she shoves her death balls with the marionette');
    check(s.run('bat') >= 1, 'and swings the bat at pooled balls');
}
{   // stage 2: the second peg goes up by the net
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 1; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0;');
    const first = s.run('aiPlinkoSpot(allPlayers[1])');
    s.run('pegs.push({ x: 880, y: H - 40, vx: 0, vy: 0, r: PEG_R, team: 1, owner: allPlayers[1], flash: 0, life: 10 })');
    const second = s.run('aiPlinkoSpot(allPlayers[1])');
    check(Math.abs(first - 480) > 300 && Math.abs(second - 480) < 6 * 32 && second > 480, 'the stage 2 boss puts her first peg back by her goal and her second up by the net (' + Math.round(first) + ' then ' + Math.round(second) + ')');
}
console.log('PASSES, AND AWARDS STACK');
{
    const fresh = () => { const t = loadSim(); t.run('campaignStart(); campaign.stage = 0; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0'); return t; };
    let t = fresh();
    t.run('const me = allPlayers[0]; me.x = 150; me.y = 300; ball.x = 500; ball.y = 250; ball.vx = -200; ball.vy = 0; ball.lastGrab = 1; allPlayers[1].tball = null; campaign.pts = 0; campaignGrazeTick();');
    check(t.run('campaign.pass') === true, 'a ball the boss threw, still in the air, is a live pass');
    t.run('allPlayers[0].tball = ball; campaignGrazeTick()');
    check(t.run('campaign.pts') === 100, 'grappling it before it lands pays a 100 PASS');
    t = fresh();
    t.run('ball.x = 500; ball.y = 250; ball.vx = -200; ball.vy = 0; ball.lastGrab = 1; allPlayers[1].tball = null; campaign.pts = 0; campaignGrazeTick(); ball.y = H; ball.x = 400; campaignGrazeTick(); allPlayers[0].tball = ball; campaignGrazeTick()');
    check(t.run('campaign.pts') === 0, 'but not once it has touched the floor');
    t = fresh();
    t.run('ball.x = 500; ball.y = 250; ball.vx = -200; ball.vy = 0; ball.lastGrab = 0; campaign.pts = 0; campaignGrazeTick(); allPlayers[0].tball = ball; campaignGrazeTick()');
    check(t.run('campaign.pts') === 0, 'or for a ball the player threw');
    t = fresh();
    t.run('campaignAward(500, "GOAL"); campaignAward(300, "STAGE CLEAR"); campaignAward(500, "PERFECT")');
    check(t.run('campaign.pops.filter(p => !p.big).length') === 3, 'three awards at once are three separate list entries (drawn one under the other)');
}

console.log('TELEPORT SPOTS');
{
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 3; campaignApply(); resetMatch();');
    const ok = (x, y) => s.run('aiSpotOk(' + x + ', ' + y + ', 16)');
    check(ok(700, 300) === true, 'open air is fine');
    check(ok(480, 400) === false, 'inside the net is not');
    check(ok(700, 640 - 10) === false && ok(700, 620) === false && ok(700, 640 - 40) === true, 'the floor (or too near it) is not');
    check(ok(20, 300) === false && ok(940, 300) === false, 'the wall side is not');
    check(ok(30, 560) === false, 'a goal mouth is not');
}

console.log('SPEED OF LIGHT DASHES, HELD-BALL STANCE');
{
    const run = (sol) => {
        const s = loadSim();
        s.run('Math.random = (() => { let x = 4242; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; })();');
        s.run('campaignStart(); campaign.stage = 2; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; var nd = 0, na = 0, g = 0, ps = 0, dead = 0;' + (sol ? ' allPlayers[1].dashMin = 0; allPlayers[1].dashCut = [DASH_COOLDOWN, DASH_COOLDOWN];' : ''));
        for (let i = 0; i < 120 * 60; i++)
            s.run('allPlayers[0].x = NETX - 300; allPlayers[0].y = H - 40; allPlayers[0].vx = 0; update(); if (over) { score = [0, 0]; ps = 0; over = false; pause = 0; } { if (score[1] > ps) g += score[1] - ps; ps = score[1]; if (score[0] > 0) { dead++; score[0] = 0; } const p = allPlayers[1]; if (p.dashT > DASH_FX - 0.009) { nd++; if (!p.ground) na++; } }');
        return { dashes: s.run('nd'), air: s.run('na'), goals: s.run('g'), dead: s.run('dead') };
    };
    const a = run(false), b = run(true);
    console.log(`       60 s: normal ${JSON.stringify(a)}, Speed of Light ${JSON.stringify(b)}`);
    check(b.dashes >= 1.5 * a.dashes && b.dashes >= 15, 'with Speed of Light she dashes a lot more (it is how she moves)');
    check(b.air >= 1, 'including in mid-flight');
    check(b.dead <= 1, 'and does not run herself into the death ball');
    check(b.goals >= a.goals * 0.6, 'and her attack does not suffer for it');
}
{   // a human holding the ball near the net: the boss drops back towards her goal
    const s = loadSim();
    s.run('campaignStart(); campaign.stage = 4; campaignApply(); resetMatch(); campaign.draft.on = false; campaign.bannerT = 0; pick.on = false; pause = 0; ai[1].combo = null; allPlayers[1].x = 560; allPlayers[1].y = H - 40;');
    for (let i = 0; i < 120 * 4; i++)
        s.run('allPlayers[0].onBall = true; allPlayers[0].tball = ball; ball.x = 540; ball.y = 120; ball.vx = 0; ball.vy = 0; update();');
    check(s.run('allPlayers[1].x') > 700, 'while the player holds the ball over the net she backs off towards her goal (x = ' + Math.round(s.run('allPlayers[1].x')) + ')');
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
