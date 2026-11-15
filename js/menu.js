// MENU - the Menu panel with three tabs: Game (AI players, 2v2, how specials are chosen, special picker, music, online), Players (online: who is on which team, host controls) and
// Controls (key bindings for every player, plus touch controls on a phone).
// It is opened from the Menu tile on Blue's wall (drawn in render/special-menu.js, clicked in input.js) or with Esc, and closed with the X, a click on the backdrop, or Esc.
// Pure page UI: the buttons inside it are the same ones input.js, music.js and net/client.js already find by id (ai0..ai3, mode2v2, music, online), so nothing else changes.
// Load after the other scripts (touch.js too), before main.js.
const gameMenu = (() => {
    const menu = document.getElementById('menu'), canvas = document.getElementById('c'), pickEl = document.getElementById('specialpick'), pickBtn = document.getElementById('pickmode'), rosterEl = document.getElementById('roster');
    if (!menu)
        return { open() {}, close() {}, refresh() {}, isOpen: () => false };
    const pickTitle = pickBtn ? pickBtn.title : '';
    // ---- Controls tab: click a key, then press the new one. The bindings live in keybinds.js (remembered in this browser); this is only the table. ----
    // The capture listener is added first and in the capture phase, so while a key is being picked nothing else (the game, Esc closing the panel, the music key) sees the press.
    const keyTable = document.getElementById('keytable'), keyMsg = document.getElementById('keymsg'), keyReset = document.getElementById('keyreset'), keyHelp = keyMsg ? keyMsg.textContent : '';
    const SEAT_ROWS = [{ name: 'Blue', cls: 'pb' }, { name: 'Red', cls: 'pr' }, { name: 'Blue 2', cls: 'pb' }, { name: 'Red 2', cls: 'pr' }];
    let capturing = null; // { seat, action } while waiting for the new key
    const setKeyMsg = t => { if (keyMsg) keyMsg.textContent = t || keyHelp; };
    function renderKeys() {
        if (!keyTable)
            return;
        keyTable.textContent = '';
        SEAT_ROWS.forEach((r, seat) => {
            const tr = document.createElement('tr'), th = document.createElement('th');
            if (seat >= 2) { // the teammates' rows show in 2v2 only (input.js's setTeams toggles every .team2 element)
                tr.className = 'team2';
                tr.style.display = typeof teamSize !== 'undefined' && teamSize === 2 ? '' : 'none';
            }
            th.className = r.cls;
            th.textContent = r.name;
            tr.appendChild(th);
            for (const a of KEY_ACTIONS) {
                const td = document.createElement('td'), b = document.createElement('button'), on = !!capturing && capturing.seat === seat && capturing.action === a;
                b.type = 'button';
                b.className = 'keycell' + (on ? ' capturing' : '');
                b.textContent = on ? 'press…' : keyName(keybinds.map[seat][a]);
                b.title = KEY_ACTION_NAMES[a] + ' for ' + r.name + ': click, then press the new key';
                b.addEventListener('click', () => {
                    capturing = on ? null : { seat, action: a };
                    setKeyMsg('');
                    renderKeys();
                });
                td.appendChild(b);
                tr.appendChild(td);
            }
            keyTable.appendChild(tr);
        });
    }
    function stopCapture() {
        if (!capturing)
            return;
        capturing = null;
        setKeyMsg('');
        renderKeys();
    }
    window.addEventListener('keydown', e => {
        if (!capturing)
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat)
            return;
        if (e.key === 'Escape')
            return stopCapture();
        const why = keyCheck(e);
        if (why)
            return setKeyMsg(why); // stay in capture mode so another key can be tried
        const { seat, action } = capturing;
        capturing = null;
        bindKey(seat, action, keyToken(e)); // (swaps with whoever had that key)
        setKeyMsg('');
        renderKeys();
    }, true);
    if (keyReset)
        keyReset.addEventListener('click', () => {
            capturing = null;
            resetKeybinds();
            renderKeys();
            setKeyMsg('Keys are back to the defaults.');
        });
    renderKeys();
    const tabs = [...menu.querySelectorAll('[role=tab]')], panels = [...menu.querySelectorAll('[data-panel]')];
    const isOpen = () => !menu.hidden;
    function showTab(name) {
        if (name !== 'controls')
            stopCapture();
        for (const t of tabs) {
            const on = t.dataset.tab === name;
            t.classList.toggle('on', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        for (const p of panels)
            p.hidden = p.dataset.panel !== name;
    }
    // "Specials" toggle: free swapping any time, or only on the pick screens (before the first point and after every 5th point). Online the server owns it (net.setFixed) and only the
    // host may change it; the label follows the game state, so it catches up a moment after the click.
    function labelPick() {
        if (!pickBtn || typeof pickFixed === 'undefined')
            return;
        pickBtn.textContent = 'Specials: ' + (pickFixed ? 'Pick screens' : 'Free swap');
        pickBtn.classList.toggle('on', pickFixed);
        const locked = net.on && !net.host; // online, only the host can change this
        pickBtn.disabled = locked || inFlex();
        pickBtn.title = locked ? 'Only the host (the player who created the room) can change this.' : pickTitle;
    }
    const twoBtn = document.getElementById('twomode'), twoTitle = twoBtn ? twoBtn.title : '';
    function labelTwo() {
        if (!twoBtn || typeof twoSpecials === 'undefined')
            return;
        twoBtn.textContent = 'Specials per player: ' + (twoSpecials ? '2' : '1');
        twoBtn.classList.toggle('on', twoSpecials);
        const locked = net.on && !net.host;
        twoBtn.disabled = locked;
        twoBtn.title = locked ? 'Only the host (the player who created the room) can change this.' : twoTitle;
        if (typeof touch !== 'undefined')
            touch.releaseAll(); // re-lays the touch bands for the new count
    }
    if (twoBtn)
        twoBtn.addEventListener('click', () => {
            if (net.on && !net.host)
                return;
            const want = !twoSpecials;
            if (net.on) {
                net.setTwoSpecials(want);
                setTimeout(() => { labelTwo(); renderPicker(); }, 300);
            } else {
                setTwoSpecials(want); // restarts the match
                labelTwo();
                renderPicker();
            }
        });
    // "Switch sides" toggle: teams trade sides every SWAP_EVERY points. Offline it is just a variable; online the server owns it, only the host may change it, and the label follows
    // the game state (it catches up a moment after the click).
    const swapBtn = document.getElementById('swapmode'), swapTitle = swapBtn ? swapBtn.title : '';
    function labelSwap() {
        if (!swapBtn || typeof swapOn === 'undefined')
            return;
        swapBtn.textContent = 'Switch sides: ' + (swapOn ? 'On' : 'Off');
        swapBtn.classList.toggle('on', swapOn);
        const locked = net.on && !net.host; // online, only the host can change this
        swapBtn.disabled = locked;
        swapBtn.title = locked ? 'Only the host (the player who created the room) can change this.' : swapTitle;
    }
    if (swapBtn)
        swapBtn.addEventListener('click', () => {
            if (net.on && !net.host)
                return;
            const want = !swapOn;
            if (net.on) {
                net.setSwap(want);
                setTimeout(labelSwap, 300);
            } else {
                setSwapMode(want); // restarts the match
                labelSwap();
            }
        });
    // Campaign button: solo run through the six bosses (game/campaign.js). Offline only; turning it off (or changing the match type) goes back to a normal match.
    const campBtn = document.getElementById('campaignmode'), campTitle = campBtn ? campBtn.title : '';
    function labelCamp() {
        if (!campBtn || typeof campaign === 'undefined')
            return;
        campBtn.textContent = campaign.on ? `Campaign: Stage ${campaign.stage + 1}/${CAMPAIGN_STAGES.length}` : 'Campaign: Off';
        campBtn.classList.toggle('on', campaign.on);
        campBtn.disabled = !!net.on;
        campBtn.title = net.on ? 'The campaign is solo play: leave the online room first.' : campTitle;
    }
    if (campBtn)
        campBtn.addEventListener('click', () => {
            if (net.on)
                return;
            if (campaign.on) {
                if (!confirm('Quit the campaign? The run is lost.'))
                    return;
                campaignStop(true);
            }
            else
                campaignStart();
            labelCamp();
            labelTwo();
            labelSwap();
            labelCamp();
            labelPick();
        });
    // The 2v2 button: offline it toggles 2v2 against the AI (input.js keeps its label); online it is the room's 2v2 lobby switch, host only. The server restarts the match, and the
    // label follows the roster message, so it catches up a moment after the click.
    const teamBtn = document.getElementById('mode2v2');
    function labelTeams() {
        if (!teamBtn || !net.on)
            return;
        teamBtn.textContent = '2v2 lobby: ' + (net.lobby2v2 ? 'On' : 'Off');
        teamBtn.classList.toggle('on', !!net.lobby2v2);
        teamBtn.disabled = !net.host;
        teamBtn.title = net.host ? 'On: new players fill Blue, Red, Blue 2 and Red 2 automatically, and the match starts once all four seats are taken (restarts the match). Off: new players wait for you to place them.' : 'Only the host (the player who created the room) can change this.';
    }

    // The Flex button: enables you to get sandbox room making for solo and online play.
    const flexBtn = document.getElementById('flexmode'), flexEl = document.getElementById('flexsetup'), flexGroup = document.getElementById('flexgroup'), whoGroup = document.getElementById('whogroup');
    const inFlex = () => (net.on ? !!net.flex : flex.on);
    function labelFlex() {
        if (!flexBtn)
            return;
        flexBtn.textContent = 'Flex: ' + (inFlex() ? 'On' : 'Off');
        flexBtn.classList.toggle('on', inFlex());
        flexBtn.disabled = net.on && !net.host;
    }
    function renderFlex() { // offline: the four seats, each Blue / Red / Off and Human / AI
        const show = flex.on && !net.on;
        if (flexGroup) flexGroup.hidden = !show;
        if (whoGroup) whoGroup.style.display = show ? 'none' : '';
        if (!flexEl || !show)
            return;
        flexEl.textContent = '';
        flex.cfg.forEach((c, id) => {
            const row = document.createElement('div'), name = document.createElement('span');
            row.className = 'row';
            name.textContent = 'Player ' + (id + 1);
            name.style.cssText = 'font-weight:700;min-width:70px';
            row.appendChild(name);
            for (const [label, team, cls] of [['Blue', 0, 'blue'], ['Red', 1, 'red'], ['Off', -1, '']]) {
                const b = document.createElement('button');
                b.className = 'mode ' + cls + (c.team === team ? ' on' : '');
                b.textContent = label;
                b.addEventListener('click', () => { c.team = team; applyFlex(); renderFlex(); renderPicker(); });
                row.appendChild(b);
            }
            if (c.team >= 0) {
                const b = document.createElement('button');
                b.className = 'mode' + (c.ai ? ' on' : '');
                b.textContent = c.ai ? 'AI' : 'Human';
                b.addEventListener('click', () => { c.ai = !c.ai; applyFlex(); renderFlex(); renderPicker(); });
                row.appendChild(b);
            }
            flexEl.appendChild(row);
        });
    }
    if (flexBtn)
        flexBtn.addEventListener('click', () => {
            if (net.on) { if (net.host) net.setFlex(!net.flex); }
            else setFlex(!flex.on);
            setTimeout(() => { labelFlex(); labelPick(); renderFlex(); renderPicker(); renderRoster(); }, net.on ? 300 : 0);
            if (canvas) canvas.focus();
        });
    // "Ranked" toggle (online only): the host decides whether the match counts toward ratings. The label follows the roster message, so it catches up a moment after the click.
    const rankedBtn = document.getElementById('rankedmode');
    function labelRanked() {
        if (!rankedBtn)
            return;
        rankedBtn.style.display = net.on ? '' : 'none'; // there is no ranked play offline
        if (!net.on)
            return;
        rankedBtn.textContent = 'Ranked: ' + (net.ranked ? 'On' : 'Off');
        rankedBtn.classList.toggle('on', !!net.ranked);
        rankedBtn.disabled = !net.host;
        rankedBtn.title = net.host ? 'On: the match counts toward ratings (everyone seated must be signed in). Turning this on or off restarts the match.' : 'Only the host (the player who created the room) can change this.';
    }
    if (rankedBtn)
        rankedBtn.addEventListener('click', () => { if (net.on && net.host) net.setRanked(!net.ranked); });
        // Special ability picker: big buttons for every special. Online it drives your own seat. Offline it gets one row per human-controlled player in the match (Blue, Red), so
    // free-swap works from the menu without the keycaps on the wall; computer players always use Dash, and 2v2 teammates always use Dash, so they get no row.
    function renderPicker() {
        if (!pickEl || typeof touch === 'undefined' || typeof SPECIALS === 'undefined')
            return;
        pickEl.textContent = '';
        if (pickFixed) {
            pickEl.textContent = 'Specials are chosen on the pick screens (before the first point and after every ' + PICK_EVERY + 'th point).';
            return;
        }
        const addRow = (parent, p, slot, label, color) => {
            const row = document.createElement('div'), name = document.createElement('span'), cur = slot ? ((net.on && net.pendingSpecial2) || p.special2) : ((net.on && net.pendingSpecial) || p.special);
            row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;width:100%';
            name.textContent = label;
            name.style.cssText = 'font-weight:700;min-width:64px;color:' + color;
            row.appendChild(name);
            for (const s of SPECIALS) {
                const b = document.createElement('button');
                b.disabled = !!s.locked
                b.className = 'mode' + (s.id === cur ? ' on' : '');
                b.textContent = s.name.charAt(0) + s.name.slice(1).toLowerCase();
                b.addEventListener('click', () => {
                    if (net.on)
                        net.setSpecial(s.id, slot);
                    else
                        equipSpecial(p, slot, s.id);
                    renderPicker();
                });
                row.appendChild(b);
            }
            parent.appendChild(row);
        };
        if (net.on) {
            const seat = touch.seat(), p = seat >= 0 ? allPlayers[seat] : null;
            if (!p) {
                pickEl.textContent = 'You are spectating: there is no player to change.';
                return;
            }
            const color = p.color;
            addRow(pickEl, p, 0, twoSpecials ? 'Special 1' : 'Special', color);
            if (twoSpecials)
                addRow(pickEl, p, 1, 'Special 2', color);
            return;
        }
        const humans = allPlayers.filter(p => players.includes(p) && !ai[p.id].on);
        if (!humans.length) {
            pickEl.textContent = 'Both players are computer-controlled (they always use Dash). Switch one to Human to pick its special.';
            return;
        }
        for (const p of humans) {
            const nm = playerLabel(p), color = p.color;
        }
    }
    // Players tab (online): Blue, Red and the waiting list. The host gets buttons to move people; a team holds two players at most, and the match waits while a team is empty.
    function memberRow(m) {
        const row = document.createElement('div');
        row.className = 'mem';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = m.name || 'Player ' + m.c;
        row.appendChild(name);
        for (const [flag, text] of [[m.c === net.you, 'YOU'], [m.host, 'HOST']])
            if (flag) {
                const t = document.createElement('span');
                t.className = 'tag';
                t.textContent = text;
                row.appendChild(t);
            }
        if (net.host)
            for (const [label, to, cls] of [['Blue', 0, 'blue'], ['Red', 1, 'red'], ['Wait', -1, '']]) {
                if (to === m.team)
                    continue;
                const b = document.createElement('button');
                b.textContent = label;
                if (cls)
                    b.className = cls;
                b.disabled = to >= 0 && net.members.filter(x => x.team === to).length >= 2; // that team is full
                b.addEventListener('click', () => net.assign(m.c, to));
                row.appendChild(b);
            }
        return row;
    }
    function renderRoster() {
        if (!rosterEl)
            return;
        rosterEl.textContent = '';
        if (!net.on) {
            const p = document.createElement('p');
            p.className = 'hint';
            p.textContent = 'Teams are arranged online: the player who creates the room is the host and can move everyone between Blue, Red and the waiting list. Offline, use the 2v2 button and the AI toggles.';
            rosterEl.appendChild(p);
            return;
        }
        for (const g of [{ team: 0, title: 'Blue', cls: 'blue' }, { team: 1, title: 'Red', cls: 'red' }, { team: -1, title: 'Waiting', cls: '' }]) {
            const list = net.members.filter(m => m.team === g.team), box = document.createElement('div'), h = document.createElement('h3');
            box.className = 'team';
            h.textContent = g.title + ' (' + list.length + (g.team >= 0 && !net.flex ? '/2' : '') + ')';
            if (g.cls)
                h.classList.add(g.cls);
            box.appendChild(h);
            if (!list.length) {
                const p = document.createElement('p');
                p.className = 'hint';
                p.textContent = g.team >= 0
                    ? (net.flex ? 'Nobody yet. An empty team is allowed in Flex: with one team empty it is a sandbox.'
                        : net.lobby2v2 ? 'Nobody yet: the 2v2 match waits until both teams are full.' : 'Nobody yet: the match waits until both teams have a player.')
                    : 'Nobody waiting.';
                box.appendChild(p);
            }
            for (const m of list)
                box.appendChild(memberRow(m));
            rosterEl.appendChild(box);
        }
        const note = document.createElement('p');
        note.className = 'hint';
        note.textContent = net.host ? 'You are the host. Moving a player restarts the match.' : 'Only the host can move players.';
        rosterEl.appendChild(note);
    }
    if (pickBtn)
        pickBtn.addEventListener('click', () => {
            if (net.on && !net.host)
                return;
            const want = !pickFixed;
            if (typeof closeSpecialMenu === 'function')
                closeSpecialMenu();
            if (net.on) { // the server restarts the match with the new setting and the next snapshots carry it back
                net.setFixed(want);
                setTimeout(() => { labelPick(); labelTwo(); renderPicker(); }, 300);
            } else {
                setPickMode(want); // restarts the match
                labelPick();
                labelTwo();
                labelSwap();
                labelCamp();
                renderPicker();
            }
        });
    for (const id of ['ai0', 'ai1', 'ai2', 'ai3', 'mode2v2', 'twomode']) { // changing who plays changes which players get a row
        const el = document.getElementById(id);
        if (el)
            el.addEventListener('click', () => setTimeout(renderPicker, 0)); // after input.js has applied the change
    }
    function refresh() { // the roster or the game state changed while the panel is up
        if (!isOpen())
            return;
        labelPick();
        labelTwo();
        labelSwap();
        labelCamp();
        labelTeams();
        labelFlex(); renderFlex();
        labelRanked();
        renderPicker();
        renderRoster();
    }
    function open(tab) {
        if (typeof touch !== 'undefined')
            touch.releaseAll(); // a thumb still on the stick must not leave a key held while the panel is up
        if (tab)
            showTab(tab);
        document.body.classList.toggle('online', !!net.on); // shows the special picker online even without a touch screen
        labelPick();
        labelTwo();
        labelSwap();
        labelCamp();
        labelTeams();
        labelFlex(); renderFlex();
        labelRanked();
        renderPicker();
        renderRoster();
        menu.hidden = false;
    }
    function close() {
        stopCapture();
        menu.hidden = true;
        if (canvas)
            canvas.focus(); // so keys go back to the game
    }
    document.getElementById('menuclose').addEventListener('click', close);
    menu.addEventListener('click', e => { if (e.target === menu) close(); }); // a click on the dark backdrop closes it
    for (const t of tabs)
        t.addEventListener('click', () => showTab(t.dataset.tab));
    // Esc toggles the panel. Capture phase, so this runs before input.js closes the special-ability list: if that list is open, Esc only closes it.
    window.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || e.repeat)
            return;
        if (isOpen())
            close();
        else if (typeof ui === 'undefined' || ui.open < 0)
            open();
    }, true);
    labelPick();
    labelTwo();
    labelSwap();
    labelCamp();
        // The Menu button's real, clickable element: an invisible <button> placed exactly over the pill that special-menu.js draws on the floor. A real button gets mouse, touch
    // and keyboard handling for free, and it does not depend on the canvas hit-test. It is repositioned whenever the canvas changes size.
    const btn = document.getElementById('menubtn');
    function placeBtn() {
        if (!btn || !canvas || typeof menuKey !== 'function')
            return;
        const r = canvas.getBoundingClientRect(), s = r.width / canvas.width, k = menuKey();
        btn.style.left = r.left + (OX + k.x) * s + 'px';
        btn.style.top = r.top + (HUD + k.y) * s + 'px';
        btn.style.width = k.w * s + 'px';
        btn.style.height = k.h * s + 'px';
    }
    if (btn) {
        btn.addEventListener('click', () => {
            btn.blur(); // so Space / Enter go back to being game keys
            if (isOpen())
                close();
            else
                open();
        });
        btn.addEventListener('mouseenter', () => { ui.hover = { type: 'menu' }; }); // keeps the drawn pill's hover highlight
        btn.addEventListener('mouseleave', () => { if (ui.hover && ui.hover.type === 'menu') ui.hover = null; });
        window.addEventListener('resize', placeBtn);
        window.addEventListener('orientationchange', placeBtn);
        if (typeof ResizeObserver !== 'undefined' && canvas)
            new ResizeObserver(placeBtn).observe(canvas);
        placeBtn();
        requestAnimationFrame(placeBtn);
    }
    return { open, close, refresh, isOpen };
})();
