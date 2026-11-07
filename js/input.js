// INPUT - keyboard bindings, the AI toggle buttons / keys, and mouse clicks on the special-ability menu and the Menu tile.
const AI_NAMES = ['Blue', 'Red', 'Blue 2', 'Red 2'];
// ---- Flex (offline): any of the 4 seats on Blue, Red or off, each human or computer ----
const flex = { on: false, cfg: [{ team: 0, ai: false }, { team: 1, ai: true }, { team: -1, ai: true }, { team: -1, ai: true }] };
function applyFlex() { // push flex.cfg into the game; restarts the match
    if (net.on)
        return;
    if (!flex.cfg.some(c => c.team >= 0))
        flex.cfg[0].team = 0; // somebody has to be playing
    const ids = [], teams = [];
    flex.cfg.forEach((c, id) => { if (c.team >= 0) { ids.push(id); teams.push(c.team); } });
    pickFixed = false;
    flex.cfg.forEach((c, id) => setAI(id, c.team >= 0 && c.ai));
    setRoster(ids, teams);
    document.querySelectorAll('#keytable tr.team2').forEach((tr, k) => { tr.style.display = players.includes(allPlayers[2 + k]) ? '' : 'none'; });
}
function setFlex(on) {
    if (net.on)
        return;
    flex.on = !!on;
    if (on)
        applyFlex();
    else {
        setAI(0, false);
        setAI(1, false);
        setTeams(1); // plain 1v1 again (also puts the team colours back)
    }
}
function setAI(i, on) {
    if (net.on) // NET: online, seats are fixed
        return;
    ai[i].on = on;
    aiReset(i);
    if (!on)
        Object.assign(allPlayers[i].keys, noKeys());
    const btn = document.getElementById('ai' + i);
    btn.textContent = AI_NAMES[i] + ': ' + (on ? 'AI' : 'Human');
    btn.classList.toggle('on', on);
}
for (const i of [0, 1, 2, 3])
    document.getElementById('ai' + i).addEventListener('click', () => { setAI(i, !ai[i].on); cv.focus(); });
// ---- 1v1 / 2v2 toggle: the teammates (ids 2 and 3) start as computer players; switch them to Human to play them ----
function setTeams(size) {
    if (net.on) // NET: online matches are 1v1 for now
        return;
    flex.on = false;
    setTeamSize(size);
    setAI(2, size === 2);
    setAI(3, size === 2);
    for (const el of document.querySelectorAll('.team2'))
        el.style.display = size === 2 ? '' : 'none';
    const btn = document.getElementById('mode2v2');
    btn.textContent = '2v2: ' + (size === 2 ? 'On' : 'Off');
    btn.classList.toggle('on', size === 2);
}
document.getElementById('mode2v2').addEventListener('click', () => {
    if (!net.on) 
        setTeams(teamSize === 2 && !flex.on ? 1 : 2);
    else if (net.host) // online this button is the room's 2v2 lobby switch (host only; menu.js labels it)
        net.setLobby2v2(!net.lobby2v2);
    cv.focus();
});
// ---- input ----
const bindings = [ // [player, { key token -> action }]: Blue, Red, Blue's teammate, Red's teammate (2v2). The keys come from keybinds.js (they can be changed on the Controls tab and are remembered)
    [p1, {}], [p2, {}], [p3, {}], [p4, {}],
];
function refreshBindings() { // rebuild the tables from keybinds.map (the same objects are refilled, so anything holding one, like net/client.js's NET_KEYMAP, only has to copy again)
    bindings.forEach(([, m], seat) => {
        for (const k in m)
            delete m[k];
        for (const a of KEY_ACTIONS)
            m[keybinds.map[seat][a]] = a;
    });
    allPlayers.forEach(p => Object.assign(p.keys, noKeys())); // a key held while its binding changes must not stay stuck down
    if (typeof net !== 'undefined' && net.on) { // (net/client.js loads after this file, so the very first call runs before it exists)
        Object.assign(net.keys, noKeys());
        net.sendKeys();
    }
}
keybinds.listeners.push(refreshBindings);
refreshBindings();
function setKey(e, v) {
    if (net.on) { // NET: online, my keys go to the server instead of to a local player
        netKeyEvent(e, v);
        return;
    }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key, token = keyToken(e);
    for (const [pl, m] of bindings) {
        const n = players.includes(pl) && m[token]; // only players in the current match listen
        if (n) {
            pl.keys[n] = v;
            e.preventDefault();
        }
    }
    if (v && key === 'Escape')
        closeSpecialMenu();
    const digit = /^Digit([1-4])$/.exec(e.code); // top-row 1-4 toggle each player's AI (3 and 4 only exist in 2v2)
    if (v && !e.repeat && digit && +digit[1] <= players.length)
        setAI(+digit[1] - 1, !ai[+digit[1] - 1].on);
    if (v && !e.repeat && key === 't')
        setTeams(teamSize === 2 ? 1 : 2);
    if (v && key === 'r')
        resetMatch();
}
window.addEventListener('keydown', e => setKey(e, true));
window.addEventListener('keyup', e => setKey(e, false));
window.addEventListener('blur', () => allPlayers.forEach(p => Object.assign(p.keys, noKeys())));
// ---- mouse: special-ability menu and the Menu tile ----
const arenaPos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width - OX, (e.clientY - r.top) * cv.height / r.height - HUD]; };
cv.addEventListener('mousemove', e => { ui.hover = uiHit(...arenaPos(e)); cv.style.cursor = ui.hover ? 'pointer' : ''; });
cv.addEventListener('mouseleave', () => { ui.hover = null; cv.style.cursor = ''; });
cv.addEventListener('wheel', e => { // a long special list scrolls with the wheel / touchpad while the pointer is over it
    if (ui.open < 0)
        return;
    const [x, y] = arenaPos(e);
    if (!inRect(spList(ui.open, ui.slot), x, y))
        return;
    e.preventDefault();
    spWheel(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY); // (line-mode wheels report lines, not pixels)
    ui.hover = uiHit(x, y);
}, { passive: false });
cv.addEventListener('click', e => {
    const h = uiHit(...arenaPos(e));
    if (!h)
        closeSpecialMenu();
    else if (h.type === 'menu') { // the tile under Blue's keys: open the Menu panel (menu.js)
        closeSpecialMenu();
        gameMenu.open();
    } else if (h.type === 'key') {
        if (!net.on || h.i === net.slot) { // NET: online you can only change your own special
            const same = ui.open === h.i && ui.slot === h.slot;
            if (same)
                closeSpecialMenu();
            else
                spOpen(h.i, h.slot);
        }
    } else if (h.type === 'scroll') { // an arrow row of a long list: scroll, keep it open
        spScrollBy(h.dir * 3);
    } else if (!SPECIALS[h.n].locked) {
        if (net.on)
            net.setSpecial(SPECIALS[h.n].id, h.slot);
        else
            equipSpecial(allPlayers[h.i], h.slot, SPECIALS[h.n].id);
        closeSpecialMenu();
    }
});
cv.addEventListener('click', () => cv.focus()); // so keys go to the game after a click
