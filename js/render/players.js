// RENDER - the player discs: the team-colour body, the skin inside it (render/skin.js), the white outline, then hats and other outside layers. Read-only on game state.
function drawPlayers() { // the player discs
    for (const p of players) {
        cx.globalAlpha = p.alive ? swapArrive(p) * (p.invT > 0 && Math.floor(performance.now() / 90) % 2 ? 0.4 : 1) : 0.2; // (blinking = spawn protection)
        cx.fillStyle = p.color;
        cx.strokeStyle = '#fff';
        cx.lineWidth = p.keys.x ? 6 : 2;
        cx.beginPath();
        cx.arc(p.x, p.y, p.r, 0, 7);
        cx.fill();
        const sp = skinSprite(skinOf(p), p.color); // null = a plain disc
        if (sp)
            cx.drawImage(sp.inner, p.x - p.r, p.y - p.r, 2 * p.r, 2 * p.r); // the skin goes under the outline (the path above is still the circle)
        cx.stroke();
        if (sp && sp.outer)
            cx.drawImage(sp.outer, p.x - SKIN_EXTENT * p.r, p.y - SKIN_EXTENT * p.r, 2 * SKIN_EXTENT * p.r, 2 * SKIN_EXTENT * p.r); // hats etc. on top of the outline
        cx.globalAlpha = 1;
        drawFacing(p);
        if (p.alive) {
            drawGrappleRing(p);
            drawFloorFx(p);
        }
        if (p.alive && p.arrowQueued && !p.casting('arrow')) { // queued arrow: pulsing dashed ring
            cx.globalAlpha = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() / 90));
            cx.strokeStyle = p.color; cx.lineWidth = 2; cx.setLineDash([4, 4]);
            cx.beginPath(); cx.arc(p.x, p.y, p.r + 6, 0, 7); cx.stroke();
            cx.setLineDash([]); cx.globalAlpha = 1;
        }
    }
}
