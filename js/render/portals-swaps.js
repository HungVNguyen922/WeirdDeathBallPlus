// RENDER - Portal discs and the Swap cone / flight animation (plus swapArrive, which drawPlayers uses to fade a swapped player in). Read-only on game state.
function drawPortalShape(x, y, ang, flash, preview, tm) { // one portal: a glowing orange disc with an arrow showing which way things come out
    const R = PORTAL_R, nx = Math.cos(ang), ny = Math.sin(ang), tx = -ny, ty = nx, pulse = 0.5 + 0.5 * Math.sin(tm / 200);
    cx.save();
    cx.globalAlpha = preview ? 0.55 : 1;
    const g = cx.createRadialGradient(x, y, 2, x, y, R);
    g.addColorStop(0, 'rgba(255,152,0,' + (0.35 + 0.3 * flash) + ')');
    g.addColorStop(1, 'rgba(255,152,0,0.05)');
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(x, y, R, 0, 7); cx.fill();
    cx.shadowColor = '#ff9800'; cx.shadowBlur = 10 + 14 * flash + 4 * pulse;
    cx.strokeStyle = '#ff9800'; cx.lineWidth = 3 + 2 * flash;
    if (preview) cx.setLineDash([6, 5]);
    cx.beginPath(); cx.arc(x, y, R, 0, 7); cx.stroke();
    cx.setLineDash([]);
    cx.shadowBlur = 0;
    cx.strokeStyle = '#ffe0b2'; cx.lineWidth = 3; cx.lineCap = 'round'; cx.lineJoin = 'round'; // the arrow: which way things come out
    const tipX = x + nx * R * 0.8, tipY = y + ny * R * 0.8;
    cx.beginPath(); line(x - nx * R * 0.45, y - ny * R * 0.45, tipX, tipY);
    cx.moveTo(tipX - nx * 10 + tx * 8, tipY - ny * 10 + ty * 8); cx.lineTo(tipX, tipY); cx.lineTo(tipX - nx * 10 - tx * 8, tipY - ny * 10 - ty * 8);
    cx.stroke();
    cx.restore();
}
function drawPortals() { // Portal: both teams see every portal (all orange), a faint dashed link between each pair, and a dashed preview while a player is aiming one
    const tm = performance.now();
    cx.save();
    for (const q of portals) {
        const o = partnerOf(q);
        if (o && q.id < o.id) {
            cx.globalAlpha = 0.25; cx.strokeStyle = '#ff9800'; cx.lineWidth = 1.5; cx.setLineDash([5, 7]); cx.lineDashOffset = -(tm / 50) % 12;
            cx.beginPath(); line(q.x, q.y, o.x, o.y); cx.stroke();
            cx.setLineDash([]); cx.lineDashOffset = 0; cx.globalAlpha = 1;
        }
    }
    for (const q of portals)
        drawPortalShape(q.x, q.y, q.ang, q.flash || 0, false, tm);
    for (const p of players)
        if (p.alive && p.pcast)
            drawPortalShape(p.pcast.x, p.pcast.y, p.pcast.ang, 0, true, tm);
    cx.restore();
}
function drawSwaps() { // Swap: the cone of vision while aiming (with the body it would pick ringed: solid ring = nearest, double dashed ring = furthest, i.e. weight held), and a flash after a swap
    cx.save();
    for (const p of players) {
        const c = p.scast;
        if (p.alive && c) {
            const far = !!(p.keys && p.keys.x), t = swapPick(p, c.ang, far), col = p.color || '#fff';
            cx.globalAlpha = 1;
            const g = cx.createRadialGradient(p.x, p.y, 4, p.x, p.y, SWAP_RANGE);
            g.addColorStop(0, 'rgba(255,255,255,0.28)');
            g.addColorStop(1, 'rgba(255,255,255,0.03)');
            cx.fillStyle = g;
            cx.beginPath(); cx.moveTo(p.x, p.y); cx.arc(p.x, p.y, SWAP_RANGE, c.ang - SWAP_HALF, c.ang + SWAP_HALF); cx.closePath(); cx.fill();
            cx.strokeStyle = col; cx.lineWidth = 2; cx.setLineDash([8, 6]);
            cx.beginPath(); cx.moveTo(p.x + Math.cos(c.ang - SWAP_HALF) * SWAP_RANGE, p.y + Math.sin(c.ang - SWAP_HALF) * SWAP_RANGE); cx.lineTo(p.x, p.y);
            cx.lineTo(p.x + Math.cos(c.ang + SWAP_HALF) * SWAP_RANGE, p.y + Math.sin(c.ang + SWAP_HALF) * SWAP_RANGE);
            cx.stroke();
            cx.beginPath(); cx.arc(p.x, p.y, SWAP_RANGE, c.ang - SWAP_HALF, c.ang + SWAP_HALF); cx.stroke();
            cx.setLineDash([]);
            if (t) {
                const tr = (t.r || 8) + 6;
                cx.strokeStyle = '#fff'; cx.lineWidth = 2.5;
                cx.beginPath(); cx.arc(t.x, t.y, tr, 0, 7); cx.stroke();
                if (far) { cx.setLineDash([4, 4]); cx.beginPath(); cx.arc(t.x, t.y, tr + 5, 0, 7); cx.stroke(); cx.setLineDash([]); }
                cx.globalAlpha = 0.6; cx.lineWidth = 1.5; cx.setLineDash([3, 5]);
                cx.beginPath(); line(p.x, p.y, t.x, t.y); cx.stroke();
                cx.setLineDash([]);
            }
        }
        if (p.swapFx)
            drawSwapFlight(p, p.swapFx);
    }
    cx.restore();
}
// Swap flight: the bodies already sit at their new spots (the sim moves them at once), so a ghost of each one flies the old way round on opposite arcs, with a trail, while the
// real bodies fade in at the far end (see swapArrive) and rings pop at both ends. Everything here is display only.
function swapGhost(kind, x, y, r, col, ang, alpha, pts) {
    cx.save();
    cx.globalAlpha = alpha;
    if (kind === 'block' && pts) {
        cx.translate(x, y);
        cx.rotate(ang);
        cx.fillStyle = col; cx.strokeStyle = '#fff'; cx.lineWidth = 2; cx.lineJoin = 'round';
        cx.beginPath();
        pts.forEach(([px, py], i) => (i ? cx.lineTo(px, py) : cx.moveTo(px, py)));
        cx.closePath(); cx.fill(); cx.stroke();
    } else if (kind === 'arrow') {
        arrowShape(x, y, ang, ARROW_LEN, col, alpha);
    } else if (kind === 'ball') {
        cx.fillStyle = '#000'; cx.strokeStyle = '#b36bff'; cx.lineWidth = 3;
        cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill(); cx.stroke();
    } else {
        cx.fillStyle = col; cx.strokeStyle = kind === 'boomerang' ? '#d9a066' : '#fff'; cx.lineWidth = 2;
        cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill(); cx.stroke();
    }
    cx.restore();
}
function drawSwapFlight(p, f) {
    const u = Math.max(0, f.t / SWAP_FX), prog = 1 - u, ease = v => v * v * (3 - 2 * v), dx = f.bx - f.ax, dy = f.by - f.ay, dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist, ny = dx / dist, arc = Math.min(70, 14 + dist * 0.18); // the arc bulges sideways; the two ghosts bulge to opposite sides so they pass each other
    const at = (e, side, rev) => { // position along the path at eased progress e; rev flies from b to a
        const t = rev ? 1 - e : e, bulge = Math.sin(Math.PI * e) * arc * side;
        return { x: f.ax + dx * t + nx * bulge, y: f.ay + dy * t + ny * bulge };
    };
    cx.save();
    cx.lineCap = 'round';
    cx.globalAlpha = 0.5 * u; cx.strokeStyle = p.color || '#fff'; cx.lineWidth = 2; cx.setLineDash([4, 6]);
    cx.beginPath(); line(f.ax, f.ay, f.bx, f.by); cx.stroke();
    cx.setLineDash([]);
    const lanes = [[false, 1, p.color || '#fff', f.pr, 'player', 0], [true, -1, f.bcol || '#b36bff', f.br, f.bk, f.bang, f.bpts]]; // [flies b -> a, arc side, colour, radius, kind, angle]
    for (const [rev, side, col, r, kind, ang, pts] of lanes) {
        const e = ease(prog);
        cx.save();
        cx.globalCompositeOperation = 'lighter';
        for (let k = 5; k >= 1; k--) { // trail: the same path a little earlier, fainter and thinner
            const ek = ease(Math.max(0, prog - k * 0.045)), a = at(ek, side, rev), b = at(Math.max(0, ek - 0.03), side, rev);
            cx.strokeStyle = col; cx.globalAlpha = 0.5 * (1 - k / 6) * u; cx.lineWidth = Math.max(1, r * 1.6 * (1 - k / 6));
            cx.beginPath(); line(a.x, a.y, b.x, b.y); cx.stroke();
        }
        cx.restore();
        const g = at(e, side, rev);
        swapGhost(kind, g.x, g.y, r, col, ang, 0.9 * u + 0.1, pts);
    }
    for (const [x, y, r] of [[f.ax, f.ay, f.pr], [f.bx, f.by, f.br]]) { // a ring at each end: it opens where the body left and closes in on where it lands
        cx.strokeStyle = '#fff'; cx.lineWidth = 3 * u + 1;
        cx.globalAlpha = 0.8 * u; cx.beginPath(); cx.arc(x, y, r + 6 + 26 * prog, 0, 7); cx.stroke();
        cx.globalAlpha = 0.6 * prog * u; cx.beginPath(); cx.arc(x, y, r + 24 * u, 0, 7); cx.stroke();
    }
    cx.restore();
}
function swapArrive(q) { // how much of a player is shown right now: a player who just swapped fades in at the new spot while its ghost flies there
    for (const p of players) {
        const f = p.swapFx;
        if (f && (p === q || f.bid === q.id))
            return 0.2 + 0.8 * clamp01(1 - f.t / SWAP_FX);
    }
    return 1;
}
