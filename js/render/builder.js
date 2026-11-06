// RENDER - builder: how a block looks. Display only. Load after render/fighter.js (it defines PROJ_DRAW) and before render/render.js.
// drawProjectiles() (render/fighter.js) calls PROJ_DRAW.block.world(b, teamColour) for every projectile of type 'block'.
PROJ_DRAW.block = {
    world(b, col) {
        if (b.broken)
            return;
        const P = b.pts, path = () => {
            cx.beginPath();
            P.forEach(([x, y], i) => (i ? cx.lineTo(x, y) : cx.moveTo(x, y))); // (the block's own frame: see the translate / rotate below)
            cx.closePath();
        };
        const stress = b.stress || 0, fresh = Math.max(0, 1 - (b.age || 0) / 0.25); // stress: 0..1, how close the last hit came to breaking it; fresh: a flash just after it is built
        cx.translate(b.x, b.y);
        cx.rotate(b.th || 0); // blocks spin
        cx.lineJoin = 'round';
        path();
        cx.globalAlpha = 1; cx.fillStyle = '#1d2530'; cx.fill();                           // body
        cx.globalAlpha = 0.35; cx.fillStyle = col; cx.fill();                              // team tint
        if (stress > 0.05) { cx.globalAlpha = 0.55 * stress; cx.fillStyle = '#fff'; cx.fill(); } // flashes white as it is about to give way
        cx.globalAlpha = 1; cx.strokeStyle = col; cx.lineWidth = 3; cx.stroke();
        cx.globalAlpha = 0.45; cx.strokeStyle = '#fff'; cx.lineWidth = 1; cx.stroke();
        if (stress > 0.5) { // cracks
            cx.globalAlpha = Math.min(1, (stress - 0.5) * 2); cx.strokeStyle = '#fff'; cx.lineWidth = 1.5; cx.lineCap = 'round';
            cx.beginPath();
            cx.moveTo(-b.r * 0.5, -b.r * 0.2); cx.lineTo(-b.r * 0.1, b.r * 0.05); cx.lineTo(b.r * 0.25, -b.r * 0.3);
            cx.moveTo(-b.r * 0.1, b.r * 0.05); cx.lineTo(b.r * 0.1, b.r * 0.5);
            cx.stroke();
        }
        if (fresh > 0) { path(); cx.globalAlpha = 0.8 * fresh; cx.strokeStyle = '#fff'; cx.lineWidth = 2 + 6 * fresh; cx.stroke(); }
        cx.globalAlpha = 1;
    },
};
