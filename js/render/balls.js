// RENDER - the death ball (and decoys, which look the same), the marionette pull effect, and the round / match banner. Read-only on game state.
function drawBall(b) { // the Death Ball sprite (decoys use it too)
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260); // slow glow pulse
    const bgr = cx.createRadialGradient(b.x - 4, b.y - 4, 1, b.x, b.y, b.r);
    bgr.addColorStop(0, '#000000');
    bgr.addColorStop(1, '#000000');
    cx.fillStyle = bgr;
    cx.strokeStyle = '#b36bff';
    cx.lineWidth = 3;
    cx.shadowColor = '#000000';
    cx.shadowBlur = 16 + 12 * pulse;
    cx.beginPath();
    cx.arc(b.x, b.y, b.r, 0, 7);
    cx.fill();
    cx.stroke();
    cx.shadowBlur = 0;
    cx.strokeStyle = 'rgba(235,215,255,.9)';
    cx.lineWidth = 2;
    cx.beginPath(); // spin marker
    line(b.x, b.y, b.x + Math.cos(b.th) * b.r, b.y + Math.sin(b.th) * b.r);
    cx.stroke();
}
function drawPull(b) { // marionette: a ring and streaks in the caster's color behind the ball, fading over MARIONETTE_FX
    const q = b.pull;
    if (!q || q.t <= 0)
        return;
    const f = q.t / MARIONETTE_FX, nx = -q.uy, ny = q.ux;
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    cx.lineCap = 'round';
    cx.strokeStyle = q.col; cx.shadowColor = q.col; cx.shadowBlur = 12;
    cx.globalAlpha = 0.7 * f; cx.lineWidth = 2;
    cx.beginPath(); cx.arc(b.x, b.y, b.r + (1 - f) * 22, 0, 7); cx.stroke();
    for (const o of [-0.7, 0, 0.7]) {
        const len = (22 + 70 * f) * (o ? 0.8 : 1);
        cx.globalAlpha = 0.8 * f * (o ? 0.7 : 1);
        cx.lineWidth = o ? 2 : 6;
        cx.beginPath();
        line(b.x + nx * o * b.r, b.y + ny * o * b.r, b.x + nx * o * b.r - q.ux * len, b.y + ny * o * b.r - q.uy * len);
        cx.stroke();
    }
    cx.restore();
}
function drawBalls() { // speed lines, decoys, then the death ball on top
    drawTrail(ball);
    for (const d of decoys)
        drawTrail(d);
    for (const d of decoys) { // decoys look exactly like the death ball (under it), plus an optional ring in their caster's color
        drawBall(d);
        if (DECOY_TELL || d.swarm) { // (a swarm ball always wears its owner's ring, so you can tell it from the real one)
            cx.save();
            cx.strokeStyle = d.team === 0 ? '#42a5f5' : '#ef5350'; cx.lineWidth = 2; cx.globalAlpha = 0.9;
            cx.setLineDash([4, 4]); cx.lineDashOffset = -performance.now() / 80;
            cx.beginPath(); cx.arc(d.x, d.y, d.r + 6, 0, 7); cx.stroke();
            cx.restore();
        }
    }
    drawBall(ball);
    drawPull(ball);
    for (const d of decoys) if (d.swarm) drawPull(d);
}
function drawMessage() { // round / match banner
    cx.textAlign = 'center';
    cx.font = 'bold 30px system-ui, sans-serif';
    if (msg) {
        cx.fillStyle = '#fff';
        cx.font = 'bold 34px system-ui, sans-serif';
        cx.fillText(msg, W / 2, H / 2 - 40);
    }
}
