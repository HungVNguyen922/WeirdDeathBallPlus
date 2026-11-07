// RENDER - the special-ability dropdown next to each player's keycaps (hit-testing lives here too, so input.js can use it), plus the Menu tile below Blue's keys.
// ---- Special-ability dropdown: click the special keycap to open a list of ability icons, click one to equip it. Add new abilities to SPECIALS. ----
const SPECIALS = [
    { id: 'dash', name: 'DASH', icon: 'dash' },
    { id: 'plinko', name: 'PLINKO', icon: 'plinko' },
    { id: 'marionette', name: 'MARIONETTE', icon: 'marionette' },
    { id: 'decoy', name: 'DECOY', icon: 'decoy' },
    { id: 'arrow', name: 'ARROW', icon: 'arrow' },
    { id: 'bat', name: 'BAT', icon: 'bat' },
    { id: 'barbwire', name: 'BARBWIRE', icon: 'barbwire' },
    { id: 'warp', name: 'WARP', icon: 'warp' },
    { id: 'awakened', name: 'AWAKENED', icon: 'awakened' },
    { id: 'explode', name: 'EXPLODE', icon: 'explode' },
    { id: 'hopper', name: 'HOPPER', icon: 'hopper' },
    { id: 'boomerang', name: 'BOOMERANG', icon: 'boomerang' },
    { id: 'portal', name: 'PORTAL', icon: 'portal' },
    { id: 'swap', name: 'SWAP', icon: 'swap' },
    { id: 'smoke', name: 'SMOKE', icon: 'smoke' },
    { id: 'pong', name: 'PONG', icon: 'pong' },
    { id: 'mines', name: 'MINES', icon: 'mines' },
    { id: 'split', name: 'SPLIT', icon: 'split' },
    { id: 'accelerator', name: 'ACCELERATOR', icon: 'accelerator' },
    { id: 'builder', name: 'BUILDER', icon: 'builder' },
    { id: 'reel', name: 'REEL', icon: 'reel' },
    
    { id: 'fighter', name: 'FIGHTER', icon: 'fighter', get locked() { return !twoSpecials; } },
    
];

const ui = { open: -1, slot: 0, hover: null, scroll: 0, wheel: 0 }; // open = index of the player whose menu is open (-1 = none), slot = which of their specials it edits (0 first, 1 second), scroll = index of the first entry shown when the list is too tall to fit, wheel = wheel movement not yet used up
const spCx = slot => (twoSpecials ? (slot ? 63 : 21) : 46); // centre of a special's cap, from the block's centre (the caps move when there are four)
const spSz = () => (twoSpecials ? 36 : 40);
const SP_ROW = 30; // height of one entry in the special dropdown (20 entries of 32 would run off the bottom of the canvas)
const spotOf = id => hintSpots()[id] || { wall: id % 2, row: 0 };
const spKey = (i, slot = 0) => { const s = spotOf(i); return { x: wallX(s.wall) + spCx(slot) - spSz() / 2, y: HINT_ACT_Y + HINT_DY + s.row * HINT_ROW_H - spSz() / 2, w: spSz(), h: spSz() }; };
// ---- the list scrolls when it would run off the bottom of the arena: a window of rows, with an up arrow row on top and a down arrow row at the bottom while there is more in that direction.
// Wheel over the list, or click an arrow row. (Everything below reads the window from spWin, so the drawing and the hit-testing cannot disagree.)
const spTop = i => HINT_ACT_Y + HINT_DY + spotOf(i).row * HINT_ROW_H + 25; // y of the first row
const spRows = i => Math.max(5, Math.min(SPECIALS.length, Math.floor((H - 8 - spTop(i)) / SP_ROW))); // how many rows fit above the floor (never fewer than 5)
const spScrolls = i => spRows(i) < SPECIALS.length;
const spPage = i => (spScrolls(i) ? spRows(i) - 2 : SPECIALS.length); // entries shown at once (a scrolling list gives two of its rows to the arrows)
const spMax = i => SPECIALS.length - spPage(i); // the furthest the list can scroll
const spFirst = i => (i === ui.open && spScrolls(i) ? Math.max(0, Math.min(spMax(i), ui.scroll)) : 0); // first entry shown
const spItem = (i, n, slot = 0) => { const s = spotOf(i), off = spScrolls(i) ? 1 : 0; return { x: wallX(s.wall) + spCx(slot) - 20, y: spTop(i) + (n - spFirst(i) + off) * SP_ROW, w: 40, h: SP_ROW }; };
const spArrow = (i, dir, slot = 0) => { const r = spItem(i, 0, slot); r.y = spTop(i) + (dir < 0 ? 0 : (spRows(i) - 1) * SP_ROW); return r; }; // the up (-1) / down (+1) arrow row
const spList = (i, slot = 0) => { const r = spItem(i, 0, slot); r.y = spTop(i); r.h = (spScrolls(i) ? spRows(i) : SPECIALS.length) * SP_ROW; return r; }; // the whole list
function spScrollBy(d) { // move the open list by d entries (clamped)
    if (ui.open >= 0)
        ui.scroll = Math.max(0, Math.min(spMax(ui.open), spFirst(ui.open) + d));
}
function spOpen(i, slot) { // open i's list for a slot, scrolled so the equipped ability is in view
    ui.open = i;
    ui.slot = slot;
    ui.wheel = 0;
    const cur = SPECIALS.findIndex(a => a.id === (slot ? allPlayers[i].special2 : allPlayers[i].special)), page = spPage(i);
    ui.scroll = cur < 0 || cur < page ? 0 : Math.min(spMax(i), cur - Math.floor(page / 2));
}
function spWheel(dy) { // a wheel / touchpad movement over the list: about one entry per notch (small touchpad movements add up)
    ui.wheel += dy;
    const n = Math.trunc(ui.wheel / 40);
    if (n) {
        ui.wheel -= n * 40;
        spScrollBy(n);
    }
}
const menuKey = () => ({ x: W / 2 - 60, y: H + 104, w: 120, h: 24 }); // the Menu button: a pill on the floor, centred under the online status line
const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
function uiHit(x, y) {
    if (ui.open >= 0) {
        const i = ui.open, first = spFirst(i);
        if (spScrolls(i))
            for (const dir of [-1, 1])
                if (inRect(spArrow(i, dir, ui.slot), x, y))
                    return { type: 'scroll', dir, i, slot: ui.slot };
        for (let n = first; n < Math.min(SPECIALS.length, first + spPage(i)); n++)
            if (inRect(spItem(i, n, ui.slot), x, y))
                return { type: 'item', i, n, slot: ui.slot };
    }
    for (const p of players)
        if (!pickFixed && spotOf(p.id).row === 0)
            for (const slot of twoSpecials ? [0, 1] : [0])
                if (inRect(spKey(p.id, slot), x, y))
                    return { type: 'key', i: p.id, slot };
    if (inRect(menuKey(), x, y))
        return { type: 'menu' };
    return null;
}
function closeSpecialMenu() { ui.open = -1; ui.scroll = 0; ui.wheel = 0; }
function drawMenuTile() { // the Menu button (the panel itself is page UI, see menu.js)
    const r = menuKey(), hot = !!(ui.hover && ui.hover.type === 'menu'), on = typeof gameMenu !== 'undefined' && gameMenu.isOpen();
    const col = on ? '#0b0e12' : hot ? '#ffffff' : '#e8e8e4', my = r.y + r.h / 2;
    cx.save();
    cx.fillStyle = on ? EDGE : hot ? '#2e1a52' : '#1a0e30';
    cx.strokeStyle = on ? '#fff' : hot ? '#c9b8f0' : '#a893d4';
    cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(r.x, r.y, r.w, r.h, 8); cx.fill(); cx.stroke();
    cx.strokeStyle = col; cx.lineWidth = 2; cx.lineCap = 'round'; // hamburger icon
    cx.beginPath();
    for (const dy of [-4, 0, 4])
        line(r.x + 14, my + dy, r.x + 26, my + dy);
    cx.stroke();
    cx.textBaseline = 'middle';
    cx.textAlign = 'left';
    cx.font = 'bold 11px system-ui, sans-serif'; cx.fillStyle = col;
    cx.fillText('MENU', r.x + 34, my + 1);
    cx.textAlign = 'right';
    cx.font = 'bold 8px system-ui, sans-serif'; cx.fillStyle = on ? '#0b0e12' : '#98a2ad';
    cx.fillText('ESC', r.x + r.w - 10, my + 1); // the key that also opens it
    cx.restore();
}
function drawSpecialMenu() {
    if (ui.open < 0)
        return;
    const i = ui.open, p = allPlayers[i], col = p.color, L = spList(i, ui.slot), r0 = L, hv = ui.hover, cur = ui.slot ? p.special2 : p.special;
    const first = spFirst(i), last = Math.min(SPECIALS.length, first + spPage(i)), scrolls = spScrolls(i);
    cx.save();
    cx.fillStyle = '#12081f'; cx.strokeStyle = col; cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(L.x - 3, L.y - 2, L.w + 6, L.h + 4, 8); cx.fill(); cx.stroke();
    if (scrolls) {
        for (const dir of [-1, 1]) { // the arrow rows: dim when there is nothing more that way
            const r = spArrow(i, dir, ui.slot), more = dir < 0 ? first > 0 : first < spMax(i), hot = hv && hv.type === 'scroll' && hv.dir === dir && more;
            if (hot) {
                cx.fillStyle = 'rgba(255,255,255,.12)';
                cx.beginPath(); cx.roundRect(r.x, r.y + 1, r.w, r.h - 2, 6); cx.fill();
            }
            cx.globalAlpha = more ? 1 : 0.25;
            cx.strokeStyle = '#e8e8e4'; cx.lineWidth = 2.4; cx.lineCap = 'round'; cx.lineJoin = 'round';
            const mx = r.x + r.w / 2, my = r.y + r.h / 2;
            cx.beginPath(); cx.moveTo(mx - 7, my - dir * 3); cx.lineTo(mx, my + dir * 3); cx.lineTo(mx + 7, my - dir * 3); cx.stroke(); // ^ for up, v for down
            cx.globalAlpha = 1;
        }
        const span = (spPage(i)) * SP_ROW, th = Math.max(14, span * spPage(i) / SPECIALS.length), ty = L.y + SP_ROW + (span - th) * (spMax(i) ? first / spMax(i) : 0); // a thin scroll thumb on the right edge
        cx.fillStyle = col + 'aa';
        cx.beginPath(); cx.roundRect(L.x + L.w - 1, ty, 3, th, 1.5); cx.fill();
    }
    SPECIALS.forEach((a, n) => {
        if (n < first || n >= last)
            return;
        const r = spItem(i, n, ui.slot), hot = hv && hv.type === 'item' && hv.i === i && hv.n === n, sel = cur === a.id;
        if (hot || sel) {
            cx.fillStyle = sel ? col + '66' : 'rgba(255,255,255,.12)';
            cx.beginPath(); cx.roundRect(r.x, r.y + 1, r.w, r.h - 2, 6); cx.fill();
        }
        cx.globalAlpha = a.locked ? 0.45 : 1;
        iconGlyph(a.icon, r.x + r.w / 2, r.y + r.h / 2, '#e8e8e4');
        cx.globalAlpha = 1;
        if (hot) { // name of the hovered ability, beside the menu
            cx.font = 'bold 9px system-ui, sans-serif'; cx.textAlign = 'right'; cx.fillStyle = '#e8e8e4';
            cx.fillText(a.name, r0.x - 9, r.y + r.h / 2 + 3);
        }
    });
    cx.restore();
}