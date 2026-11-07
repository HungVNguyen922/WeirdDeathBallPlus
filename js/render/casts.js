// RENDER - casts: the AI tag over computer players and every ability being cast (ghost pegs / decoys, marionette aim, bat, cast timers). Read-only on game state.
function drawAITags() { // "AI" tag over a computer-controlled player
    if (net.on) // online every seat is a person (the ai flags are offline-only state)
        return;
    for (const p of players) { // "AI" tag over a computer-controlled player
        if (p.alive && ai[p.id].on) {
            cx.fillStyle = 'rgba(255,255,255,.8)';
            cx.font = 'bold 11px system-ui, sans-serif';
            cx.textAlign = 'center';
            cx.fillText('AI', p.x, p.y - p.r - 7);
        }
    }
}
function drawCasts() { // abilities being cast: ghost pegs / decoys, marionette aim, cast timers
    for (const p of players) for (const cast of p.casts || []) { // casts in progress (a player can have two at once)
        if (!p.alive)
            continue;
        const col = p.team === 0 ? '#42a5f5' : '#ef5350', prog = 1 - cast.t / cast.t0;
        if (cast.type === 'plinko') { // ghost peg at the spot, filling as the cast completes
            cx.globalAlpha = 0.55; cx.strokeStyle = col; cx.lineWidth = 2; cx.setLineDash([3, 3]);
            cx.beginPath(); cx.arc(cast.x, cast.y, PEG_R - 1, 0, 7); cx.stroke();
            cx.setLineDash([]);
            cx.globalAlpha = 1;
            drawTimer(cast.x, cast.y, PEG_R + 5, prog, col);
        } else if (cast.type === 'decoy') { // ghost ball at the spot, filling as the cast completes
            cx.globalAlpha = 0.55; cx.strokeStyle = '#b36bff'; cx.lineWidth = 2; cx.setLineDash([3, 3]);
            cx.beginPath(); cx.arc(cast.x, cast.y, BALL_R, 0, 7); cx.stroke();
            cx.setLineDash([]);
            cx.globalAlpha = 1;
            drawTimer(cast.x, cast.y, BALL_R + 5, prog, col);
        } else if (cast.type === 'bat') { // the bat: purely cosmetic. Held back opposite the aim while charging, then over the top and down through the aim, leaving streaks like the player trails
            const c = cast, f = c.charging ? 0 : prog, fade = f > 0.8 ? (1 - f) / 0.2 : 1, r0 = p.r + 3, len = BAT_REACH - r0;
            if (c.charging)
                drawTimer(p.x, p.y, p.r + 6, c.charge, c.charge >= 1 ? '#ffffff' : col);
            cx.save();
            if (f > 0) { // streaks: the bat's recent path, drawn the way trail.js draws a player's (glow under a core line, thinner lanes beside it, all tapering and fading toward the tail)
                const tint = trailTint(p), speed = Math.sin(Math.PI * f), k = clamp01((0.3 + 0.7 * speed) * (0.75 + 0.25 * c.pow)); // brightest mid-swing, a bit more when charged
                const N = 16, span = 0.55, ths = [];
                for (let n = 0; n <= N; n++) { // angles of the bat from now back into the swing
                    const fi = f - span * n / N;
                    if (fi < 0)
                        break;
                    ths.push(batAngleAt(c, fi));
                }
                const lanes = [[0.78, 1], [1, 0], [0.62, 0], [0.9, 0], [0.5, 0], [0.7, 0], [0.38, 0]].slice(0, c.pow > 0.66 ? 7 : c.pow > 0.33 ? 5 : 3); // [share of the reach, is the core lane]
                cx.globalCompositeOperation = 'lighter';
                cx.lineCap = 'round';
                for (const [rf, core] of lanes) {
                    const R = r0 + len * (rf === 1 ? 1 : rf);
                    for (let n = 0; n < ths.length - 1; n++) {
                        const age = n / (ths.length - 1), a = 1 - age, t = Math.pow(a, 1.3) * k * fade;
                        const x1 = p.x + Math.cos(ths[n]) * R, y1 = p.y + Math.sin(ths[n]) * R, x2 = p.x + Math.cos(ths[n + 1]) * R, y2 = p.y + Math.sin(ths[n + 1]) * R;
                        if (core) { // soft wide glow under the main streak
                            cx.strokeStyle = `rgba(${tint.glow},${0.3 * t})`;
                            cx.lineWidth = (10 + 14 * k) * (1 - age * 0.8);
                            cx.beginPath(); line(x1, y1, x2, y2); cx.stroke();
                        }
                        const r = tint.from[0] + (tint.to[0] - tint.from[0]) * k, g = tint.from[1] + (tint.to[1] - tint.from[1]) * k, bl = tint.from[2] + (tint.to[2] - tint.from[2]) * k; // team colour -> white-hot
                        cx.strokeStyle = `rgba(${r | 0},${g | 0},${bl | 0},${(core ? 0.9 : 0.6) * t})`;
                        cx.lineWidth = (core ? 2.5 + 6 * k : 1.2 + 1.6 * k) * (1 - age * 0.85);
                        cx.beginPath(); line(x1, y1, x2, y2); cx.stroke();
                    }
                }
                cx.globalCompositeOperation = 'source-over';
            }
            // The bat itself, from the player's edge out to BAT_REACH: a knob, a thin grip wrapped in the team colour, then a barrel that thickens toward a rounded tip.
            const th = batAngleAt(c, f), ux = Math.cos(th), uy = Math.sin(th), nx = -uy, ny = ux, at = t => r0 + len * t;
            const hw = t => t < 0.34 ? 1.8 : 1.8 + 3.9 * Math.pow(Math.min(1, (t - 0.34) / 0.52), 0.8); // half-width along the bat
            cx.globalAlpha = fade;
            cx.fillStyle = '#d9a066'; cx.strokeStyle = '#7a4d22'; cx.lineWidth = 1.2; cx.lineJoin = 'round';
            cx.beginPath();
            for (let n = 0; n <= 12; n++) { const t = n / 12, w = hw(t); cx.lineTo(p.x + ux * at(t) + nx * w, p.y + uy * at(t) + ny * w); }
            cx.arc(p.x + ux * at(1), p.y + uy * at(1), hw(1), th - Math.PI / 2, th + Math.PI / 2); // rounded tip
            for (let n = 12; n >= 0; n--) { const t = n / 12, w = hw(t); cx.lineTo(p.x + ux * at(t) - nx * w, p.y + uy * at(t) - ny * w); }
            cx.closePath(); cx.fill(); cx.stroke();
            cx.strokeStyle = col; cx.lineWidth = 3.4; cx.lineCap = 'butt'; // grip tape
            cx.beginPath(); line(p.x + ux * at(0.04), p.y + uy * at(0.04), p.x + ux * at(0.3), p.y + uy * at(0.3)); cx.stroke();
            cx.fillStyle = col; // knob
            cx.beginPath(); cx.arc(p.x + ux * (at(0) - 1), p.y + uy * (at(0) - 1), 3.4, 0, 7); cx.fill();
            cx.restore();
        } else if (cast.type === 'arrow') { // charge ring (white and pulsing at full), a drawn bow, and the arrow nocked on it along the aim
            const c = cast, full = c.charge >= 1, pulse = 0.5 + 0.5 * Math.sin(performance.now() / 70);
            drawTimer(p.x, p.y, p.r + 6, c.charge, full ? '#ffffff' : col);
            const ux = Math.cos(c.ang), uy = Math.sin(c.ang), nx = -uy, ny = ux;
            const gd = p.r + 34, len = 12 + 26 * c.charge; // distance of the grip from the player, arrow length (as before)
            const gx = p.x + ux * gd, gy = p.y + uy * gd; // the grip: the bow's middle, the point nearest the target
            const back = 4 + 10 * c.charge, H = 26; // how far the limb tips sit behind the grip (more bend as it charges), and the bow's half-height
            const t1x = gx + nx * H - ux * back, t1y = gy + ny * H - uy * back, t2x = gx - nx * H - ux * back, t2y = gy - ny * H - uy * back;
            const ctx_ = gx + ux * back, cty_ = gy + uy * back; // quadratic control point chosen so the curve passes exactly through the grip
            const hx = gx + ux * 8, hy = gy + uy * 8, tx = hx - ux * len, ty = hy - uy * len; // arrow head (fixed, just past the grip) and its tail = the nock
            cx.save();
            cx.lineCap = 'round'; cx.lineJoin = 'round';
            if (full) { cx.shadowColor = '#ffffff'; cx.shadowBlur = 8 + 6 * pulse; }
            cx.strokeStyle = '#7a4d22'; cx.lineWidth = 5.4; // bow outline, then the wood on top
            cx.beginPath(); cx.moveTo(t1x, t1y); cx.quadraticCurveTo(ctx_, cty_, t2x, t2y); cx.stroke();
            cx.strokeStyle = full ? '#fff0d6' : '#d9a066'; cx.lineWidth = 3.4;
            cx.beginPath(); cx.moveTo(t1x, t1y); cx.quadraticCurveTo(ctx_, cty_, t2x, t2y); cx.stroke();
            cx.shadowBlur = 0;
            cx.strokeStyle = col; cx.lineWidth = 5; // grip wrap in the team colour
            cx.beginPath(); line(gx - nx * 4, gy - ny * 4, gx + nx * 4, gy + ny * 4); cx.stroke();
            cx.strokeStyle = '#e8e8e4'; cx.lineWidth = 1.3; // the string, pulled back to the nock
            cx.beginPath(); cx.moveTo(t1x, t1y); cx.lineTo(tx, ty); cx.lineTo(t2x, t2y); cx.stroke();
            cx.restore();
            arrowShape(hx, hy, c.ang, len, col, full ? 0.7 + 0.3 * pulse : 1);
        } else if (cast.type === 'reel') { // drawn by drawReelFx() (render/reel.js), after the ropes
        } else if (cast.type === 'barbwire') { // time left on the wire: a ring that only shows (and only drains) while the rope is out, turning red when nearly spent
            const left = 1 - Math.min(1, cast.roped / BARBWIRE_MAX_T);
            if (ropeEnd(p))
                drawTimer(p.x, p.y, p.r + 6, left, left < 0.25 ? '#000000' : col);
            drawTimer(p.x, p.y, p.r + 6, left, left < 0.25 ? '#000000' : col);
        } else {
            if (cast.type === 'marionette') { // aiming: a string from the caster to the ball, and an arrow on the ball showing where the shove will go
                const c = cast, pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110), dirOn = c.hx || c.hy;
                cx.globalAlpha = 0.45; cx.strokeStyle = col; cx.lineWidth = 1.5; cx.setLineDash([4, 5]);
                cx.beginPath(); line(p.x, p.y, ball.x, ball.y); cx.stroke();
                cx.setLineDash([]);
                cx.globalAlpha = 0.5 + 0.4 * pulse; cx.lineWidth = 2; // pulsing ring on the caster: the key is held
                cx.beginPath(); cx.arc(p.x, p.y, p.r + 6, 0, 7); cx.stroke();
                if (dirOn) {
                    const m = Math.hypot(c.hx, c.hy), ux = c.hx / m, uy = c.hy / m, nx = -uy, ny = ux, a0 = ball.r + 8, a1 = a0 + 40 + 6 * pulse;
                    cx.globalAlpha = c.grace > 0 && !anyArrowHeld(p) ? 0.55 : 1; cx.lineWidth = 3; cx.lineCap = 'round'; cx.lineJoin = 'round';
                    cx.beginPath();
                    line(ball.x + ux * a0, ball.y + uy * a0, ball.x + ux * a1, ball.y + uy * a1);
                    cx.moveTo(ball.x + ux * a1 - ux * 9 + nx * 6, ball.y + uy * a1 - uy * 9 + ny * 6);
                    cx.lineTo(ball.x + ux * a1, ball.y + uy * a1);
                    cx.lineTo(ball.x + ux * a1 - ux * 9 - nx * 6, ball.y + uy * a1 - uy * 9 - ny * 6);
                    cx.stroke();
                } else { // no direction yet: a dashed ring on the ball
                    cx.globalAlpha = 0.5; cx.lineWidth = 1.5; cx.setLineDash([3, 4]);
                    cx.beginPath(); cx.arc(ball.x, ball.y, ball.r + 8, 0, 7); cx.stroke();
                    cx.setLineDash([]);
                }
                cx.globalAlpha = 1;
            } else
                drawTimer(p.x, p.y, p.r + 6, prog, col);
        }
    }
}
