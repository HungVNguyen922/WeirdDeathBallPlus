// GAME - sim state: saveState() / loadState() / stateHash(). Load order: after game/rules.js (reads its globals), before game/ai.js is fine too.
// saveState() returns a plain-data (JSON / structuredClone safe) snapshot of everything the simulation needs to resume exactly where it was:
// all four players, the death ball, decoys, pegs, arrows, the seesaw floor, hatchet glow, score and round timers. loadState(s) puts it all back.
// This is the one thing the netcode needs (snapshots to clients, prediction, rollback), and it is also a good test tool (see test/state-test.js).
//
// What it does NOT hold, on purpose:
//   - input: players' `keys` ARE saved (they are part of a player), but a rollback loop overwrites them with the real inputs each tick.
//   - the AI's thinking (`ai[]`): it only ever runs on the authority, and it just produces keys.
//   - anything drawn: trails, impact sparks, hud flashes, audio. Clients make those from `events`.
//   - stuckSegs: rebuilt from `projectiles` every step by stepProjectiles().
// References between objects (a decoy's owner, an arrow's owner, a player's tethered ball) are saved as ids / indices, not objects.

// Deep copy of plain data (numbers, strings, booleans, null, undefined, arrays, plain objects). Own implementation rather than structuredClone so it behaves the same in
// every environment (browser, Node, a vm sandbox) and never carries object identity across.
function cloneData(v) {
    if (v === null || typeof v !== 'object')
        return v;
    if (Array.isArray(v))
        return v.map(cloneData);
    const o = {};
    for (const k in v)
        o[k] = cloneData(v[k]);
    return o;
}

function saveState() {
    const ballRef = b => (b == null ? null : b === ball ? 0 : decoys.indexOf(b) + 1); // 0 = death ball, 1.. = decoy index
    const ownerId = o => (o ? o.id : null);
    const body = b => { // a Ball (death ball or decoy): own fields except the owner reference
        const o = {};
        for (const k in b)
            if (k !== 'owner')
                o[k] = cloneData(b[k]);
        if (b.owner)
            o.owner = ownerId(b.owner);
        return o;
    };
    const player = p => {
        const o = {};
        for (const k in p)
            if (k !== 'tball')
                o[k] = cloneData(p[k]);
        o.tball = ballRef(p.tball);
        return o;
    };
    const owned = a => { // pegs and arrows: plain objects with an owner player
        const o = {};
        for (const k in a)
            if (k !== 'owner')
                o[k] = cloneData(a[k]);
        o.owner = ownerId(a.owner);
        return o;
    };
    return {
        score: [...score], pause, over, msg, teamSize,
        saw: { t: saw.t, v: saw.v },
        quakeFx: { t: quakeFx.t, x: quakeFx.x, s: quakeFx.s },
        padFlash: [...padFlash],
        pick: cloneData(pick), pickFixed,
        sidesSwapped, swapAt, swapOn, twoSpecials, swapBanner,
        inMatch: players.map(p => p.id), // who is in the current match, in order
        players: allPlayers.map(p => (players.includes(p) ? player(p) : null)), // players that are not in the match are not sent: they are idle, and they were half of every 1v1 snapshot
        ball: body(ball),
        decoys: decoys.map(body),
        pegs: pegs.map(owned),
        projectiles: projectiles.map(owned),
        portals: portals.map(owned),
        portalSeq, projSeq,
        mines: mines.map(owned),
        statics: statics.map(owned),
        staticSeq,
        mineSeq,
    };
}

function loadState(s) {
    score = [...s.score];
    pause = s.pause;
    over = s.over;
    msg = s.msg;
    teamSize = s.teamSize;
    saw.t = s.saw.t;
    saw.v = s.saw.v;
    quakeFx.t = s.quakeFx ? s.quakeFx.t : 0;
    quakeFx.x = s.quakeFx ? s.quakeFx.x : 0;
    quakeFx.s = s.quakeFx ? s.quakeFx.s : 0;
    padFlash[0] = s.padFlash[0];
    padFlash[1] = s.padFlash[1];
    pickFixed = !!s.pickFixed;
    sidesSwapped = !!s.sidesSwapped;
    swapAt = s.swapAt === undefined ? -1 : s.swapAt;
    swapOn = s.swapOn === undefined ? true : !!s.swapOn;
    swapBanner = s.swapBanner === undefined ? 0 : s.swapBanner;
    twoSpecials = !!s.twoSpecials;
    if (s.pick)
        for (const k in s.pick)
            pick[k] = cloneData(s.pick[k]);
    players.length = 0;
    for (const id of s.inMatch)
        players.push(allPlayers[id]);
    // Players: wipe every field the snapshot does not mention (a field that was added later in the sim would otherwise leak through), then copy.
    allPlayers.forEach((p, i) => {
        const o = s.players[i];
        if (!o)
            return; // not in the match: left as it is
        for (const k of Object.keys(p))
            if (!(k in o))
                delete p[k];
        for (const k in o)
            p[k] = k === 'tball' ? null : cloneData(o[k]);
    });
    // The ball: restored in place (every system holds a reference to this one object).
    for (const k of Object.keys(ball))
        if (!(k in s.ball))
            delete ball[k];
    for (const k in s.ball)
        ball[k] = cloneData(s.ball[k]);
    // Decoys are rebuilt (they come and go), owners re-linked to the player objects.
    decoys.length = 0;
    for (const o of s.decoys) {
        const d = new Ball();
        for (const k in o)
            if (k !== 'owner')
                d[k] = cloneData(o[k]);
        if (o.owner !== undefined && o.owner !== null)
            d.owner = allPlayers[o.owner];
        decoys.push(d);
    }
    const relink = list => list.map(o => {
        const a = {};
        for (const k in o)
            if (k !== 'owner')
                a[k] = cloneData(o[k]);
        a.owner = o.owner === null ? null : allPlayers[o.owner];
        return a;
    });
    pegs.length = 0;
    pegs.push(...relink(s.pegs));
    projectiles.length = 0; projectiles.push(...relink(s.projectiles || []));
    portals.length = 0;
    portals.push(...relink(s.portals || []));
    portalSeq = s.portalSeq || 0;
    projSeq = s.projSeq || 0;
    mines.length = 0;
    mines.push(...relink(s.mines || []));
    mineSeq = s.mineSeq || 0;
    statics.length = 0;
    statics.push(...relink(s.statics || []));
    staticSeq = s.staticSeq || 0;
    rebuildStuck();
    // Tethers last, once the decoys exist.
    allPlayers.forEach((p, i) => {
        const r = s.players[i] ? s.players[i].tball : null;
        p.tball = r === null ? null : r === 0 ? ball : decoys[r - 1] || null;
    });
}

// A cheap fingerprint of the whole state, for tests and (later) desync detection: two machines that disagree on this have diverged.
// Floats are hashed by their exact bits, so any difference at all shows up.
function stateHash(s = saveState()) {
    const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
    let h = 2166136261 >>> 0;
    const mix = n => { h = Math.imul(h ^ n, 16777619) >>> 0; };
    const walk = v => {
        if (typeof v === 'number') {
            f64[0] = v;
            mix(u32[0]);
            mix(u32[1]);
        } else if (typeof v === 'string') {
            for (let i = 0; i < v.length; i++)
                mix(v.charCodeAt(i));
            mix(0x7e57);
        } else if (typeof v === 'boolean')
            mix(v ? 1 : 2);
        else if (v === null)
            mix(3);
        else if (v === undefined)
            mix(4);
        else if (Array.isArray(v)) {
            mix(5);
            for (const x of v)
                walk(x);
            mix(6);
        } else {
            mix(7);
            for (const k of Object.keys(v).sort()) { // sorted: key order must not matter; a key holding undefined counts as absent (JSON drops those)
                if (v[k] === undefined)
                    continue;
                walk(k);
                walk(v[k]);
            }
            mix(8);
        }
    };
    walk(s);
    return h.toString(16).padStart(8, '0');
}



