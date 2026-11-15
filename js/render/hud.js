// RENDER - the score display, drawn on the floor of the arena (the empty slab under the playing surface) so it never covers anything the players need to see.
// Coordinates are ARENA coordinates (drawn inside render.js's translate), so the slab sits at y = H + something and spans x = 0..W between the goal ramps.
// The bars are progress toward WIN points (they fill from the outer edge toward the middle). Under them, online, the connection status line.
const hud = { shown: [0, 0], flash: [0, 0], line: [0, 0] }; // shown = smoothed fill (0..1); flash = brief glow after a point; line = threshold-line glow (read by arena.js)
const HUD_TOP = H + 14; // top of the score plaque; the floor can only pop up (never down), so this stays clear of it
const HUD_BAR_W = 360, HUD_BAR_H = 30, HUD_BAR_X = 30; // bar size and its distance from the arena's side wall
function barPath(x, y, w, h, side, sk) { // slanted inner end, like the health bars in a fighting game
    cx.beginPath();
    if (side === 0) { cx.moveTo(x, y); cx.lineTo(x + w, y); cx.lineTo(x + w - sk, y + h); cx.lineTo(x, y + h); }
    else { cx.moveTo(x, y); cx.lineTo(x + w, y); cx.lineTo(x + w, y + h); cx.lineTo(x + sk, y + h); }
    cx.closePath();
}
function drawBar(side, color, frac, flash) {
    const bw = HUD_BAR_W, bh = HUD_BAR_H, by = HUD_TOP + 25 - bh / 2, sk = 14, bx = side === 0 ? HUD_BAR_X : W - HUD_BAR_X - bw;
    cx.save();
    barPath(bx, by, bw, bh, side, sk);
    cx.fillStyle = '#0b0e12'; // empty track
    cx.fill();
    cx.globalAlpha = 0.14;
    cx.fillStyle = color;
    cx.fill();
    cx.globalAlpha = 1;
    cx.save();
    cx.clip();
    const fw = bw * frac, fx = side === 0 ? bx : bx + bw - fw;
    if (fw > 0) {
        const g = cx.createLinearGradient(0, by, 0, by + bh);
        g.addColorStop(0, '#fff'); g.addColorStop(0.18, color); g.addColorStop(1, color);
        cx.fillStyle = g;
        cx.fillRect(fx, by, fw, bh);
        cx.fillStyle = 'rgba(255,255,255,' + (0.5 * flash) + ')'; // point-scored flash
        cx.fillRect(fx, by, fw, bh);
        const ex = side === 0 ? fx + fw : fx; // glowing leading edge
        cx.shadowColor = color; cx.shadowBlur = 12;
        cx.fillStyle = '#fff';
        cx.fillRect(ex - 1.5, by, 3, bh);
        cx.shadowBlur = 0;
    }
    cx.fillStyle = 'rgba(255,255,255,.12)'; // gloss
    cx.fillRect(bx, by, bw, bh / 2);
    cx.strokeStyle = 'rgba(0,0,0,.6)'; // one notch per point
    cx.lineWidth = 2;
    cx.beginPath();
    const goal = hud.goal || WIN; // (set per bar in drawHud: the campaign has a different target for you and for the boss)
    for (let i = 1; i < goal; i++) line(bx + bw * i / goal, by, bx + bw * i / goal, by + bh);
    cx.stroke();
    // >>> extra bar effects (sparks, shimmer, particles...) can be drawn here: they are clipped to the bar, with fw/fx/frac available <<<
    cx.restore();
    barPath(bx, by, bw, bh, side, sk);
    cx.strokeStyle = '#d5dbe1'; cx.lineWidth = 3;
    cx.stroke();
    cx.restore();
}
function drawNetStatus() { // online: room, seat, ping and so on (net.status is kept up to date by net/client.js), wrapped to at most 3 lines under the score
    const text = typeof net !== 'undefined' ? net.status : '';
    if (!text)
        return;
    const maxW = W - 60, lines = [];
    cx.save();
    cx.font = '12px system-ui, sans-serif';
    cx.textAlign = 'center';
    cx.fillStyle = 'rgba(232,232,228,.8)';
    let cur = '';
    for (const word of text.split(' ')) {
        const t = cur ? cur + ' ' + word : word;
        if (cur && cx.measureText(t).width > maxW) {
            lines.push(cur);
            cur = word;
        } else
            cur = t;
    }
    lines.push(cur);
    lines.slice(0, 2).forEach((l, i) => cx.fillText(l, W / 2, HUD_TOP + 70 + i * 16));
    cx.restore();
}
function drawHud() {
    for (const t of [0, 1]) { // fade bookkeeping: keep this running every frame, the arena reads hud.line and padFlash
        hud.shown[t] += (Math.min(1, score[t] / goalOf(t)) - hud.shown[t]) * 0.08;
        hud.flash[t] *= 0.94;
        padFlash[t] *= 0.9; // physics sets it on a hatchet hit; we fade it
        hud.line[t] *= 0.96;
    }
    hud.goal = goalOf(0);
    drawBar(sideSwap(0), '#42a5f5', hud.shown[0], hud.flash[0]);
    hud.goal = goalOf(1);
    drawBar(sideSwap(1), '#ef5350', hud.shown[1], hud.flash[1]);
    hud.goal = 0;
    const cw = 128, ch = 50, x = W / 2 - cw / 2, y = HUD_TOP, mid = W / 2; // center plaque
    cx.fillStyle = '#0b0e12'; cx.strokeStyle = '#d5dbe1'; cx.lineWidth = 3;
    cx.beginPath(); cx.roundRect(x, y, cw, ch, 6); cx.fill(); cx.stroke();
    cx.textAlign = 'center';
    cx.font = 'bold 10px system-ui, sans-serif';
    cx.fillStyle = '#98a2ad';
    cx.fillText(isSandbox() ? 'SANDBOX' : campaignOn() ? `STAGE ${campaign.stage + 1}/${CAMPAIGN_STAGES.length} · TO ${campaignGoal()}` : 'FIRST TO ' + WIN, mid, y + 15);
    cx.font = 'bold 28px system-ui, sans-serif';
    const tl = sideSwap(0), tr = sideSwap(1); // the teams on the left and right right now
    cx.fillStyle = teamColor(tl); cx.fillText(String(score[tl]), mid - 32, y + 43);
    cx.fillStyle = '#e8e8e4'; cx.fillText('-', mid, y + 41);
    cx.fillStyle = teamColor(tr); cx.fillText(String(score[tr]), mid + 32, y + 43);
    drawNetStatus();
}
