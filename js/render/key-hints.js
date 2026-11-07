// RENDER - control hints drawn on the wall mass beside each goal (keycaps light up while held).
// ---- Control hints, drawn on the solid wall mass beside each goal. Keys light up in the player's color while held. ----
function keyCap(x, y, size, col, on, dim) { // returns the y the cap's face is drawn at (pressed keys sink 2px)
    const yy = y + (on ? 2 : 0);
    cx.save();
    cx.globalAlpha = dim ? 0.35 : 1;
    cx.fillStyle = '#0d1115';
    cx.beginPath(); cx.roundRect(x - size / 2, y - size / 2 + 3, size, size, 7); cx.fill();
    cx.fillStyle = on ? col : '#2e2146';
    cx.strokeStyle = on ? '#fff' : '#a893d4';
    cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(x - size / 2, yy - size / 2, size, size, 7); cx.fill(); cx.stroke();
    cx.restore();
    return yy;
}
function arrowGlyph(x, y, ang, color) {
    cx.save();
    cx.translate(x, y); cx.rotate(ang);
    cx.strokeStyle = color; cx.lineWidth = 2.2; cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.beginPath();
    cx.moveTo(0, 7); cx.lineTo(0, -7);
    cx.moveTo(-5, -2); cx.lineTo(0, -7); cx.lineTo(5, -2);
    cx.stroke();
    cx.restore();
}
function iconGlyph(kind, x, y, color) { // little icons: grapple hook, kettlebell weight, double chevron for dash
    cx.save();
    cx.translate(x, y);
    cx.strokeStyle = color; cx.fillStyle = color; cx.lineWidth = 2.3; cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.beginPath();
    if (kind === 'grapple') {
        cx.arc(0, -10, 2.2, 0, 7);
        cx.moveTo(0, -8); cx.lineTo(0, 2);
        cx.arc(5, 2, 5, Math.PI, Math.PI * 0.15, true);
        cx.stroke();
    } else if (kind === 'weight') {
        cx.arc(0, 3, 7.5, 0, 7); cx.fill();
        cx.beginPath(); cx.arc(0, -4, 5, Math.PI, 0); cx.stroke();
    } else if (kind === 'plinko') { // a bouncy peg: filled circle with bounce arcs
        cx.arc(0, 2, 4.5, 0, 7); cx.fill();
        cx.beginPath(); cx.arc(0, 2, 9, Math.PI * 1.15, Math.PI * 1.85); cx.stroke();
        cx.beginPath(); cx.arc(0, 2, 9, Math.PI * 0.15, Math.PI * 0.85); cx.stroke();
    } else if (kind === 'marionette') { // a puppeteer's control bar (with its handle) and the strings that hang a ball from it
        cx.lineWidth = 1.9;
        cx.moveTo(-8, -9); cx.lineTo(8, -9);
        cx.moveTo(0, -13); cx.lineTo(0, -2);
        cx.moveTo(-5.5, -9); cx.lineTo(-5.5, 1.5);
        cx.moveTo(5.5, -9); cx.lineTo(5.5, 1.5);
        cx.stroke();
        cx.beginPath(); cx.arc(0, 6.5, 5.5, 0, 7); cx.fill();
    } else if (kind === 'decoy') { // a solid ball and a dashed copy of it
        cx.arc(-3, 4, 5.5, 0, 7); cx.fill();
        cx.beginPath(); cx.lineWidth = 2; cx.setLineDash([2.4, 2.4]); cx.arc(4, -3, 6, 0, 7); cx.stroke();
    } else if (kind === 'arrow') { // an arrow pointing up-right
        cx.lineWidth = 2.2;
        cx.moveTo(-7, 7); cx.lineTo(7, -7);
        cx.moveTo(0, -7); cx.lineTo(7, -7); cx.lineTo(7, 0);
        cx.moveTo(-7, 1); cx.lineTo(-7, 7); cx.lineTo(-1, 7);
        cx.stroke();
    } else if (kind === 'bat') { // a bat: knob bottom-left, barrel top-right
        cx.lineWidth = 2.2; cx.moveTo(-8, 8); cx.lineTo(-2.5, 2.5); cx.stroke();
        cx.beginPath(); cx.lineWidth = 6; cx.moveTo(-1, 1); cx.lineTo(7, -7); cx.stroke();
        cx.beginPath(); cx.arc(-8.5, 8.5, 1.7, 0, 7); cx.fill();
    } else if (kind === 'barbwire') { // a strand of wire with two X-shaped barbs
        cx.lineWidth = 2;
        cx.moveTo(-9, 6); cx.lineTo(9, -6);
        cx.stroke();
        cx.beginPath(); cx.lineWidth = 1.8;
        for (const [bx, by] of [[-3.6, 2.4], [3.6, -2.4]]) {
            cx.moveTo(bx - 4, by - 4); cx.lineTo(bx + 4, by + 4);
            cx.moveTo(bx - 4, by + 4); cx.lineTo(bx + 4, by - 4);
        }
        cx.stroke();
    } else if (kind === 'explode') { // a solid core with four arrowheads pointing away from it
        cx.arc(0, 0, 3.2, 0, 7); cx.fill();
        cx.beginPath(); cx.lineWidth = 2.2; cx.lineCap = 'round'; cx.lineJoin = 'round';
        for (let n = 0; n < 4; n++) {
            const a = Math.PI / 4 + n * Math.PI / 2, tx = Math.cos(a) * 11, ty = Math.sin(a) * 11;
            cx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); cx.lineTo(tx, ty);
            cx.moveTo(tx + Math.cos(a + 2.5) * 5, ty + Math.sin(a + 2.5) * 5); cx.lineTo(tx, ty); cx.lineTo(tx + Math.cos(a - 2.5) * 5, ty + Math.sin(a - 2.5) * 5);
        }
        cx.stroke();
    } else if (kind === 'awakened') { // a solid core with rays all round it: powered up
        cx.arc(0, 0, 4, 0, 7); cx.fill();
        cx.beginPath(); cx.lineWidth = 2; cx.lineCap = 'round';
        for (let n = 0; n < 8; n++) {
            const a = n * Math.PI / 4, r0 = n % 2 ? 7 : 6.5, r1 = n % 2 ? 9 : 11;
            cx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); cx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        }
        cx.stroke();
    } else if (kind === 'warp') { // a solid ring, a dashed ring, and an arrow from one to the other
        cx.lineWidth = 2;
        cx.arc(-5, 5, 4.2, 0, 7); cx.stroke();
        cx.beginPath(); cx.setLineDash([2.2, 2.2]); cx.arc(5.5, -5.5, 4.6, 0, 7); cx.stroke(); cx.setLineDash([]);
        cx.beginPath(); cx.lineWidth = 1.8;
        cx.moveTo(-2, 2); cx.lineTo(2, -2);
        cx.moveTo(-0.5, -2.5); cx.lineTo(2.2, -2.2); cx.lineTo(2.5, 0.5);
        cx.stroke();
    } else if (kind === 'hopper') { // two surfaces with an arrow bouncing between them
        cx.lineWidth = 2.4;
        cx.moveTo(-9, -9); cx.lineTo(9, -9);
        cx.moveTo(-9, 9); cx.lineTo(9, 9);
        cx.moveTo(0, -5); cx.lineTo(0, 5);
        cx.moveTo(-3.5, -1.5); cx.lineTo(0, -5); cx.lineTo(3.5, -1.5);
        cx.moveTo(-3.5, 1.5); cx.lineTo(0, 5); cx.lineTo(3.5, 1.5);
        cx.stroke();
    } else if (kind === 'boomerang') { // two surfaces with an arrow bouncing between them
        cx.lineWidth = 2.4;
        cx.moveTo(8, -9); 
        cx.lineTo(-5, 0); 
        cx.lineTo(8, 9);
        cx.stroke();
    } else if (kind === 'portal') { // a ring with an arrow pointing out of it
        cx.lineWidth = 2;
        cx.arc(0, 2, 8, 0, 7); cx.stroke();
        cx.beginPath(); cx.moveTo(0, 6); cx.lineTo(0, -9);
        cx.moveTo(-4, -5); cx.lineTo(0, -9); cx.lineTo(4, -5);
        cx.stroke();
    } else if (kind === 'swap') { // two dots trading places along two curved arrows
        cx.lineWidth = 2;
        cx.arc(-7, 0, 2.6, 0, 7); cx.fill();
        cx.beginPath(); cx.arc(7, 0, 2.6, 0, 7); cx.fill();
        cx.beginPath(); cx.arc(0, 0, 7, Math.PI * 1.15, Math.PI * 1.85); cx.stroke();
        cx.beginPath(); cx.arc(0, 0, 7, Math.PI * 0.15, Math.PI * 0.85); cx.stroke();
        cx.beginPath(); cx.moveTo(4, -9); cx.lineTo(7, -6); cx.lineTo(3.5, -4.5);
        cx.moveTo(-4, 9); cx.lineTo(-7, 6); cx.lineTo(-3.5, 4.5);
        cx.stroke();
    } else if (kind === 'smoke') { // three overlapping puffs
        cx.arc(-4.5, 3, 5, 0, 7); cx.fill();
        cx.beginPath(); cx.arc(4.5, 3.5, 4.5, 0, 7); cx.fill();
        cx.beginPath(); cx.arc(0, -3.5, 6, 0, 7); cx.fill();
    } else if (kind === 'pong') { // a ball rebounding off a flat surface
        cx.lineWidth = 2.4;
        cx.moveTo(-9, 9); cx.lineTo(9, 9);
        cx.moveTo(-9, -9); cx.lineTo(-3, 6); cx.lineTo(3, -2);
        cx.stroke();
        cx.beginPath(); cx.arc(6, -6, 3.6, 0, 7); cx.fill();
    } else if (kind === 'mines') { // a mine sitting on the ground: a dome with a light and studs
        cx.lineWidth = 2.4;
        cx.moveTo(-10, 8); cx.lineTo(10, 8);
        cx.moveTo(0, -3); cx.lineTo(0, -8);
        cx.moveTo(-6, -1); cx.lineTo(-9, -5);
        cx.moveTo(6, -1); cx.lineTo(9, -5);
        cx.stroke();
        cx.beginPath(); cx.arc(0, 8, 7, Math.PI, 0); cx.fill();
    } else if (kind === 'split') { // mitosis: a cell pinched in two, a nucleus in each half
        const a = Math.atan2(3.317, 5);
        cx.lineWidth = 2.2;
        cx.moveTo(0, -3.317);
        cx.arc(-5, 0, 6, -a, a, true);
        cx.arc(5, 0, 6, Math.PI - a, -(Math.PI - a), true);
        cx.closePath(); cx.stroke();
        cx.beginPath(); cx.arc(-5, 0, 2, 0, 7); cx.fill();
        cx.beginPath(); cx.arc(5, 0, 2, 0, 7); cx.fill();
    } else if (kind === 'fighter') { // a fist: four knuckles on a palm, finger lines and a thumb
        cx.lineWidth = 2;
        cx.roundRect(-9, -2, 18, 12, 3); cx.stroke();
        cx.beginPath();
        for (const kx of [-5.5, -1.8, 1.8, 5.5]) { // knuckles
            cx.moveTo(kx + 3, -5); cx.arc(kx, -5, 3, 0, 7);
        }
        cx.fill();
        cx.beginPath(); cx.lineWidth = 1.6;
        for (const fx of [-3.6, 0, 3.6]) { cx.moveTo(fx, -2); cx.lineTo(fx, 4); } // finger dividers
        cx.moveTo(-9, 6); cx.lineTo(3, 6);                                          // thumb across the fingers
        cx.stroke();
    } else if (kind === 'accelerator') { // three nodes joined by lines
        cx.lineWidth = 2;
        cx.moveTo(-8, 6); cx.lineTo(0, -8); cx.lineTo(8, 6); cx.closePath(); cx.stroke();
        for (const [nx, ny] of [[-8, 6], [0, -8], [8, 6]]) {
            cx.beginPath(); cx.arc(nx, ny, 2.8, 0, 7); cx.fill();
        }
    } else if (kind === 'builder') { // a block and a slope stacked
      cx.lineWidth = 2;
      cx.strokeRect(-9, -2, 10, 10);
      cx.beginPath(); cx.moveTo(1, 8); cx.lineTo(9, 8); cx.lineTo(1, -2); cx.closePath(); cx.stroke();
    } else if (kind === 'reel') { // a fishing rod, its reel, and the line down to a hook
        cx.lineWidth = 2.2;
        cx.moveTo(-9, 9); cx.lineTo(8, -8);                       // the rod
        cx.moveTo(-2, 2); cx.lineTo(0.5, 4.5);                    // the reel's mount
        cx.moveTo(8, -8); cx.lineTo(8, 2);                        // the line
        cx.arc(6, 2, 2, 0, Math.PI * 0.9);                        // the hook
        cx.stroke();
        cx.beginPath(); cx.lineWidth = 1.9;
        cx.arc(2, 6, 3.6, 0, 7); cx.stroke();                     // the reel body
        cx.beginPath(); cx.arc(2, 6, 1.2, 0, 7); cx.fill();       // its hub
    } else if (kind === 'locked') { // padlock
        cx.fillRect(-6, -1, 12, 9);
        cx.beginPath(); cx.arc(0, -2, 4.5, Math.PI, 0); cx.stroke();
    } else { // dash: double chevron
        cx.lineWidth = 2.8;
        cx.moveTo(-9, -7); cx.lineTo(-2, 0); cx.lineTo(-9, 7);
        cx.moveTo(1, -7); cx.lineTo(8, 0); cx.lineTo(1, 7);
        cx.stroke();
    }
    cx.restore();
}
const HINT_ARROW = { up: 'ArrowUp', l: 'ArrowLeft', dn: 'ArrowDown', r: 'ArrowRight' };
const hintKeys = (seat, acts) => acts.map(a => { // corner labels for a seat, straight from its current bindings
    const t = keybinds.map[seat][a];
    return t === HINT_ARROW[a] ? '' : keyLabel(t, false); // the arrow is already drawn on the cap, so only label the key if it's something else
});
// Layout of the key blocks on the wall. The solid wall is only GOAL_Y0 (= 384) tall (the tunnel opens below it), so two stacked blocks have to be compact:
// each block is about 176 px tall (name 63 -> labels 239 before the shift), HINT_DY lifts the first block to the top of the wall, HINT_ROW_H is the step down to a team's second block.
// special-menu.js reads HINT_ACT_Y / HINT_DY to place the special keycap's click area and its dropdown, so change them here only.
const HINT_DY = -55, HINT_ROW_H = 186, HINT_ACT_Y = 203, HINT_LABEL_Y = 239; // first block's shift, step to the second block, centre of the grapple / weight / special row, baseline of their labels
const wallX = t => (sideSwap(t) === 0 ? -OX / 2 : W + OX / 2); // the wall mass beside the goal this team defends
function drawKeyHints() {
    const spots = hintSpots();
    cx.textAlign = 'center';
    for (const p of players) {
        const pi = p.id, spot = spots[pi], x = wallX(spot.wall), col = p.color, name = playerLabel(p);
        const dirs = hintKeys(pi, ['up', 'l', 'dn', 'r']), act = hintKeys(pi, ['z', 'x', 'sp', 'sp2']);
        const row = spot.row, hasMenu = row === 0; // the special dropdown is too tall for the second row: those players use Menu > Game
        cx.save();
        cx.translate(0, HINT_DY + row * HINT_ROW_H);
        const k = smokeHidesKeys(p) ? noKeys() : p.keys; // Smoke Screen: the other team sees no key pressed
        cx.font = 'italic 800 18px system-ui, sans-serif';
        cx.fillStyle = col;
        cx.fillText(name, x, 76);
        const KEY = 34, PT = 38; // arrow cluster: up on top, left / down / right below
        const keys = [[0, 105 - 143, 0, k.up, false, dirs[0]], [-PT, 0, -Math.PI / 2, k.l, false, dirs[1]], [0, 0, Math.PI, k.dn, false, dirs[2]], [PT, 0, Math.PI / 2, k.r, false, dirs[3]]];
        for (const [dx, dy, ang, on, dim, letter] of keys) {
            const kx = x + dx, ky = 143 + dy, yy = keyCap(kx, ky, KEY, col, on, dim);
            cx.globalAlpha = dim ? 0.35 : 1;
            arrowGlyph(kx, yy, ang, on ? '#0b0e12' : '#e8e8e4');
            if (letter) {
                cx.font = 'bold 8px system-ui, sans-serif';
                cx.fillStyle = on ? '#0b0e12' : '#98a2ad';
                cx.fillText(letter, kx + 11, yy + 13);
            }
            cx.globalAlpha = 1;
        }
        cx.font = 'bold 8px system-ui, sans-serif';
        cx.fillStyle = '#98a2ad';
        cx.fillText('MOVE / JUMP / DROP', x, 174);
        const sp = SPECIALS.find(a => a.id === p.special) || SPECIALS[0];
        const sp2 = twoSpecials ? (SPECIALS.find(a => a.id === p.special2) || SPECIALS[1]) : null;
        const actions = [['grapple', 'GRAPPLE', k.z, null], ['weight', 'WEIGHT', k.x, null], [sp.icon, sp.name, k.sp, sp]]; // main inputs, then the equipped special(s)
        if (sp2)
            actions.push([sp2.icon, sp2.name, k.sp2, sp2]);
        const n = actions.length, S = n === 4 ? 36 : 40, step = n === 4 ? 42 : 46, h = S / 2; // four caps are a little smaller so they still fit on the wall
        actions.forEach(([kind, label, on, spec], i) => {
            const kx = x + (i - (n - 1) / 2) * step, yy = keyCap(kx, HINT_ACT_Y, S, col, on, false);
            const slotOf = spec === sp ? 0 : 1; // which of the player's specials this cap is (only meaningful when spec is set)
            cx.globalAlpha = spec && spec.id === 'dash' && !p.dashReady && p.cd.dash <= 0 ? 0.3 : 1; // the dash icon dims while its once-per-trip charge is used up
            iconGlyph(kind, kx, yy - 2, on ? '#0b0e12' : '#e8e8e4');
            cx.globalAlpha = 1;
            const ab = spec ? ABILITY[spec.id] : null, cf = i === 0 ? (p.gCool > 0 ? p.gCool / GRAPPLE_COOLDOWN : 1 - p.gCharge / GRAPPLE_MAX) : ab && ab.cd ? p.cd[spec.id] / ab.cd : 0; // the grapple key tints as its meter is spent, and the whole lockout
            if (cf > 0) { // cooldown: a light gray tint over the icon whose top edge moves downward until the normal icon shows
                cx.save();
                cx.beginPath(); cx.roundRect(kx - h, yy - h, S, S, 7); cx.clip();
                cx.fillStyle = 'rgba(205,210,220,.65)';
                cx.fillRect(kx - h, yy - h + S * (1 - cf), S, S * cf);
                cx.restore();
            }
            cx.font = 'bold 8px system-ui, sans-serif';
            cx.fillStyle = on ? '#0b0e12' : '#98a2ad';
            cx.fillText(act[i], kx + h - 7, yy + h - 5);
            cx.fillStyle = '#98a2ad';
            if (!(spec && hasMenu && ui.open === pi && ui.slot === slotOf)) { // the open menu covers the label
                if (label.length > 8)
                    cx.font = 'bold 6.5px system-ui, sans-serif'; // long names (MARIONETTE) shrink to stay clear of the neighbouring labels
                cx.fillText(label, kx, HINT_LABEL_Y);
                cx.font = 'bold 8px system-ui, sans-serif';
            }
            if (spec && hasMenu && !pickFixed) { // dropdown caret on each special
                const hot = (ui.open === pi && ui.slot === slotOf) || (ui.hover && ui.hover.type === 'key' && ui.hover.i === pi && ui.hover.slot === slotOf);
                cx.fillStyle = hot ? '#fff' : on ? '#0b0e12' : '#98a2ad';
                cx.beginPath(); cx.moveTo(kx + h - 12, yy - h + 5); cx.lineTo(kx + h - 4, yy - h + 5); cx.lineTo(kx + h - 8, yy - h + 10); cx.closePath(); cx.fill();
            }
        });
        cx.restore();
    }
}

function hintSpots() { // player id -> { wall: the team whose wall it sits on, row: 0 or 1 }
    const spots = [], used = [0, 0], over = [];
    for (const t of [0, 1])
        for (const p of players.filter(q => q.team === t))
            if (used[t] < 2) spots[p.id] = { wall: t, row: used[t]++ }; else over.push(p);
    for (const p of over) {
        const w = used[0] < 2 ? 0 : 1;
        spots[p.id] = { wall: w, row: used[w]++ };
    }
    return spots;
}
function playerLabel(p) { // BLUE, BLUE 2, RED...
    const mates = players.filter(q => q.team === p.team), n = mates.indexOf(p);
    return (p.team === 0 ? 'BLUE' : 'RED') + (n > 0 ? ' ' + (n + 1) : '');
}
