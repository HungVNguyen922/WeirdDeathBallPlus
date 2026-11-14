// RENDER - effects around a player: dash streaks, speed trails, the grapple-meter ring and the hyper / xeric floor auras. Read-only on game state.
function drawDashStreaks() { // dash: after-images, a swarm of blur lines and a shock arc behind the player
    const fr = v => v - Math.floor(v), hash = i => fr(Math.sin(i * 127.1 + 311.7) * 43758.5453);
    const LANES = [-1.15, -0.92, -0.69, -0.46, -0.23, 0, 0.23, 0.46, 0.69, 0.92, 1.15, -2.3, -1.8, 1.8, 2.3]; // across the body (first 11), then loose streaks outside it
    for (const p of players) {
        if (!p.alive || !(p.dashT > 0))
            continue;
        const f = p.dashT / DASH_FX, g = 1 - f, ux = p.dashDir[0], uy = p.dashDir[1], nx = -uy, ny = ux;
        cx.save();
        cx.fillStyle = p.color; // after-images: faded copies of the player strung out behind
        for (let k = 1; k <= 5; k++) {
            const d = k * (8 + 14 * g);
            cx.globalAlpha = 0.3 * f * (1 - k / 6);
            cx.beginPath(); cx.arc(p.x - ux * d, p.y - uy * d, p.r * (1 - 0.06 * k), 0, 7); cx.fill();
        }
        cx.globalCompositeOperation = 'lighter';
        cx.lineCap = 'round';
        cx.strokeStyle = p.color; cx.shadowColor = p.color; cx.shadowBlur = 12;
        const back = Math.atan2(-uy, -ux); // a shock arc behind the player that grows and fades at the start of the dash
        cx.globalAlpha = 0.55 * f * f; cx.lineWidth = 2 + 3 * f;
        cx.beginPath(); cx.arc(p.x, p.y, p.r + 4 + 30 * g, back - 1.1, back + 1.1); cx.stroke();
        LANES.forEach((o, i) => {
            const h = hash(i), h2 = hash(i + 0.5), edge = Math.abs(o), wide = edge > 1.2; // wide = the loose streaks outside the body
            const len = (24 + 120 * f) * (0.45 + 0.9 * h) * (wide ? 0.6 : 1 - 0.3 * edge);
            const sx = p.x + nx * o * p.r + ux * p.r * 0.25 * (h2 - 0.5), sy = p.y + ny * o * p.r + uy * p.r * 0.25 * (h2 - 0.5);
            cx.globalAlpha = (wide ? 0.4 : 0.35 + 0.5 * (1 - edge)) * f;
            cx.lineWidth = wide ? 1.2 : 1.4 + 5 * Math.pow(1 - edge / 1.15, 2);
            cx.beginPath(); line(sx, sy, sx - ux * len, sy - uy * len); cx.stroke();
        });
        cx.restore();
    }
}
function drawPlayerTrails() { // speed lines behind living players (same effect as the death ball's)
    for (const p of players)
        if (p.alive)
            drawTrail(p);
}
function drawGrappleRing(p) {
    const R = p.r + 2;
    if (p.gCool > 0 || p.gCharge < GRAPPLE_MAX - 0.01) {
        const f = p.gCool > 0 ? 1 - p.gCool / GRAPPLE_COOLDOWN : p.gCharge / GRAPPLE_MAX;
        drawTimer(p.x, p.y, R, f, p.gCool > 0 ? '#d25b5b' : f < 0.25 ? '#f0a43c' : '#e8e8e4');
    }
    if (p.gBurst > 0) {
        const u = 1 - p.gBurst / GRAPPLE_BURST_T;
        cx.shadowColor = '#9333ea'; cx.shadowBlur = 14;
        cx.globalAlpha = (1 - u) * 0.9;
        drawTimer(p.x, p.y, R, 1, '#c58bff'); // the ring flashes purple
        for (let i = 0; i < 3; i++) { // three staggered ripples spreading outward
            const v = (u - i * 0.2) / 0.6;
            if (v <= 0 || v >= 1) continue;
            cx.globalAlpha = (1 - v) * 0.85;
            cx.strokeStyle = i === 0 ? '#e0c4ff' : '#b36bff';
            cx.lineWidth = 1 + 4 * (1 - v);
            cx.beginPath(); cx.arc(p.x, p.y, R + (1 - (1 - v) * (1 - v)) * 48, 0, 7); cx.stroke();
        }
        cx.shadowBlur = 0; cx.globalAlpha = 1;
    }
}
// ---- Hyper / Xeric visuals (display only: reads the player's timers, never writes them) ----
// Drop-in replacement for drawFloorFx(p) in the render file (drawPlayers() already calls it right after drawGrappleRing(p)).
//
//   Hyper owner       yellow arcs spinning around you + a yellow ripple on the floor      (the mirror of the xeric owner effect)
//   Hyper'd players   yellow chevrons rising up through them (+ the orange rim and speed streaks as before)   (the mirror of xeric's down chevrons)
//   Xeric owner       cyan arcs + floor ripple                                            (unchanged)
//   Xeric'd players   cyan tint + chevrons pressing down                                  (unchanged)
//   Bursts            yellow = a jump / kick was just boosted (boostFx), cyan = one was just cut (fizzleFx).
//                     They are independent, so a player under both a hyper and a xeric gets both; the cyan one is a bit smaller and its sparks sit
//                     between the yellow ones so the two stay readable when they overlap.
function drawFloorFx(p) {
    const tm = performance.now(), R = p.r;
    cx.save();
    cx.lineCap = 'round'; cx.lineJoin = 'round';

    if (p.hyperT > 0 || p.hyperLiteT > 0) { // HYPER owner (an unweighted "lite" hyper: three dimmer arcs instead of six): six yellow arcs turning the opposite way to the xeric ring (a touch quicker), plus a ripple under the feet
        cx.save();
        const full = p.hyperT > 0, f = Math.min(1, (full ? p.hyperT : p.hyperLiteT) / HYPER_LINGER) * (full ? 1 : 0.6), rot = -tm / 520, n = full ? 6 : 3;
        cx.shadowColor = '#ff8a1a'; cx.shadowBlur = 12;
        cx.strokeStyle = '#ffd23a'; cx.lineWidth = 3; cx.globalAlpha = 0.4 + 0.5 * f;
        for (let i = 0; i < n; i++) {
            const a = rot + i * Math.PI * 2 / n;
            cx.beginPath(); cx.arc(p.x, p.y, R + 8, a, a + 0.75); cx.stroke();
        }
        cx.strokeStyle = '#ffb21f'; cx.globalAlpha = 0.3 * f; cx.lineWidth = 2;
        cx.beginPath(); cx.ellipse(p.x, p.y + R, R + 10, 4, 0, 0, 7); cx.stroke();
        cx.restore();
    }

    if (p.xericT > 0) { // XERIC owner: a cool, steady shield of six arcs turning slowly, plus a ripple on the floor under the feet
        cx.save();
        const f = Math.min(1, p.xericT / XERIC_LINGER), rot = tm / 700;
        cx.shadowColor = '#4fd8e8'; cx.shadowBlur = 10;
        cx.strokeStyle = '#7ee8f4'; cx.lineWidth = 3; cx.globalAlpha = 0.4 + 0.5 * f;
        for (let i = 0; i < 6; i++) {
            const a = rot + i * Math.PI / 3;
            cx.beginPath(); cx.arc(p.x, p.y, R + 8, a, a + 0.75); cx.stroke();
        }
        cx.globalAlpha = 0.3 * f; cx.lineWidth = 2;
        cx.beginPath(); cx.ellipse(p.x, p.y + R, R + 10, 4, 0, 0, 7); cx.stroke();
        cx.restore();
    }

    const fx = p.floorFx(); // what OTHER players' auras are doing to me

    if (fx.hyper || p.boostFx > 0) { // BOOSTED by a hyper: an orange rim, chevrons lifting me up, speed streaks mid grapple jump; a burst when a jump / kick is actually boosted
        cx.save();
        const live = p.driveT > 0 || p.gjT < 0.5 || p.dribT > 0 ? 1 : 0.55;
        cx.globalCompositeOperation = 'lighter'; cx.shadowColor = '#ff8a1a'; cx.shadowBlur = 10;
        if (fx.hyper) {
            const hv = 0.5 + 0.5 * Math.min(1, fx.hyper); // a lite hyper alone (HYPER_LITE) shows fainter than a weighted one
            cx.strokeStyle = '#ff9b2e'; cx.lineWidth = 2.5; cx.globalAlpha = (0.35 + 0.45 * live) * hv;
            cx.beginPath(); cx.arc(p.x, p.y, R + 3, 0, 7); cx.stroke();
            cx.strokeStyle = '#ffe45a'; cx.lineWidth = 3 * hv; // chevrons pointing up, rising toward me from below (xeric's down chevrons, flipped)
            for (let i = 0; i < 2; i++) {
                const u = (tm / 700 + i / 2) % 1, cy = p.y + R + 24 - u * 16;
                cx.globalAlpha = (0.35 + 0.6 * live) * Math.sin(u * Math.PI);
                cx.beginPath(); cx.moveTo(p.x - 9, cy + 5); cx.lineTo(p.x, cy - 4); cx.lineTo(p.x + 9, cy + 5); cx.stroke();
            }
            if (live === 1) {
                const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp, nx = -uy, ny = ux, len = Math.min(95, 16 + sp * 0.12);
                cx.strokeStyle = '#ffd23a';
                for (let i = -1; i <= 1; i++) {
                    const o = i * R * 0.55, sx = p.x + nx * o - ux * R * 0.4, sy = p.y + ny * o - uy * R * 0.4;
                    cx.globalAlpha = 0.8 - 0.2 * Math.abs(i); cx.lineWidth = 3.5 - 0.8 * Math.abs(i);
                    cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(sx - ux * len, sy - uy * len); cx.stroke();
                }
            }
        }
        if (p.boostFx > 0) { // burst: a ring blowing outward and sparks flying off
            const u = 1 - p.boostFx / BOOST_FX;
            cx.globalAlpha = (1 - u) * 0.9; cx.strokeStyle = '#ffb21f'; cx.lineWidth = 1 + 4 * (1 - u);
            cx.beginPath(); cx.arc(p.x, p.y, R + 2 + u * 34, 0, 7); cx.stroke();
            cx.strokeStyle = '#ffe45a'; cx.lineWidth = 2;
            for (let i = 0; i < 6; i++) {
                const a = i * Math.PI / 3 + 0.4, d0 = R + 6 + u * 30;
                cx.beginPath(); cx.moveTo(p.x + Math.cos(a) * d0, p.y + Math.sin(a) * d0); cx.lineTo(p.x + Math.cos(a) * (d0 + 8 * (1 - u)), p.y + Math.sin(a) * (d0 + 8 * (1 - u))); cx.stroke();
            }
        }
        cx.restore();
    }

    if (fx.xeric || p.fizzleFx > 0) { // WEAKENED by a xeric: a cold tint and slow chevrons pressing down on me; a burst when a weighted jump / kick is actually cut
        cx.save();
        const live = p.keys.x || p.dribT > 0 || p.kickReq ? 1 : 0.55;
        if (fx.xeric) {
            cx.globalAlpha = 0.32 * live; cx.fillStyle = '#7ee8f4';
            cx.beginPath(); cx.arc(p.x, p.y, R, 0, 7); cx.fill();
            cx.strokeStyle = '#a8f0fa'; cx.lineWidth = 3; cx.shadowColor = '#4fd8e8'; cx.shadowBlur = 8;
            for (let i = 0; i < 2; i++) {
                const u = (tm / 700 + i / 2) % 1, cy = p.y - R - 24 + u * 16;
                cx.globalAlpha = (0.35 + 0.6 * live) * Math.sin(u * Math.PI);
                cx.beginPath(); cx.moveTo(p.x - 9, cy - 5); cx.lineTo(p.x, cy + 4); cx.lineTo(p.x + 9, cy - 5); cx.stroke();
            }
        }
        if (p.fizzleFx > 0) { // burst (the cyan twin of the yellow one): a ring blowing outward and sparks flying off, a little smaller and offset so both read when they overlap
            const u = 1 - p.fizzleFx / FIZZLE_FX;
            cx.globalCompositeOperation = 'lighter'; cx.shadowColor = '#4fd8e8'; cx.shadowBlur = 10;
            cx.globalAlpha = (1 - u) * 0.9; cx.strokeStyle = '#7ee8f4'; cx.lineWidth = 1 + 4 * (1 - u);
            cx.beginPath(); cx.arc(p.x, p.y, R + 2 + u * 26, 0, 7); cx.stroke();
            cx.strokeStyle = '#b8f6ff'; cx.lineWidth = 2;
            for (let i = 0; i < 6; i++) {
                const a = i * Math.PI / 3 + 0.4 + Math.PI / 6, d0 = R + 6 + u * 24; // half a step round from the yellow sparks
                cx.beginPath(); cx.moveTo(p.x + Math.cos(a) * d0, p.y + Math.sin(a) * d0); cx.lineTo(p.x + Math.cos(a) * (d0 + 8 * (1 - u)), p.y + Math.sin(a) * (d0 + 8 * (1 - u))); cx.stroke();
            }
        }
        cx.restore();
    }
    cx.restore();
}
