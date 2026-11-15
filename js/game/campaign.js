// CAMPAIGN - solo play: six stages, one boss each, in the style of Touhou's stage list. You are Blue (seat 0), the boss is Red (seat 1, the computer).
// Win a stage by scoring its `goal` points before the boss scores its `lose` points; then the next stage starts with a fresh score and the next boss. Lose a stage and it restarts
// (the boss' score and yours reset; `continues` counts the retries). Clear stage 6 and the campaign is over: the menu settings it borrowed come back.
// Offline only, never saved: a plain local mode that sits on top of rules.js (which asks goalOf() for the points a team needs and calls campaignAfterOver() when a stage ends).
// Load after ai.js. To give a boss its own abilities later, add fields to its entry in CAMPAIGN_STAGES and read them in campaignApply() (and in the AI if it needs new behaviour).
const CAMPAIGN_STAGES = [
    // goal = points YOU need to clear the stage, lose = points the boss needs to beat you (defaults to goal), special = the boss' ability (any id the AI knows, AI_SPECIAL_POOL),
    // lvl = how sharp the boss is (0..1; see aiLag in ai.js: lower = a longer reaction delay)
    { name: 'Stage 1', boss: 'Boss 1', goal: 5, special: 'dash',     lvl: 0.35 },
    { name: 'Stage 2', boss: 'Boss 2', goal: 5, special: 'arrow',    lvl: 0.5 },
    { name: 'Stage 3', boss: 'Boss 3', goal: 5, special: 'bat',      lvl: 0.65 },
    { name: 'Stage 4', boss: 'Boss 4', goal: 7, special: 'explode',  lvl: 0.8 },
    { name: 'Stage 5', boss: 'Boss 5', goal: 7, special: 'barbwire', lvl: 0.9 },
    { name: 'Stage 6', boss: 'Boss 6', goal: 9, special: 'awakened', lvl: 1 },
];
const campaign = { on: false, stage: 0, continues: 0, won: null, clear: false, saved: null }; // won = who took the stage that just ended (0 = you, 1 = the boss); clear = the last stage was just beaten
const campaignStage = () => CAMPAIGN_STAGES[Math.min(campaign.stage, CAMPAIGN_STAGES.length - 1)];
const campaignGoal = () => campaignStage().goal;
const campaignLose = () => campaignStage().lose || campaignStage().goal;
// The boss' settings for the current stage. Called whenever a stage starts (and again on a retry).
function campaignApply() {
    const s = campaignStage();
    ai[0].on = false;
    ai[1].on = true;
    ai[1].lvl = s.lvl;
    allPlayers[1].special = s.special;
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
    ai[1].lvl = 1;
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
    return t === 0 ? (campaign.clear ? ' - CAMPAIGN CLEAR!' : ' - stage clear!') : ' - you lose! retry';
}
// The WIN_PAUSE after a stage ended is over: on to the next stage, the same one again, or back to normal play after the last. Runs before the new round is set up.
function campaignAfterOver() {
    if (campaign.won === 0) {
        if (campaign.clear) {
            campaignStop(true);                // (resetMatch inside runs newRound itself; rules.js then builds one more round, which is harmless)
            return;
        }
        campaign.stage++;
    } else
        campaign.continues++;
    campaignApply();
}
