// RENDER - reel: how REEL looks while it runs. Display only; reads the cast the physics keeps on the player (c.mode: 1 = paying out, 2 = reeling in, 0 = held but idle).
// Load after render/ropes.js and call drawReelFx() right after drawRopes() in render.js, so it sits on top of the rope.
//   EXTENDING   gold chevrons stream from you out to the hook (pointing outward), a bright flare at the hook and a ring that bursts outward from it.
//   REELING IN  cyan chevrons stream from the hook back to you (pointing at you), the rope is drawn taut and doubled, and a dashed ring closes in on the hook.
//   IDLE        (key held, nothing happening yet): a small dotted ring on you, so you can see the reel is live.
// Different colour AND opposite direction, so the two read apart even at a glance (or colour-blind).
const REEL_OUT_COL = '#ffcc4d', REEL_IN_COL = '#4dd8ff';
function reelChevrons(p, hx, hy, dir, col, fast) { // dir = +1 flows from you toward the hook, -1 from the hook toward you
    const dx = hx - p.x, dy = hy - p.y, d = Math.hypot(dx, dy);
    const a = p.r + 6, b = d - 7, GAP = 20, S = 5;
    if (b - a < GAP * 0.6)
        return;
    const ux = dx / d, uy = dy / d, nx = -uy, ny = ux, now = performance.now() / 1000, off = ((now * (fast ? 150 : 110)) % GAP + GAP) % GAP;
    cx.save();
    cx.strokeStyle = col; cx.lineWidth = 2.6; cx.lineCap = 'round'; cx.lineJoin = 'round';
    for (let t = a + (dir > 0 ? off : GAP - off); t < b; t += GAP) {
        const f = (t - a) / (b - a), fade = Math.sin(Math.PI * Math.min(1, Math.max(0, f))); // fades in and out toward each end
        const x = p.x + ux * t, y = p.y + uy * t, tx = ux * dir, ty = uy * dir; // the chevron points the way it flows
        cx.globalAlpha = 0.25 + 0.75 * fade;
        cx.beginPath();
        cx.moveTo(x - tx * S + nx * S, y - ty * S + ny * S);
        cx.lineTo(x + tx * S, y + ty * S);
        cx.lineTo(x - tx * S - nx * S, y - ty * S - ny * S);
        cx.stroke();
    }
    cx.restore();
}
function drawReelFx() {
    const now = performance.now() / 1000;
    for (const p of players) {
        if (!p.alive || !p.rope)
            continue;
        const c = (p.casts || []).find(q => q.type === 'reel');
        if (!c)
            continue;
        const hx = p.rope.x, hy = p.rope.y;
        if (c.mode === 1) { // extending
            const ph = (now * 2.4) % 1, col = REEL_OUT_COL;
            cx.save();
            cx.strokeStyle = col; cx.globalAlpha = 0.3; cx.lineWidth = 7; cx.lineCap = 'round'; // glow under the rope
            cx.beginPath(); line(p.x, p.y, hx, hy); cx.stroke();
            cx.restore();
            reelChevrons(p, hx, hy, +1, col, true);
            cx.save(); // flare and an expanding ring at the hook, a ring on you where the line pays out
            cx.fillStyle = col; cx.globalAlpha = 0.85;
            cx.beginPath(); cx.arc(hx, hy, 6.5, 0, 7); cx.fill();
            cx.strokeStyle = col; cx.lineWidth = 2.4; cx.globalAlpha = 1 - ph;
            cx.beginPath(); cx.arc(hx, hy, 8 + 20 * ph, 0, 7); cx.stroke();
            cx.globalAlpha = 0.7;
            cx.beginPath(); cx.arc(p.x, p.y, p.r + 4 + 6 * ph, 0, 7); cx.stroke();
            cx.restore();
        } else if (c.mode === 2) { // reeling in
            const ph = (now * 2.4) % 1, col = REEL_IN_COL;
            cx.save();
            cx.strokeStyle = col; cx.globalAlpha = 0.35; cx.lineWidth = 8; cx.lineCap = 'round'; // a fatter glow, and a bright thin core: the rope looks taut
            cx.beginPath(); line(p.x, p.y, hx, hy); cx.stroke();
            cx.globalAlpha = 0.9; cx.lineWidth = 1.4; cx.strokeStyle = '#ffffff';
            cx.beginPath(); line(p.x, p.y, hx, hy); cx.stroke();
            cx.restore();
            reelChevrons(p, hx, hy, -1, col, true);
            cx.save(); // a dashed ring closing in on the hook (the opposite of the extend burst), and a ring tightening on you
            cx.strokeStyle = col; cx.lineWidth = 2.4; cx.setLineDash([4, 4]); cx.globalAlpha = 0.4 + 0.6 * ph;
            cx.beginPath(); cx.arc(hx, hy, 8 + 20 * (1 - ph), 0, 7); cx.stroke();
            cx.setLineDash([]); cx.globalAlpha = 0.8;
            cx.beginPath(); cx.arc(p.x, p.y, p.r + 4 + 6 * (1 - ph), 0, 7); cx.stroke();
            cx.fillStyle = col; cx.beginPath(); cx.arc(hx, hy, 5, 0, 7); cx.fill();
            cx.restore();
        } else { // idle: the key is held but nothing is moving
            cx.save();
            cx.strokeStyle = 'rgba(232,232,228,.55)'; cx.lineWidth = 1.6; cx.setLineDash([2, 4]);
            cx.beginPath(); cx.arc(p.x, p.y, p.r + 5, 0, 7); cx.stroke();
            cx.restore();
        }
    }
}
