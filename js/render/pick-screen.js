// RENDER - the special-ability pick screen: a fighting-game style select grid (PICK_COLS icons per row) with a round badge per player that glides from icon to icon, and a panel on the
// side for every player (one big panel for a team of one, two stacked panels for a team of two).
// Read-only on game state: everything it shows comes from `pick` (game/rules.js). Drawn over the playing area only, so the wall panels, the Menu tile and the score stay visible.
const PICK_DESC = { // two short lines under the highlighted special
    dash: ['A burst the way you steer.', 'Recharges on the floor.'],
    plinko: ['Drops a bouncy peg where', 'you stand. Two at a time.'],
    marionette: ['Hold, aim with the arrows,', 'release to shove the ball.'],
    decoy: ['Casts a lookalike ball that', 'never kills. One at a time.'],
    arrow: ['Hold to charge, release to', 'fire. Shoves ball and foes.'],
    bat: ['Hold to charge, release to', 'swing a half-circle. Full', ' swing overcharges opponents.'],
    barbwire: ['Your grapple rope kills', 'any player it touches.'],
    warp: ['Press to mark a spot, press', 'again to teleport there.'],
    awakened: ['Unkillable, endless grapple,', '3x crash power. Lasts 10 s.'],
    explode: ['Blasts discs and balls away.', 'Kill in 5 s: cooldown reset.'],
    hopper: ['Stick to walls and ceiling.', 'Special hops to the far side.'],
    boomerang: ['Curving throw that returns.', 'Nudges things. Up to 10 out.'],
    swap: ['Hold, turn the cone, release:', 'trade places. Weight = furthest.'],
    smoke: ['A cloud hides you from the', 'enemy, keys too. Lasts 5 s.'],
    portal: ['Hold, turn with the arrows,', 'release. Two linked portals.'],
    pong: ['Rubber floor and walls: spin', 'grips and the flick is x2.'],
    mines: ['Plant mines on surfaces (1 s).', 'Hold special + weight: blast.'],
    accelerator: ['Press to drop nodes. Lines link', 'every node; crossing one speeds', 'you up, and the ball you held.'],
    split: ['Halve yourself, leave a copy.', 'Touch a copy to merge back.', 'Weight + key: swap bodies.'],
    builder: ['Press to drop a block where you', 'stand. Hold special + weight:', 'remove the block you last placed.'],
    fighter: ['Takes both slots. P / K buttons,', 'motion inputs like 236 + a button.'], 
    reel: ['Hold special + weight to pull', 'yourself toward your grapple.'],
};
const pickSp = id => SPECIALS.find(a => a.id === id) || SPECIALS[0];
const PICK_NAMES = ['BLUE', 'RED', 'BLUE 2', 'RED 2']; // by player id
const PICK_CORNER = id => ({ x: id % 2, y: id >> 1 }); // which corner of an icon a player's badge sits on: Blue left, Red right, a team's first player on top, its second below
function drawPickBadge(x, y, p, ready, t) { // the player's marker: a round badge in the team colour with the player's number (1 or 2 in the team), a tick once locked in
    const pulse = ready ? 1 : 1 + 0.06 * Math.sin(t / 130 + p.id);
    cx.save();
    cx.translate(x, y); cx.scale(pulse, pulse);
    cx.fillStyle = p.color; cx.strokeStyle = '#0b0e12'; cx.lineWidth = 3;
    cx.beginPath(); cx.arc(0, 0, 11, 0, 7); cx.stroke(); cx.fill();
    cx.strokeStyle = 'rgba(255,255,255,.85)'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.arc(0, 0, 11, 0, 7); cx.stroke();
    cx.fillStyle = '#0b0e12'; cx.strokeStyle = '#0b0e12';
    if (ready) { // locked in: tick
        cx.lineWidth = 2.6; cx.lineCap = 'round'; cx.lineJoin = 'round';
        cx.beginPath(); cx.moveTo(-4.5, 0.5); cx.lineTo(-1, 4); cx.lineTo(5, -3.5); cx.stroke();
    } else {
        cx.font = 'bold 13px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(String((p.id >> 1) + 1), 0, 1);
    }
    cx.restore();
}
const PICK_ICON_EXT = 14; // how far (u, stroke included) any icon glyph reaches from its centre (the tallest are about 13): the name is placed below this
function drawPickPanel(p, x, y, w, h, compact) { // one player's panel: badge, name, big icon, what it does, and whether they are locked in
    const col = p.color, sp = pickSp(PICK_LIST[pick.cur[p.id]]), ready = pick.ready[p.id], mid = x + w / 2, tm = performance.now();
    const L = compact // two stacked panels on a side are the small version
        ? { title: 24, tf: 17, icon: 62, is: 2.6, nf: 14, dg: 16, ds: 13, df: 10.5, status: h - 12 }
        : { title: 32, tf: 22, icon: 92, is: 4.2, nf: 17, dg: 20, ds: 14, df: 11, status: h - 18 };
    L.name = L.icon + PICK_ICON_EXT * L.is + L.nf; // the name sits under the icon's lowest possible edge, so no icon can ever run into it
    L.desc = L.name + L.dg;
    cx.save();
    cx.fillStyle = 'rgba(255,255,255,.04)'; cx.strokeStyle = col; cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(x, y, w, h, 10); cx.fill(); cx.stroke();
    cx.textAlign = 'center';
    cx.font = 'italic 800 ' + L.tf + 'px system-ui, sans-serif'; cx.fillStyle = col;
    cx.fillText(PICK_NAMES[p.id], mid, y + L.title);
    drawPickBadge(x + 24, y + L.title - L.tf * 0.35, p, ready, tm); // the same badge as on the grid, so the panel and the marker belong together
    cx.save(); cx.translate(mid, y + L.icon); cx.scale(L.is, L.is); iconGlyph(sp.icon, 0, 0, '#e8e8e4'); cx.restore();
    cx.textAlign = 'center';
    cx.font = 'bold ' + L.nf + 'px system-ui, sans-serif'; cx.fillStyle = '#fff';
    cx.fillText(sp.name, mid, y + L.name);
    cx.font = L.df + 'px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
    (PICK_DESC[sp.id] || []).forEach((l, i) => cx.fillText(l, mid, y + L.desc + i * L.ds));
    cx.font = 'bold ' + (compact ? 11 : 12) + 'px system-ui, sans-serif';
    cx.fillStyle = ready ? '#7ee787' : col;
    if (twoSpecials && (pick.stage[p.id] === 1 || ready)) { // the first pick, small, to the left of the big icon
        cx.save(); cx.translate(x + 30, y + L.icon); cx.scale(L.is * 0.4, L.is * 0.4); iconGlyph(pickSp(p.special).icon, 0, 0, '#98a2ad'); cx.restore();
        cx.font = 'bold 9px system-ui, sans-serif'; cx.fillStyle = '#98a2ad'; cx.textAlign = 'center';
        cx.fillText('1ST', x + 30, y + L.icon + 26);
    }
    cx.fillText(ready ? 'LOCKED IN' : ai[p.id].on && !net.on ? 'AI' : twoSpecials ? 'CHOOSING ' + (pick.stage[p.id] + 1) + ' / 2' : 'CHOOSING...', mid, y + L.status);
    cx.restore();
}
const pickBadges = []; // where each player's badge is drawn right now ({ x, y } per player id): it eases toward the icon the player is on, so it glides from icon to icon. Screen-only state.
let pickBadgeAt = 0;
// Full-width banner: a torn strip of paper across the whole screen with flame lettering that slams in.
// Paste this above drawPickScreen() in js/render/pick-screen.js.
// prog (0 -> 1) comes from simulation timers (pick.go, swapBanner), not the wall clock, so every client sees the same frame;
// only the flame shimmer uses `tm` (display-only, like the pulse it replaces).
function drawGetReadyBanner(tm) { // the countdown after the last lock-in on a pick screen
    drawBanner('GET READY', 1 - pick.go / PICK_GO_T, tm);
}
function drawSideChangeBanner(tm) { // the freeze when the teams trade ends (see swapBanner in game/rules.js)
    if (swapBanner > 0)
        drawBanner('SIDE CHANGE', 1 - swapBanner / SWAP_BANNER_T, tm);
}
function drawBanner(TXT, progIn, tm) {
    const TILT = -0.045, BH = 76, BAND = 30; // strip tilt (rad), half-height of the paper (u), how far the coloured band reaches past the paper (u)
    const prog = Math.min(1, Math.max(0, progIn)); // 0 -> 1 across the banner's time
    const slam = Math.min(1, prog / 0.18), e = 1 - Math.pow(1 - slam, 3); // 0 -> 1 over the first 18%, easing out
    const shake = prog > 0.18 && prog < 0.4 ? Math.sin(prog * 260) * 5 * (0.4 - prog) / 0.22 : 0; // a small jolt right after the slam lands
    const half = CW / 2 + 90; // wide enough to cover the whole canvas even after the tilt
    const edge = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); }; // fixed ragged offsets: no Math.random, so the edge never wobbles

    if (prog < 0.2) { // a quick warm flash as the strip lands
        cx.save();
        cx.globalAlpha = 0.28 * (1 - prog / 0.2);
        cx.fillStyle = '#fff4c8';
        cx.fillRect(-OX, 0, CW, H + PIT);
        cx.restore();
    }

    cx.save();
    cx.translate(W / 2 + shake, H / 2);
    cx.rotate(TILT);

    // 1) the ripples: the band's edges pushed outward as horizontal lines, above and below, one after another from the moment the strip lands
    const RIP_N = 4, RIP_DELAY = 0.07, RIP_DUR = 0.5, RIP_REACH = 230; // how many, gap between them, how long each lasts (all as a share of the banner's time), how far they travel (u)
    for (let k = 0; k < RIP_N; k++) {
        const u = (prog - 0.1 - k * RIP_DELAY) / RIP_DUR;
        if (u <= 0 || u >= 1)
            continue;
        const d = BH + BAND + RIP_REACH * (1 - Math.pow(1 - u, 3)); // eases out: fast at first, then slows as it fades
        cx.globalAlpha = (1 - u) * 0.9;
        cx.lineWidth = 1.5 + 6 * (1 - u);
        cx.strokeStyle = k % 2 ? '#fff3a8' : '#ff9a1f';
        cx.beginPath();
        cx.moveTo(-half, -d); cx.lineTo(half, -d);
        cx.moveTo(-half, d); cx.lineTo(half, d);
        cx.stroke();
    }
    cx.globalAlpha = 1;

    // 2) the strip unrolls: a bright band (so no icon shows through) with the torn paper on top
    cx.save();
    cx.scale(1, e);
    cx.globalAlpha = Math.min(1, e * 1.6);
    const band = cx.createLinearGradient(0, -BH - BAND, 0, BH + BAND);
    band.addColorStop(0, '#ff9d1c'); band.addColorStop(0.5, '#ff5a3c'); band.addColorStop(1, '#ff2f7a');
    cx.fillStyle = band;
    cx.fillRect(-half, -BH - BAND, half * 2, (BH + BAND) * 2);
    cx.fillStyle = '#fff2a0'; // bright rules along the band's edges: the ripples start from them
    cx.fillRect(-half, -BH - BAND, half * 2, 4);
    cx.fillRect(-half, BH + BAND - 4, half * 2, 4);
    const STEP = 26, n = Math.ceil(half * 2 / STEP), paper = new Path2D();
    for (let i = 0; i <= n; i++) {
        const x = -half + i * STEP, y = -BH + edge(i, 1) * 16;
        if (i) paper.lineTo(x, y); else paper.moveTo(x, y);
    }
    for (let i = n; i >= 0; i--)
        paper.lineTo(-half + i * STEP, BH - edge(i, 2) * 16);
    paper.closePath();
    cx.save(); // the paper's drop shadow: a darker copy nudged down (shadowBlur on a shape this wide is slow)
    cx.translate(0, 7);
    cx.fillStyle = 'rgba(90,20,10,.35)'; cx.fill(paper);
    cx.restore();
    cx.fillStyle = '#fff3cf'; cx.fill(paper);
    const shade = cx.createLinearGradient(0, -BH, 0, BH); // paper gets a little warmer toward its torn edges
    shade.addColorStop(0, 'rgba(255,150,50,.34)'); shade.addColorStop(0.25, 'rgba(255,150,50,0)');
    shade.addColorStop(0.75, 'rgba(255,150,50,0)'); shade.addColorStop(1, 'rgba(255,150,50,.34)');
    cx.fillStyle = shade; cx.fill(paper);
    cx.strokeStyle = 'rgba(190,100,30,.6)'; cx.lineWidth = 1.5; cx.stroke(paper);
    cx.restore();

    // 3) the lettering: slants, drops in from big to normal size
    cx.save();
    cx.translate(0, 4);
    const ts = 1 + (1 - e) * 1.2;
    cx.scale(ts, ts);
    cx.globalAlpha = e;
    cx.transform(1, 0, -0.22, 1, 0, 0); // italic slant
    cx.font = '900 128px Impact, "Arial Black", system-ui, sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    const fit = Math.min(1, 1000 / cx.measureText(TXT).width); // long words shrink to stay inside about 1000 u
    cx.scale(fit, fit);
    cx.lineJoin = 'miter'; cx.miterLimit = 8; // sharp points on the outline, like the brush lettering
    cx.lineWidth = 17; cx.strokeStyle = '#2b0803'; cx.strokeText(TXT, 3, 5); // dark outline, nudged down-right as a drop shadow
    cx.lineWidth = 12; cx.strokeStyle = '#c2260c'; cx.strokeText(TXT, 0, 0); // red rim
    const flick = 0.04 * Math.sin(tm / 90); // the flame shimmers
    const g = cx.createLinearGradient(0, -64, 0, 64);
    g.addColorStop(0, '#ff3b1f');
    g.addColorStop(0.3 + flick, '#ff8a00');
    g.addColorStop(0.65 + flick, '#ffe600');
    g.addColorStop(1, '#fff7b0');
    cx.fillStyle = g; cx.fillText(TXT, 0, 0);
    cx.lineWidth = 1.6; cx.strokeStyle = 'rgba(255,255,255,.75)'; cx.strokeText(TXT, 0, 0); // thin hot highlight on the edge
    cx.restore();

    cx.restore();
}
function drawPickScreen() {
    if (!pick.on) {
        pickBadges.length = 0; // the next screen starts with the badges on their icons
        return;
    }
    const TS = 80, GAP = 14, n = PICK_LIST.length, gx = W / 2 - (PICK_COLS * TS + (PICK_COLS - 1) * GAP) / 2, gy = 150, tm = performance.now();
    const tileAt = k => { // each row is centred, so the lone Fighter tile sits in the middle
        const row = pickRows.findIndex(r => r.includes(k)), r = pickRows[row];
        return { x: gx + (PICK_COLS - r.length) * (TS + GAP) / 2 + r.indexOf(k) * (TS + GAP), y: gy + row * (TS + GAP) };
    };
    cx.save();
    cx.fillStyle = 'rgba(9,5,18,.93)'; // backdrop over the playing area, with a wash of each team's colour at its edge
    cx.fillRect(0, 0, W, H);
    const wash = cx.createLinearGradient(0, 0, W, 0);
    wash.addColorStop(0, 'rgba(' + sideRgb(0) + ',.22)'); wash.addColorStop(0.4, 'rgba(' + sideRgb(0) + ',0)');
    wash.addColorStop(0.6, 'rgba(' + sideRgb(1) + ',0)'); wash.addColorStop(1, 'rgba(' + sideRgb(1) + ',.22)');
    cx.fillStyle = wash;
    cx.fillRect(0, 0, W, H);
    cx.textAlign = 'center';
    cx.font = 'italic 800 30px system-ui, sans-serif';
    cx.lineWidth = 5; cx.strokeStyle = '#000'; cx.lineJoin = 'round';
    cx.strokeText('CHOOSE YOUR SPECIAL', W / 2, 70);
    cx.fillStyle = '#fff';
    cx.fillText('CHOOSE YOUR SPECIAL', W / 2, 70);
    cx.font = 'bold 12px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
    cx.fillText(pick.at === 0 ? 'BEFORE THE FIRST POINT' : 'AFTER ' + pick.at + ' POINTS', W / 2, 96);
    for (let k = 0; k < n; k++) { // the grid
        const r = tileAt(k), sp = pickSp(PICK_LIST[k]);
        cx.fillStyle = '#1a0e30'; cx.strokeStyle = '#4b2f7a'; cx.lineWidth = 2;
        cx.beginPath(); cx.roundRect(r.x, r.y, TS, TS, 10); cx.fill(); cx.stroke();
        cx.save(); cx.translate(r.x + TS / 2, r.y + TS / 2 - 6); cx.scale(2.3, 2.3); iconGlyph(sp.icon, 0, 0, '#e8e8e4'); cx.restore();
        cx.font = 'bold 9px system-ui, sans-serif'; cx.fillStyle = '#98a2ad'; cx.textAlign = 'center';
        cx.fillText(sp.name, r.x + TS / 2, r.y + TS - 9);
    }
    const dt = Math.min(0.1, (tm - pickBadgeAt) / 1000), ease = 1 - Math.exp(-dt * 14); // (a badge covers about 95% of the distance in 0.2 s)
    pickBadgeAt = tm;
    for (const p of players) { // one badge per player, sitting on its corner of the icon the player is on (so two players on the same icon never cover each other)
        const r = tileAt(pick.cur[p.id]), c = PICK_CORNER(p.id), tx = r.x + c.x * TS, ty = r.y + c.y * TS;
        const b = pickBadges[p.id] || (pickBadges[p.id] = { x: tx, y: ty }); // first frame: straight to its icon
        b.x += (tx - b.x) * ease;
        b.y += (ty - b.y) * ease;
        drawPickBadge(b.x, b.y, p, pick.ready[p.id], tm);
    }
    for (const t of [0, 1]) { // the side panels: a team of one gets the big panel, a team of two gets two small ones (first player on top)
        const list = players.filter(q => q.team === t), x = sideSwap(t) === 0 ? 24 : W - 24 - 190;
        if (list.length === 1)
            drawPickPanel(list[0], x, 120, 190, 250, false);
        else
            list.forEach((p, i) => drawPickPanel(p, x, 96 + i * 182, 190, 170, true));
    }
    cx.textAlign = 'center';
    cx.font = 'bold 11px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
    cx.fillText('ARROWS: MOVE     GRAPPLE OR SPECIAL: LOCK IN     WEIGHT: TAKE BACK', W / 2, 120);
    if (pick.go > 0) drawGetReadyBanner(tm);
    cx.restore();
}
