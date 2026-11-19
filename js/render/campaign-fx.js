// RENDER - the campaign's loadout draft (3 specials to choose from, before stage 1 and again before stage 3) and the banner that opens every stage. Display only.
// Everything comes from `campaign` (game/campaign.js): the draft's own sim timers (draft.t, draft.lock) and bannerT drive the animation, never the wall clock, so it is the same frame
// everywhere. (Only the little pulse on the highlighted card uses performance.now, like the pick screen's badges.) Needs drawBanner / PICK_DESC from pick-screen.js and iconGlyph.
function campaignNetText(s) { // a short line for the net of a stage
    if (s.gap >= H)
        return 'NO NET';
    return s.gap === NET_GAP_CLASSIC ? 'CLASSIC NET' : 'NET GAP ' + String(+(s.gap / PL).toFixed(1)) + ' PL';
}
function drawStageBanner() { // "STAGE n" on the torn-paper strip (the same banner as GET READY / SIDE CHANGE), the boss' name and the rules of the stage under it
    const s = campaignStage(), prog = 1 - campaign.bannerT / CAMPAIGN_BANNER_T, tm = performance.now();
    cx.save();
    drawBanner('STAGE ' + (campaign.stage + 1), prog, tm);
    const u = fxClamp((prog - 0.2) / 0.18), v = fxClamp((prog - 0.3) / 0.18), out = fxClamp((1 - prog) / 0.08); // the lines fade up one after another, and out at the very end
    cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.lineJoin = 'round';
    const line = (txt, y, size, col, a) => {
        cx.globalAlpha = a * out;
        cx.font = 'italic 800 ' + size + 'px system-ui, sans-serif';
        cx.lineWidth = 6; cx.strokeStyle = '#0b0610'; cx.strokeText(txt, W / 2, y);
        cx.fillStyle = col; cx.fillText(txt, W / 2, y);
    };
    line(s.boss.toUpperCase(), H / 2 + 138 + (1 - fxOutCubic(u)) * 16, 36, '#ffffff', u);
    line('FIRST TO ' + s.goal + '  ·  ' + campaignNetText(s), H / 2 + 178 + (1 - fxOutCubic(v)) * 16, 20, FX_GOLD, v);
    if (campaign.continues > 0 && campaign.stage === 0)
        line('ATTEMPT ' + (campaign.continues + 1), H / 2 - 150, 18, '#98a2ad', v);
    cx.restore();
}
function drawDraft() {
    const d = campaign.draft, tm = performance.now(), CW_ = 210, CH_ = 290, GAP_ = 26, x0 = W / 2 - (3 * CW_ + 2 * GAP_) / 2, y0 = 150, p = allPlayers[0];
    cx.save();
    cx.fillStyle = 'rgba(9,5,18,.93)'; // backdrop over the playing area, like the pick screen
    cx.fillRect(0, 0, W, H);
    const wash = cx.createLinearGradient(0, 0, W, 0);
    wash.addColorStop(0, 'rgba(' + sideRgb(0) + ',.22)'); wash.addColorStop(0.4, 'rgba(' + sideRgb(0) + ',0)');
    wash.addColorStop(0.6, 'rgba(' + sideRgb(1) + ',0)'); wash.addColorStop(1, 'rgba(' + sideRgb(1) + ',.22)');
    cx.fillStyle = wash;
    cx.fillRect(0, 0, W, H);
    cx.textAlign = 'center';
    const title = d.slot === 0 ? 'CHOOSE YOUR SPECIAL' : 'CHOOSE YOUR SECOND SPECIAL';
    cx.font = 'italic 800 30px system-ui, sans-serif'; cx.lineWidth = 5; cx.strokeStyle = '#000'; cx.lineJoin = 'round';
    cx.globalAlpha = fxClamp(d.t / 0.25);
    cx.strokeText(title, W / 2, 70); cx.fillStyle = '#fff'; cx.fillText(title, W / 2, 70);
    cx.font = 'bold 12px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
    cx.fillText('BEFORE STAGE ' + (campaign.stage + 1) + (campaign.continues ? '   ·   ATTEMPT ' + (campaign.continues + 1) : ''), W / 2, 96);
    cx.globalAlpha = 1;
    if (d.slot === 1) { // the special you already have, small, in the corner
        const sp = pickSp(p.special);
        cx.save(); cx.translate(70, 70); cx.scale(2.2, 2.2); iconGlyph(sp.icon, 0, 0, '#98a2ad'); cx.restore();
        cx.font = 'bold 10px system-ui, sans-serif'; cx.fillStyle = '#98a2ad'; cx.fillText('YOUR FIRST: ' + sp.name, 70, 110);
    }
    d.offer.forEach((id, i) => {
        const sp = pickSp(id), u = fxOutBack((d.t - 0.08 * i) / 0.4), sel = d.cur === i, chosen = d.chosen === i, dim = d.chosen >= 0 && !chosen;
        if (u <= 0)
            return;
        const lift = (sel ? -10 : 0) + (1 - fxClamp(u)) * 60, pulse = sel && d.lock <= 0 ? 1 + 0.015 * Math.sin(tm / 120) : 1, x = x0 + i * (CW_ + GAP_), y = y0 + lift;
        cx.save();
        cx.globalAlpha = fxClamp(u) * (dim ? 0.25 : 1);
        cx.translate(x + CW_ / 2, y + CH_ / 2); cx.scale(pulse * (chosen ? 1.05 : 1), pulse * (chosen ? 1.05 : 1)); cx.translate(-CW_ / 2, -CH_ / 2);
        cx.fillStyle = sel ? '#2a1850' : '#1a0e30'; cx.strokeStyle = chosen ? FX_GOLD : sel ? p.color : '#4b2f7a'; cx.lineWidth = sel ? 4 : 2;
        cx.beginPath(); cx.roundRect(0, 0, CW_, CH_, 14); cx.fill(); cx.stroke();
        cx.save(); cx.translate(CW_ / 2, 92); cx.scale(4.6, 4.6); iconGlyph(sp.icon, 0, 0, '#e8e8e4'); cx.restore();
        cx.textAlign = 'center';
        cx.font = 'bold 20px system-ui, sans-serif'; cx.fillStyle = '#fff'; cx.fillText(sp.name, CW_ / 2, 178);
        cx.font = '12px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
        (PICK_DESC[sp.id] || []).forEach((l, k) => cx.fillText(l, CW_ / 2, 206 + k * 16));
        if (chosen) {
            cx.font = 'italic 800 16px system-ui, sans-serif'; cx.fillStyle = FX_GOLD;
            cx.fillText('LOCKED IN', CW_ / 2, CH_ - 16);
        }
        cx.restore();
    });
    cx.textAlign = 'center'; cx.font = 'bold 11px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
    if (d.chosen < 0)
        cx.fillText('LEFT / RIGHT: MOVE     GRAPPLE OR SPECIAL: CHOOSE', W / 2, y0 + CH_ + 40);
    cx.restore();
}
// The campaign home screen: a list of rows (campaignHomeRows) on a card each, the selected one lit.
function drawCampaignHome() {
    const h = campaignHome, rows = campaignHomeRows(), tm = performance.now(), p = allPlayers[0], RW = 640, RH = 54, GAP = 8, vis = 7;
    const first = Math.max(0, Math.min(rows.length - vis, h.cur - 3)), shown = rows.slice(first, first + vis), y0 = 150;
    cx.save();
    cx.fillStyle = 'rgba(9,5,18,.96)';
    cx.fillRect(0, 0, W, H);
    const wash = cx.createLinearGradient(0, 0, W, 0);
    wash.addColorStop(0, 'rgba(' + sideRgb(0) + ',.22)'); wash.addColorStop(0.4, 'rgba(' + sideRgb(0) + ',0)');
    wash.addColorStop(0.6, 'rgba(' + sideRgb(1) + ',0)'); wash.addColorStop(1, 'rgba(' + sideRgb(1) + ',.22)');
    cx.fillStyle = wash;
    cx.fillRect(0, 0, W, H);
    cx.textAlign = 'center'; cx.lineJoin = 'round';
    const title = h.view === 'list' ? 'CAMPAIGN' : h.view === 'mode' ? h.def.name : 'STAGE SELECT', a = fxClamp(h.t / 0.25);
    cx.globalAlpha = a;
    cx.font = 'italic 800 40px system-ui, sans-serif'; cx.lineWidth = 6; cx.strokeStyle = '#000';
    cx.strokeText(title, W / 2, 80); cx.fillStyle = '#fff'; cx.fillText(title, W / 2, 80);
    if (h.note) {
        cx.font = 'italic 800 20px system-ui, sans-serif'; cx.fillStyle = FX_GOLD;
        cx.fillText(h.note, W / 2, 118);
    } else if (h.view !== 'list') {
        cx.font = 'bold 12px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
        cx.fillText(h.view === 'stages' ? h.def.name : h.def.blurb.toUpperCase(), W / 2, 118);
    }
    cx.globalAlpha = 1;
    shown.forEach((r, j) => {
        const i = first + j, sel = h.cur === i, u = fxOutBack((h.t - 0.05 * j) / 0.35), x = W / 2 - RW / 2, y = y0 + j * (RH + GAP) + (1 - fxClamp(u)) * 40;
        if (u <= 0)
            return;
        cx.save();
        cx.globalAlpha = fxClamp(u);
        cx.translate(W / 2, y + RH / 2); const sc = sel ? 1 + 0.012 * Math.sin(tm / 130) : 1; cx.scale(sc, sc); cx.translate(-W / 2, -(y + RH / 2));
        cx.fillStyle = sel ? '#2a1850' : '#1a0e30'; cx.strokeStyle = sel ? p.color : '#4b2f7a'; cx.lineWidth = sel ? 4 : 2;
        cx.beginPath(); cx.roundRect(x, y, RW, RH, 12); cx.fill(); cx.stroke();
        cx.textAlign = 'left';
        cx.font = 'bold 20px system-ui, sans-serif'; cx.fillStyle = sel ? '#fff' : '#d8d2e8';
        cx.fillText(r.label, x + 22, y + (r.sub ? 24 : 34));
        if (r.sub) {
            cx.font = '12px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
            cx.fillText(r.sub.length > 84 ? r.sub.slice(0, 83) + '…' : r.sub, x + 22, y + 43);
        }
        if (sel) {
            cx.textAlign = 'right'; cx.font = 'bold 22px system-ui, sans-serif'; cx.fillStyle = p.color;
            cx.fillText('\u25B6', x + RW - 20, y + 34);
        }
        cx.restore();
    });
    cx.textAlign = 'center'; cx.font = 'bold 11px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
    cx.fillText('UP / DOWN: MOVE     GRAPPLE: SELECT     WEIGHT: ' + (h.view === 'list' ? 'BACK TO BASE GAME' : 'BACK'), W / 2, H - 22);
    cx.restore();
}
// The stage clock and the run's score under the plaque, and the floating "+100 GRAZE" texts.
function drawCampaignHud() {
    const mid = W / 2, y = HUD_TOP + 50 + 16, t = campaign.timeT;
    cx.save();
    cx.textAlign = 'center'; cx.lineJoin = 'round';
    cx.font = 'bold 13px system-ui, sans-serif'; cx.lineWidth = 4; cx.strokeStyle = '#000';
    const left = t === null ? '' : Math.floor(Math.ceil(t) / 60) + ':' + String(Math.ceil(t) % 60).padStart(2, '0');
    const txt = (left ? left + '    ' : '') + 'SCORE ' + campaignFmt(campaign.pts);
    cx.strokeText(txt, mid, y);
    cx.fillStyle = t !== null && t < 10 && Math.floor(performance.now() / 250) % 2 ? '#ff5252' : '#e8e8e4';
    cx.fillText(txt, mid, y);
    let row = 0; // the awards stack as a list above the plaque, stacking upward from just above the plaque; each fades out on its own
    for (const p of campaign.pops) {
        const a = 1 - Math.max(0, p.t - 1.6) / 0.6, yy = y - 80 - (p.big ? 0 : row++ * 18);
        cx.globalAlpha = Math.max(0, Math.min(1, a));
        if (p.big) {
            cx.font = 'italic 800 30px system-ui, sans-serif'; cx.lineWidth = 6;
            cx.strokeText(p.txt, p.x, p.y - p.t * 26);
            cx.fillStyle = FX_GOLD;
            cx.fillText(p.txt, p.x, p.y - p.t * 26);
            continue;
        }
        cx.font = 'bold 14px system-ui, sans-serif'; cx.lineWidth = 4;
        cx.strokeText(p.txt, mid, yy);
        cx.fillStyle = '#fff';
        cx.fillText(p.txt, mid, yy);
    }
    cx.restore();
}
function drawCampaignFx() { // after the arena, over the playing area (render.js)
    if (campaignHome.on) {
        drawCampaignHome();
        return;
    }
    if (!campaign.on)
        return;
    drawCampaignHud();
    if (campaign.draft.on)
        drawDraft();
    else if (campaign.bannerT > 0)
        drawStageBanner();
}
