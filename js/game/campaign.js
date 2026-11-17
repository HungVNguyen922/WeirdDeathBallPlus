// CAMPAIGN - solo play: six stages, one boss each, in the style of Touhou's stage list. You are Blue (seat 0), the boss is Red (seat 1, the computer).
// It is ONE LONG RUN: there is no restart (R is off, and the menu button asks before it quits). Win a stage by scoring its `goal` points before the boss scores the same number; then the
// next stage starts with a fresh score, its own net, and the next boss. LOSE a stage and the whole run starts again from stage 1 (`continues` counts the tries).
// Points do not end the round: after a point the ball respawns at the top of the net and falls down the net line, anyone who was killed respawns at once, and play carries on.
// Offline only, never saved: a plain local mode that sits on top of rules.js (goalOf(), point(), newRound()) and ai.js (aiPickSpecial, ai[i].lvl / .plunge, aiLag).
// ROGUELIKE LOADOUT: the campaign is always a two-special game. Before stage 1 you are offered 3 random specials and keep one; before stage 2 you are offered 3 more (never the one
// you have) for your second key. After that the loadout is fixed for the run (the free-swap menu is off). A new run (after a loss) drafts again. Every stage opens with a banner.
// Load after ai.js. A boss is one entry of CAMPAIGN_STAGES; campaignApply() puts it into the game. Add fields there for new bosses and read them in campaignApply().
// Boss skins: one list of layers per stage (see skin-data.js: t shape, x/y centre in player radii, w/h half size, r rotation, c colour, o 0 = inside the circle / 1 = outside, like a hat).
// The team colour rim is always drawn on top, so the boss stays Red. Draw new ones in the skin editor and paste the layers here.
const L = (t, x, y, w, h, r, c, o) => ({ t, x, y, w, h, r, c, o });
const CAMPAIGN_SKINS = [
    [L('oval', 0, 0, 1, 1, 0, '#ffd54f', 0), L('oval', -0.35, -0.2, 0.14, 0.2, 0, '#222222', 0), L('oval', 0.35, -0.2, 0.14, 0.2, 0, '#222222', 0), L('half', 0, 0.4, 0.45, 0.3, 0, '#c62828', 0), L('tri', 0, -1.2, 0.55, 0.5, 0, '#8d6e63', 1)],
    [L('oval', 0, 0, 1, 1, 0, '#7e57c2', 0), L('star', -0.4, -0.3, 0.25, 0.25, 0, '#ffffff', 0), L('star', 0.4, 0.1, 0.25, 0.25, 0, '#ffffff', 0), L('star', -0.1, 0.5, 0.2, 0.2, 0, '#ffffff', 0), L('ring', 0, 0, 1.3, 1.3, 0, '#b39ddb', 1)],
    [L('oval', 0, 0, 1, 1, 0, '#26c6da', 0), L('rect', -0.35, 0, 0.12, 1.2, 25, '#006064', 0), L('rect', 0.35, 0, 0.12, 1.2, 25, '#006064', 0), L('rect', 0, -0.55, 1.15, 0.13, 0, '#ffffff', 1), L('tri', -0.6, -1.0, 0.3, 0.4, -20, '#00838f', 1), L('tri', 0.6, -1.0, 0.3, 0.4, 20, '#00838f', 1)],
    [L('oval', 0, 0, 1, 1, 0, '#37474f', 0), L('cross', -0.35, -0.15, 0.2, 0.2, 45, '#ff7043', 0), L('cross', 0.35, -0.15, 0.2, 0.2, 45, '#ff7043', 0), L('moon', -1.3, 0, 0.5, 0.7, 0, '#ff7043', 1), L('moon', 1.3, 0, 0.5, 0.7, 180, '#ff7043', 1), L('tri', -0.5, -1.15, 0.25, 0.45, 0, '#263238', 1), L('tri', 0.5, -1.15, 0.25, 0.45, 0, '#263238', 1)],
    [L('oval', 0, 0, 1, 1, 0, '#eceff1', 0), L('ring', 0, 0, 0.8, 0.8, 0, '#90a4ae', 0), L('cross', -0.3, -0.2, 0.15, 0.15, 45, '#455a64', 0), L('cross', 0.3, -0.2, 0.15, 0.15, 45, '#455a64', 0), L('heart', 0, 0.45, 0.2, 0.2, 0, '#f48fb1', 0)],
    [L('oval', 0, 0, 1, 1, 0, '#212121', 0), L('ring', 0, 0, 0.75, 0.75, 0, '#d50000', 0), L('star', 0, 0, 0.35, 0.35, 0, '#d50000', 0), L('tri', -0.5, -1.2, 0.25, 0.4, 0, '#ffca28', 1), L('tri', 0, -1.3, 0.25, 0.5, 0, '#ffca28', 1), L('tri', 0.5, -1.2, 0.25, 0.4, 0, '#ffca28', 1), L('rect', -0.7, -2.3, 0.03, 1.2, 0, '#e0e0e0', 1), L('rect', 0.7, -2.3, 0.03, 1.2, 0, '#e0e0e0', 1)],
];
const CAMPAIGN_STAGES = [
    // name / boss: shown to the player (placeholders for most).
    // goal: points to clear the stage = points the boss needs to beat you. gap: the net's gap at the top (NET_GAP): 4*PL = the classic net, a smaller gap = a taller net, H = no net.
    // special: the boss' ability (any id the AI knows, AI_SPECIAL_POOL). special2: a second one on the boss' second key (the AI uses dash from either key). dashes: 2 = a second, separate dash.
    // gimmick: 'dashCut' = every point (either way) shaves 1 s (CAMPAIGN_DASH_CUT) off one of her two dash cooldowns, picked at random.   plunge: how much the AI likes shots that come down steeply (0 = no preference).
    // lvl: how sharp the boss is (0..1; a lower level reacts later, see aiLag in ai.js).
    // time: the stage clock in seconds (none = no limit): when it runs out the player wins only by being AHEAD (a tie is a loss, and a timeout win is worth less).
    // speedAt: with 'dashCut', the player reaching this many points takes every cooldown off her dashes.   drive: how much the AI likes flat, fast shots at the top half of the goal (see plunge).   sweep: the same for shots that skim the floor into the bottom half.
    // combo: a combined AI plan for her two specials ('decoyArrow', 'transmit' = stage 4's instant transmission, 'sweep' = stage 6's volleying).
    { name: 'Stage 1', boss: 'Boss 1', goal: 5, time: 60, gap: 1 * PL, special: 'dash', plunge: 120, lvl: 0.4, skin: CAMPAIGN_SKINS[0] },
    { name: 'Stage 2', boss: 'Boss 2', goal: 5, time: 90, gap: 1 * PL, special: 'plinko', plinkoBoost: true, lvl: 0.55, skin: CAMPAIGN_SKINS[1] },
    { name: 'Stage 3', boss: 'Boss 3', goal: 7, time: 120, gap: 4 * PL, special: 'dash', dashes: 2, gimmick: 'dashCut', speedAt: 5, plunge: 120, lvl: 0.7, skin: CAMPAIGN_SKINS[2] },
    { name: 'Stage 4', boss: 'Boss 4', goal: 7, time: 180, gap: 4 * PL, special: 'explode', special2: 'warp', combo: 'transmit', explodeCd: 3, drive: 100, lvl: 0.8, skin: CAMPAIGN_SKINS[3] },
    { name: 'Stage 5', boss: 'Boss 5', goal: 7, time: 210, gap: 4 * PL, special: 'decoy', special2: 'arrow', arrows: 3, arrowSend: 700, combo: 'decoyArrow', drive: 100, lvl: 0.9, skin: CAMPAIGN_SKINS[4] },
    { name: 'Stage 6', boss: 'Boss 6', goal: 9, gap: 4 * PL, special: 'marionette', special2: 'bat', combo: 'sweep', sweep: 100, lvl: 1, skin: CAMPAIGN_SKINS[5], swarm: { first: 6, every: 9, max: 4, life: 30 } },
];
const CAMPAIGN_DASH_CUT = 1;           // seconds every point (either way) takes off one of a 'dashCut' boss' two dash cooldowns
const CAMPAIGN_INV_T = 1;              // seconds of invincibility for a player who respawns after a point (so a carried-over decoy cannot spawn-camp)
const CAMPAIGN_BANNER_T = 2.2;         // seconds of the stage banner (the world holds still)
const CAMPAIGN_LOCK_T = 0.7;           // seconds the chosen card shows before the draft closes
const CAMPAIGN_DRAFT_AT = [0, 1];      // the stages (0-based) that open with a draft: the first and the second special
// The campaigns on the home screen. Add one by adding an entry with its own stages array (same fields as CAMPAIGN_STAGES).
const CAMPAIGN_LIST = [
    { id: 'bosses', name: 'THE SIX BOSSES', blurb: 'Six fights, one long run. Lose a stage and it starts over.', stages: CAMPAIGN_STAGES },
];
const campaignStages = () => (campaign.def || CAMPAIGN_LIST[0]).stages;
const campaign = { on: false, def: null, practice: null, pts: 0, pops: [], clock: 0, timeT: null, newHi: false, stage: 0, continues: 0, won: null, clear: false, saved: null, bannerT: 0, draft: { on: false, slot: 0, offer: [], cur: 1, t: 0, lock: 0, chosen: -1, prev: 0 } }; // won = who took the stage that just ended (0 = you, 1 = the boss); clear = the last stage was just beaten
const campaignStage = () => campaignStages()[Math.min(campaign.stage, campaignStages().length - 1)];
const campaignGoal = () => campaignStage().goal;
const campaignLose = () => campaignStage().lose || campaignStage().goal;
function campaignBossReset() { // the boss' extra mechanics back to the normal game
    const b = allPlayers[1];
    b.dual = false;
    b.dashN = 1;
    b.dashCut = [0, 0];
    b.dashMin = 0.5;
    b.explodeCd = 0;
    ai[1].lvl = 1;
    ai[1].drive = 0;
    ai[1].sweep = 0;
    ai[1].plinkoBoost = false;
    ai[1].plunge = 0;
    campaignSwarmClear();
    campaignMapSet(null);
    b.arrowN = 1;
    b.arrowSend = 0;
    b.invT = 0;
    ai[1].combo = null;
}
// The boss' settings and the net for the current stage. Called whenever a stage starts (and again when the run starts over).
function campaignApply() {
    const s = campaignStage(), b = allPlayers[1];
    ai[0].on = false;
    ai[1].on = true;
    ai[1].lvl = s.lvl;
    ai[1].plunge = s.plunge || 0;
    b.special = s.special;
    b.special2 = s.special2 || null;     // (the campaign is a two-special game: a boss without a second ability just has none)
    b.dual = !!s.special2;
    b.dashN = s.dashes || 1;
    b.dashCut = [0, 0];
    b.dashMin = 0.5;                     // (stage 3: Speed of Light sets this to 0)
    b.explodeCd = s.explodeCd || 0;      // stage 4: her blast comes back much sooner, so she can chain them
    campaign.timeT = s.time || null;     // the stage clock
    setNetGap(s.gap);
    campaignSwarmClear();
    campaign.swarmT = s.swarm ? s.swarm.first : 0;
    campaignMapSet(s);
    b.arrowN = s.arrows || 1;            // arrows per shot (a spread)
    b.arrowSend = s.arrowSend || 0;      // an arrow that hits any ball sends it at the other player at this speed (u/s)
    ai[1].combo = s.combo || null;       // a combined AI plan for her two specials (see aiSpDecoyArrow)
    ai[1].drive = s.drive || 0;          // how much the AI likes flat, fast shots at the top half of the goal
    ai[1].plinkoBoost = !!s.plinkoBoost;  // stage 2: her second peg goes up by the net, where her shots can bounce off it
    ai[1].sweep = s.sweep || 0;          // how much it likes shots that skim the floor into the bottom half of the goal
}
function campaignStart() {
    if (campaign.on)
        return;
    campaign.saved = { swapOn, pickFixed, twoSpecials, teamSize, ai0: ai[0].on, ai1: ai[1].on, sp: allPlayers.map(p => [p.special, p.special2]) };
    swapOn = false;                            // one fixed side per stage
    pickFixed = false;                         // the boss' ability is set by the stage, not by a pick screen
    twoSpecials = true;                        // always two slots (you have the second one from stage 2 on)
    campaignLoadoutReset();
    if (teamSize !== 1) {
        layoutTeams(1);
        teamSize = 1;
    }
    Object.assign(campaign, { on: true, stage: 0, continues: 0, won: null, clear: false, pts: 0, pops: [], clock: 0, newHi: false });
    campaignApply();
    resetMatch();
    campaignBegin();
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
    campaign.bannerT = 0;
    campaign.draft.on = false;
    allPlayers.forEach((p, i) => { // the menu's two-special mode needs a second special: back to what they had, or a sensible one
        const was = s && s.sp && s.sp[i];
        p.special = was && was[0] ? was[0] : p.special;
        p.special2 = was && was[1] ? was[1] : p.special2 && p.special2 !== p.special ? p.special2 : (p.special === 'plinko' ? 'dash' : 'plinko');
    });
    if (s) { // (the setters that end a campaign set their own option right after this, so putting these back first is always safe)
        swapOn = s.swapOn;
        pickFixed = s.pickFixed;
        twoSpecials = s.twoSpecials;
    }
    if (restore && s) {
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
function campaignOverText(t, kind = 'win') {
    campaign.won = t;
    if (t === 0) { // the stage bonuses
        campaignAward(kind === 'time' ? CAMPAIGN_POINTS.timeout : CAMPAIGN_POINTS.win, kind === 'time' ? 'TIME BONUS' : 'STAGE CLEAR');
        if (score[1] === 0)
            campaignAward(CAMPAIGN_POINTS.perfect, 'PERFECT');
    }
    campaign.clear = t === 0 && campaign.practice == null && campaign.stage >= campaignStages().length - 1;
    if (campaign.practice != null)
        return t === 0 ? ' - stage clear!' : ' - you lose! try it again';
    return t === 0 ? (campaign.clear ? ' - CAMPAIGN CLEAR!' : ' - stage clear!') : ' - you lose! back to stage 1';
}
// The WIN_PAUSE after a stage ended is over: on to the next stage, or (a loss) back to the very first one, or back to normal play after the last. Runs before the new round is set up.
function campaignAfterOver() {
    if (campaign.practice != null) { // practising one stage: a win goes back to the campaign screen, a loss tries the same stage again (same loadout)
        if (campaign.won === 0) {
            campaignFinish('STAGE ' + (campaign.stage + 1) + ' CLEARED');
            return;
        }
        campaign.continues++;
        campaignApply();
        campaign.bannerT = CAMPAIGN_BANNER_T;
        return;
    }
    if (campaign.won === 0) {
        if (campaign.clear) {
            campaignFinish('CAMPAIGN CLEAR!');   // (campaignStop inside runs resetMatch itself; rules.js then builds one more round, which is harmless)
            return;
        }
        campaign.stage++;
    } else {
        campaignRecordHi();
        campaign.pts = 0;
        campaign.stage = 0;                    // one long run: a lost stage means starting over
        campaign.continues++;
        campaignLoadoutReset();                // ... and the loadout is drafted again
    }
    campaignApply();
    campaignBegin();
}
// ---- every point (either way), called from rules.js point() before the next round starts ----
function campaignOnPoint(t, why) {
    const s = campaignStage(), b = allPlayers[1], me = allPlayers[0];
    if (t === me.team)
        campaignAward(why === 'scores!' ? CAMPAIGN_POINTS.goal : CAMPAIGN_POINTS.kill, why === 'scores!' ? 'GOAL' : 'KILL');
    if (s.gimmick === 'dashCut' && b.dashMin !== 0) { // one of her two dashes, at random, comes back 1 s sooner for good (and the one that is cooling down right now is helped too)
        const i = Math.random() < 0.5 ? 0 : 1, id = i ? 'dash2' : 'dash';
        b.dashCut[i] = Math.min(b.dashCut[i] + CAMPAIGN_DASH_CUT, DASH_COOLDOWN - 0.5); // (never below 0.5 s)
        b.cd[id] = Math.max(0, b.cd[id] - CAMPAIGN_DASH_CUT);
    }
    if (s.speedAt && score[me.team] >= s.speedAt && b.dashMin !== 0) { // SPEED OF LIGHT: both dashes have no cooldown any more
        b.dashMin = 0;
        b.dashCut = [DASH_COOLDOWN, DASH_COOLDOWN];
        b.cd.dash = 0;
        b.cd.dash2 = 0;
        campaignPop('SPEED OF LIGHT', W / 2, 150, true);
    }
}
// ---- the score: ----
const CAMPAIGN_POINTS = { graze: 100, kill: 300, goal: 500, timeout: 100, win: 300, perfect: 500 };
const CAMPAIGN_GRAZE_PAD = 26;         // u beyond touching that still counts as a graze
const CAMPAIGN_GRAZE_GAP = 1.5;        // s before the same object can be grazed again
const campaignFmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function campaignPop(txt, x, y, big = false) {
    campaign.pops.push({ txt, x, y, t: 0, big });
}
function campaignAward(n, label) {
    const me = allPlayers[0];
    campaign.pts += n;
    campaignPop('+' + n + ' ' + label, me.x, me.y - 30);
}
// Anything that can kill you passing close without touching you: the death ball, the boss' decoys, her arrows. Each object pays once per CAMPAIGN_GRAZE_GAP.
function campaignGrazeTick() {
    const me = allPlayers[0], T = campaign.clock;
    if (!me.alive || me.invT > 0)
        return;
    const near = (b, rr) => { const d = Math.hypot(b.x - me.x, b.y - me.y), lim = me.r + rr; return d > lim && d < lim + CAMPAIGN_GRAZE_PAD; };
    for (const b of [ball, ...decoys])
        if (b !== me.tball && (b === ball || b.team !== me.team) && Math.hypot(b.vx, b.vy) >= 250 && near(b, b.r) && !(b.gz > T - CAMPAIGN_GRAZE_GAP)) {
            b.gz = T;
            campaignAward(CAMPAIGN_POINTS.graze, 'GRAZE');
        }
    for (const a of projectiles)
        if (a.type === 'arrow' && !a.stuck && a.team !== me.team && near(a, ARROW_R) && !(a.gz > T - CAMPAIGN_GRAZE_GAP)) {
            a.gz = T;
            campaignAward(CAMPAIGN_POINTS.graze, 'GRAZE');
        }
}
// Every live tick of a campaign stage: the clock, grazes, the floating score texts.
function campaignClockTick() {
    campaign.clock += DT;
    if (over)
        return;
    if (campaign.timeT !== null) {
        campaign.timeT -= DT;
        if (campaign.timeT <= 0)
            campaignTimeUp();
    }
    campaignGrazeTick();
    for (const p of campaign.pops)
        p.t += DT;
    campaign.pops = campaign.pops.filter(p => p.t < 1.4);
}
function campaignTimeUp() { // the clock ran out: whoever is AHEAD wins (a tie goes to the boss)
    campaign.timeT = 0;
    const t = score[0] > score[1] ? 0 : 1;
    over = true;
    msg = (t === 0 ? 'Blue' : 'Red') + ' - time is up!' + campaignOverText(t, 'time');
    pause = WIN_PAUSE;
}
// ---- the high score (one per campaign, in the browser) ----
const CAMPAIGN_HI_KEY = 'wdb-campaign-hi';
function campaignHi(id) { try { return (JSON.parse(localStorage.getItem(CAMPAIGN_HI_KEY)) || {})[id] | 0; } catch (e) { return 0; } }
function campaignRecordHi() { // a full run's score (never practice), when the run ends: cleared, or lost and starting over
    campaign.newHi = false;
    if (campaign.practice != null || campaign.pts <= 0)
        return;
    const id = (campaign.def || CAMPAIGN_LIST[0]).id;
    if (campaign.pts > campaignHi(id)) {
        campaign.newHi = true;
        try { const o = JSON.parse(localStorage.getItem(CAMPAIGN_HI_KEY)) || {}; o[id] = campaign.pts; localStorage.setItem(CAMPAIGN_HI_KEY, JSON.stringify(o)); } catch (e) {}
    }
}
// Where the ball appears: the top of the net, falling straight down the net line.
function campaignSpawnBall() {
    ball.x = NETX;
    ball.y = Math.max(ball.r + 6, Math.min(NET_GAP, 3 * PL) - ball.r);
    ball.vx = 0; // straight down the net line: nothing is carried over from the last ball
    ball.vy = 0;
    ball.w = 0;
}
// ---- SKIN, MAP, SWARM (per-stage looks and gimmicks) ----
const campaignSkin = () => { const s = campaignStage(); return s._skin || (s._skin = typeof skinClean === 'function' ? skinClean(s.skin) : (s.skin || [])); }; // (cleaned once: the sprite cache keys on the array)
// Map changes: a stage names one with `map: 'id'`; CAMPAIGN_MAPS.id = { on() { ... }, off() { ... } } is run when the stage starts / is left. (Empty for now.)
const CAMPAIGN_MAPS = {};
function campaignMapSet(s) {
    if (campaign.mapId && CAMPAIGN_MAPS[campaign.mapId])
        CAMPAIGN_MAPS[campaign.mapId].off();
    campaign.mapId = null;
    if (s && s.map && CAMPAIGN_MAPS[s.map]) {
        CAMPAIGN_MAPS[s.map].on();
        campaign.mapId = s.map;
    }
}
function campaignSwarmClear() {
    for (const d of decoys.filter(d => d.swarm))
        removeDecoy(d);
}
// A boss with a `swarm` spawns another death ball on her half every `every` seconds (up to `max`, each gone after `life` seconds). Her marionette shoves all of them (player-casts.js).
function campaignSwarmTick() {
    const sw = campaignStage().swarm, b = allPlayers[1];
    if (!sw)
        return;
    const mine = decoys.filter(d => d.swarm);
    for (const d of mine) {
        d.age = (d.age || 0) + DT;
        if (d.age > sw.life)
            removeDecoy(d);
    }
    campaign.swarmT -= DT;
    if (campaign.swarmT <= 0) {
        campaign.swarmT = sw.every;
        if (b.alive && decoys.filter(d => d.swarm).length < sw.max)
            spawnSwarmBall(b, NETX - aiSide(b) * (120 + Math.random() * 260));
    }
}
function campaignInvTick() {
    for (const p of players)
        if (p.invT > 0)
            p.invT = Math.max(0, p.invT - DT);
}
// A point that does not end the stage: no pause, no new round. The ball respawns, whoever was killed comes back at their spawn, everything else carries on.
function campaignRespawn() {
    for (const p of players) {
        if (p.tball === ball) { // let go of the old ball (it is about to be moved; someone holding a decoy keeps holding it)
            p.onBall = false;
            p.tball = null;
            p.rope = null;
            p.pending = null;
        }
        if (!p.alive) {
            p.reset();
            p.invT = CAMPAIGN_INV_T;
        }
    }
    // (decoys, arrows, pegs, mines and the rest all carry over: the stage plays as one continuous round)
    ball.reset();
    campaignSpawnBall();
    ai.forEach((a, i) => aiReset(i));          // forget plans made for the old ball
    events.onNewRound();
}

// ---- THE CAMPAIGN HOME SCREEN ----
// Its own screen between the base game and a campaign (render/campaign-fx.js draws it; the world holds still behind it, see rules.js update()). Seat 0's keys drive it: up / down move, GRAPPLE selects,
// WEIGHT goes back (from the first screen: back to the base game). views: 'list' (the campaigns + BACK TO BASE GAME), 'mode' (one campaign: PLAY THE FULL RUN / STAGE SELECT), 'stages'.
const CAMPAIGN_CLEARS_KEY = 'wdb-campaign-clears';
function campaignClears(id) { try { return (JSON.parse(localStorage.getItem(CAMPAIGN_CLEARS_KEY)) || {})[id] | 0; } catch (e) { return 0; } }
function campaignAddClear(id) { try { const o = JSON.parse(localStorage.getItem(CAMPAIGN_CLEARS_KEY)) || {}; o[id] = (o[id] | 0) + 1; localStorage.setItem(CAMPAIGN_CLEARS_KEY, JSON.stringify(o)); } catch (e) {} }
const campaignHome = { on: false, view: 'list', cur: 0, def: null, t: 0, prev: 0, note: '' };
function campaignHomeOpen(note = '') {
    Object.assign(campaignHome, { on: true, view: 'list', cur: 0, def: null, t: 0, prev: keyBits(allPlayers[0].keys), note }); // (a key already held is not a press)
}
function campaignHomeClose() {
    campaignHome.on = false;
}
// The rows of the current view: { label, sub, go() }.
function campaignHomeRows() {
    const h = campaignHome, rows = [];
    if (h.view === 'list') {
        for (const def of CAMPAIGN_LIST)
            rows.push({ label: def.name, sub: def.stages.length + ' STAGES  ·  ' + (campaignClears(def.id) ? 'CLEARED ' + campaignClears(def.id) + 'x' : 'NOT CLEARED YET') + '  ·  HIGH SCORE ' + campaignFmt(campaignHi(def.id)), go() { h.def = def; h.view = 'mode'; h.cur = 0; } });
        rows.push({ label: 'BACK TO BASE GAME', sub: '', go() { campaignHomeClose(); } });
    } else if (h.view === 'mode') {
        rows.push({ label: 'PLAY THE FULL RUN', sub: 'Stage 1 to ' + h.def.stages.length + ', picking your two specials on the way', go() { campaignRun(h.def, null); } });
        rows.push({ label: 'STAGE SELECT', sub: 'Practise one stage on its own', go() { h.view = 'stages'; h.cur = 0; } });
        rows.push({ label: 'BACK', sub: '', go() { h.view = 'list'; h.cur = 0; } });
    } else {
        h.def.stages.forEach((s, i) => rows.push({ label: 'STAGE ' + (i + 1) + '  ·  ' + s.boss.toUpperCase(), sub: 'FIRST TO ' + s.goal + '  ·  ' + (typeof campaignNetText === 'function' ? campaignNetText(s) : ''), go() { campaignRun(h.def, i); } }));
        rows.push({ label: 'BACK', sub: '', go() { h.view = 'mode'; h.cur = 1; } });
    }
    return rows;
}
function campaignHomeBack() {
    const h = campaignHome;
    if (h.view === 'stages') { h.view = 'mode'; h.cur = 1; }
    else if (h.view === 'mode') { h.view = 'list'; h.cur = 0; }
    else campaignHomeClose();
}
function campaignHomeStep() { // one tick while the home screen is up
    const h = campaignHome, bits = keyBits(allPlayers[0].keys), fresh = bits & ~h.prev;
    h.prev = bits;
    h.t += DT;
    if (h.t < 0.25)
        return;
    const rows = campaignHomeRows();
    if (fresh & 4) h.cur = (h.cur + rows.length - 1) % rows.length;
    if (fresh & 8) h.cur = (h.cur + 1) % rows.length;
    if (fresh & 32) campaignHomeBack();
    else if (fresh & 16) rows[Math.min(h.cur, rows.length - 1)].go();
}
// Start a run of def: practice = null for the whole run, or the 0-based stage to practise (the drafts before it come first).
function campaignRun(def, practice) {
    campaignHomeClose();
    if (campaign.on)
        campaignStop(true);
    campaign.def = def;
    campaign.practice = practice;
    campaignStart();
}
// The run is over (cleared, or the practice stage was): back to the base game's settings, then straight on to the campaign screen.
function campaignFinish(note) {
    const id = (campaign.def || CAMPAIGN_LIST[0]).id, full = campaign.practice == null;
    if (full)
        campaignRecordHi();
    const text = full ? note + '  ·  SCORE ' + campaignFmt(campaign.pts) + (campaign.newHi ? '  ·  NEW HIGH SCORE!' : '') : note;
    campaignStop(true);
    if (full)
        campaignAddClear(id);
    campaign.practice = null;
    campaignHomeOpen(text);
}
// Practising stage N: the loadout drafts of the stages before it (and its own) happen first, one after another. Returns true when it moved on (to the next draft, or to the stage itself).
function campaignPracticeNext() {
    if (campaign.practice == null || campaign.stage >= campaign.practice)
        return false;
    const next = CAMPAIGN_DRAFT_AT.find(i => i > campaign.stage && i <= campaign.practice);
    campaign.stage = next === undefined ? campaign.practice : next;
    campaignApply();
    resetMatch();
    if (next === undefined)
        campaign.bannerT = CAMPAIGN_BANNER_T;
    else
        campaignBegin();
    return true;
}
// ---- THE LOADOUT DRAFT ----
// Your specials start empty each run: special = your first (key 1), special2 = your second (null until stage 2's draft).
function campaignLoadoutReset() {
    const p = allPlayers[0];
    p.special = p.special && p.special !== 'fighter' ? p.special : 'dash'; // (a placeholder until the first draft; the first slot always has something)
    p.special2 = null;
    allPlayers.forEach(q => { if (q.special === 'fighter' || q.special2 === 'fighter') { q.special = 'dash'; q.special2 = null; } });
}
// What each draft offers (index = the slot: 0 = the first special, 1 = the second). Three ids each; change them here.
const CAMPAIGN_OFFERS = [['dash', 'plinko', 'arrow'], ['bat', 'warp', 'decoy']];
function campaignOffer(slot) {
    const have = [allPlayers[0].special, allPlayers[0].special2].filter(Boolean);
    return CAMPAIGN_OFFERS[slot].filter(id => slot === 0 || !have.includes(id)); // (never one you already have; the lists above do not overlap)
}
// A stage is about to start: the draft first when this stage has one, then the stage banner.
function campaignBegin() {
    const d = campaign.draft, slot = CAMPAIGN_DRAFT_AT.indexOf(campaign.stage);
    campaign.bannerT = 0;
    if (slot < 0) {
        campaign.bannerT = CAMPAIGN_BANNER_T;
        return;
    }
    Object.assign(d, { on: true, slot, offer: campaignOffer(slot), cur: 1, t: 0, lock: 0, chosen: -1, prev: keyBits(allPlayers[0].keys) }); // (a key already held is not a press)
    if (slot === 1)
        allPlayers[0].special2 = null;
}
function campaignDraftPick(i) { // take card i
    const d = campaign.draft, p = allPlayers[0];
    d.chosen = i;
    d.lock = CAMPAIGN_LOCK_T;
    if (d.slot === 0)
        p.special = d.offer[i];
    else
        p.special2 = d.offer[i];
}
// One tick while a draft or a banner is up: the world holds still. Returns true while it does (rules.js update()).
function campaignHold() {
    const d = campaign.draft;
    if (d.on) {
        const p = allPlayers[0], bits = keyBits(p.keys), fresh = bits & ~d.prev;
        d.prev = bits;
        d.t += DT;
        if (d.lock > 0) {
            d.lock -= DT;
            if (d.lock <= 0) {
                d.on = false;
                for (const q of players) { // keys still held from the screen must not start a cast on the first tick
                    q.prevSp = q.keys.sp;
                    q.prevSp2 = q.keys.sp2;
                    q.prevX = q.keys.x;
                }
                if (!campaignPracticeNext())
                    campaign.bannerT = CAMPAIGN_BANNER_T;
            }
        } else if (d.t > 0.35) { // (the cards are still dealing in)
            if (fresh & 1)
                d.cur = (d.cur + 2) % 3;
            if (fresh & 2)
                d.cur = (d.cur + 1) % 3;
            if (fresh & (16 | 64 | 128)) // grapple or either special key
                campaignDraftPick(d.cur);
        }
        return true;
    }
    if (campaign.bannerT > 0) {
        campaign.bannerT = Math.max(0, campaign.bannerT - DT);
        return true;
    }
    return false;
}
