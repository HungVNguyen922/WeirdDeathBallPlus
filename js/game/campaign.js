// CAMPAIGN - solo play: six stages, one boss each, in the style of Touhou's stage list. You are Blue (seat 0), the boss is Red (seat 1, the computer).
// It is ONE LONG RUN: there is no restart (R is off, and the menu button asks before it quits). Win a stage by scoring its `goal` points before the boss scores the same number; then the
// next stage starts with a fresh score, its own net, and the next boss. LOSE a stage and the whole run starts again from stage 1 (`continues` counts the tries).
// Points do not end the round: after a point the ball respawns at the top of the net and falls down the net line, anyone who was killed respawns at once, and play carries on.
// Offline only, never saved: a plain local mode that sits on top of rules.js (goalOf(), point(), newRound()) and ai.js (aiPickSpecial, ai[i].lvl / .plunge, aiLag).
// Load after ai.js. A boss is one entry of CAMPAIGN_STAGES; campaignApply() puts it into the game. Add fields there for new bosses and read them in campaignApply().
const CAMPAIGN_STAGES = [
    // name / boss: shown to the player (placeholders for most).
    // goal: points to clear the stage = points the boss needs to beat you. gap: the net's gap at the top (NET_GAP): 4*PL = the classic net, a smaller gap = a taller net, H = no net.
    // special: the boss' ability (any id the AI knows, AI_SPECIAL_POOL). special2: a second one on the boss' second key (the AI uses dash from either key). dashes: 2 = a second, separate dash.
    // gimmick: 'dashCut' = every point (either way) shaves 0.5 s off one of her two dash cooldowns, picked at random.   plunge: how much the AI likes shots that come down steeply (0 = no preference).
    // lvl: how sharp the boss is (0..1; a lower level reacts later, see aiLag in ai.js).
    { name: 'Stage 1', boss: 'Boss 1', goal: 5, gap: 2 * PL, special: 'dash', dashes: 2, gimmick: 'dashCut', plunge: 120, lvl: 0.4 },
    { name: 'Stage 2', boss: 'Boss 2', goal: 5, gap: 2 * PL, special: 'arrow', special2: 'dash', lvl: 0.55 },
    { name: 'Stage 3', boss: 'Boss 3', goal: 5, gap: 4 * PL, special: 'bat', lvl: 0.65 },
    { name: 'Stage 4', boss: 'Boss 4', goal: 7, gap: 4 * PL, special: 'explode', lvl: 0.8 },
    { name: 'Stage 5', boss: 'Boss 5', goal: 7, gap: 4 * PL, special: 'bat', special2: 'decoy',lvl: 0.9 },
    { name: 'Stage 6', boss: 'Boss 6', goal: 9, gap: 4 * PL, special: 'awakened', special2: 'marionette', lvl: 1 },
];
const campaign = { on: false, stage: 0, continues: 0, won: null, clear: false, saved: null }; // won = who took the stage that just ended (0 = you, 1 = the boss); clear = the last stage was just beaten
const campaignStage = () => CAMPAIGN_STAGES[Math.min(campaign.stage, CAMPAIGN_STAGES.length - 1)];
const campaignGoal = () => campaignStage().goal;
const campaignLose = () => campaignStage().lose || campaignStage().goal;
function campaignBossReset() { // the boss' extra mechanics back to the normal game
    const b = allPlayers[1];
    b.dual = false;
    b.dashN = 1;
    b.dashCut = [0, 0];
    ai[1].lvl = 1;
    ai[1].plunge = 0;
}
// The boss' settings and the net for the current stage. Called whenever a stage starts (and again when the run starts over).
function campaignApply() {
    const s = campaignStage(), b = allPlayers[1];
    ai[0].on = false;
    ai[1].on = true;
    ai[1].lvl = s.lvl;
    ai[1].plunge = s.plunge || 0;
    b.special = s.special;
    b.special2 = s.special2 || 'plinko';
    b.dual = !!s.special2;
    b.dashN = s.dashes || 1;
    b.dashCut = [0, 0];
    setNetGap(s.gap);
}
function campaignStart() {
    if (campaign.on)
        return;
    campaign.saved = { swapOn, pickFixed, twoSpecials, teamSize, ai0: ai[0].on, ai1: ai[1].on };
    swapOn = false;                            // one fixed side per stage
    pickFixed = false;                         // the boss' ability is set by the stage, not by a pick screen
    twoSpecials = false;
    allPlayers.forEach(p => { if (p.special === 'fighter' || p.special2 === 'fighter') { p.special = 'dash'; p.special2 = 'plinko'; } });
    if (teamSize !== 1) {
        layoutTeams(1);
        teamSize = 1;
    }
    Object.assign(campaign, { on: true, stage: 0, continues: 0, won: null, clear: false });
    campaignApply();
    resetMatch();
}
// Leave the campaign and put the borrowed settings back. restore = false when something else (2v2, Flex, ...) just changed them on purpose.
function campaignStop(restore = true) {
    if (!campaign.on)
        return;
    campaign.on = false;
    const s = campaign.saved;
    campaign.saved = null;
    campaignBossReset();
    setNetGap(NET_GAP_CLASSIC);
    if (restore && s) {
        swapOn = s.swapOn;
        pickFixed = s.pickFixed;
        twoSpecials = s.twoSpecials;
        ai[0].on = s.ai0;
        ai[1].on = s.ai1;
        if (s.teamSize !== teamSize) {
            layoutTeams(s.teamSize);
            teamSize = s.teamSize;
        }
    }
    if (restore)
        resetMatch();
}
const campaignAbort = () => campaignStop(false); // a setter in rules.js that changes the match type (2v2, Flex, roster, ...) calls this first
// The text after the score message when a stage ends (rules.js point()).
function campaignOverText(t) {
    campaign.won = t;
    campaign.clear = t === 0 && campaign.stage >= CAMPAIGN_STAGES.length - 1;
    return t === 0 ? (campaign.clear ? ' - CAMPAIGN CLEAR!' : ' - stage clear!') : ' - you lose! back to stage 1';
}
// The WIN_PAUSE after a stage ended is over: on to the next stage, or (a loss) back to the very first one, or back to normal play after the last. Runs before the new round is set up.
function campaignAfterOver() {
    if (campaign.won === 0) {
        if (campaign.clear) {
            campaignStop(true);                // (resetMatch inside runs newRound itself; rules.js then builds one more round, which is harmless)
            return;
        }
        campaign.stage++;
    } else {
        campaign.stage = 0;                    // one long run: a lost stage means starting over
        campaign.continues++;
    }
    campaignApply();
}
// ---- every point (either way), called from rules.js point() before the next round starts ----
function campaignOnPoint(t) {
    const s = campaignStage(), b = allPlayers[1];
    if (s.gimmick === 'dashCut') { // one of her two dashes, at random, comes back 0.5 s sooner for good (and the one that is cooling down right now is helped too)
        const i = Math.random() < 0.5 ? 0 : 1, id = i ? 'dash2' : 'dash';
        b.dashCut[i] = Math.min(b.dashCut[i] + 1, DASH_COOLDOWN - 1);
        b.cd[id] = Math.max(0, b.cd[id] - 1);
    }
}
// Where the ball appears: the top of the net, falling down the net line (a little sideways drift so it is not always the same).
function campaignSpawnBall() {
    ball.x = NETX;
    ball.y = Math.max(ball.r + 6, Math.min(NET_GAP, 3 * PL) - ball.r);
    ball.vx = (Math.random() - 0.5) * 80;
    ball.vy = 0;
}
// A point that does not end the stage: no pause, no new round. The ball respawns, whoever was killed comes back at their spawn, everything else carries on.
function campaignRespawn() {
    for (const p of players) {
        if (p.onBall || p.tball) { // let go of the old ball (it is about to be moved)
            p.onBall = false;
            p.tball = null;
            p.rope = null;
            p.pending = null;
        }
        if (!p.alive)
            p.reset();
    }
    decoys.length = 0;
    ball.reset();
    campaignSpawnBall();
    ai.forEach((a, i) => aiReset(i));          // forget plans made for the old ball
    events.onNewRound();
}
