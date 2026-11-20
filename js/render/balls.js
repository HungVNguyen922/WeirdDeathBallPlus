// RENDER - the death ball (and decoys, which look the same), the marionette pull effect, and the round / match banner. Read-only on game state.
function drawBall(b) { // the Death Ball sprite (decoys use it too): a glowing purple disc with two black squares centered in it (one turned 45 degrees) - their corners reach almost to the rim, so the purple is left as 8 wedges between 8 black spikes; it spins with the ball
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260); // slow glow pulse
    const R = b.r * 0.97;                                         // how far a black spike reaches (half the squares' diagonal)
    cx.save();
    cx.translate(b.x, b.y);
    cx.shadowColor = '#b36bff';
    cx.shadowBlur = 12 + 12 * pulse;
    cx.fillStyle = '#a04bf0';
    cx.beginPath();
    cx.arc(0, 0, b.r, 0, 7);
    cx.fill();
    cx.shadowBlur = 0;
    cx.fillStyle = '#000';
    for (let q = 0; q < 2; q++) {                                 // the two squares
        const h = R / Math.SQRT2;                                 // (a square of half-side h has its corners R from the center)
        cx.save();
        cx.rotate(b.th + q * Math.PI / 4);
        cx.fillRect(-h, -h, 2 * h, 2 * h);
        cx.restore();
    }
    cx.restore();
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
