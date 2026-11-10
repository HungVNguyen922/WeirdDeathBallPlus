// Tests for js/host/room.js (the Room and connection handler shared by the Node server and the peer-to-peer host), against a FAKE simulation so they need no game files.
// What is checked is the wiring: joining, seats, the fixed hosted room, names where there are no accounts, no token trust, snapshots, chat, limits. Run:  node js/test/room-test.js
const { EventEmitter } = require('events');
const { createRoomKit } = require('../host/room.js');
const { skinClean } = require('../skin-data.js');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };

function fakeSim() {
    const ran = [];
    const ctx = { __ev: [], __tick: 0, __done: null, __ballSpeed: () => 0, __setKeys() {}, ticks: 0, update() { ctx.ticks++; },
        saveState: () => ({ players: [null, null, null, null], pick: { on: false, at: 0 }, score: [0, 0], ball: { x: 1.23456 } }) };
    return { ctx, ran, run: code => { ran.push(code); } };
}
function conn() {
    const c = new EventEmitter();
    c.sent = [];
    c.closed = false;
    c.buffered = 0;
    c.send = s => c.sent.push(JSON.parse(s));
    c.backlog = () => c.buffered;
    c.close = () => { if (!c.closed) { c.closed = true; c.emit('close'); } };
    c.say = o => c.emit('message', JSON.stringify(o));
    c.of = t => c.sent.filter(m => m.t === t);
    return c;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log('\na hosted room (one fixed room, no accounts)');
    const sims = [];
    const kit = createRoomKit({ makeSim: () => { const s = fakeSim(); sims.push(s); return s; }, skinClean });
    const rooms = new Map(), handler = kit.makeConnectionHandler({ rooms, maxRooms: 1, fixedRoom: 'p2p' });
    const a = conn(), b = conn(), w = conn();
    handler(a); handler(b); handler(w);
    a.say({ t: 'join', room: 'whatever', name: 'Ann_1', token: 'a-real-looking-token', delta: true });
    await sleep(10);
    check(a.of('welcome')[0].room === 'p2p' && a.of('welcome')[0].slot === 0, 'the first player joins the fixed room whatever name it asked for, and takes seat 0');
    check(a.of('roster').pop().running === false, 'the match waits for an opponent');
    b.say({ t: 'join', room: 'other', name: 'bad name!', special: 'bat' });
    w.say({ t: 'join' });
    await sleep(10);
    check(b.of('welcome')[0].slot === 1 && w.of('welcome')[0].slot === -1 && rooms.size === 1, 'the second takes seat 1, the third waits, and there is still only one room');
    const ro = a.of('roster').pop();
    check(ro.running === true && ro.members.length === 3 && ro.members[0].host === true && ro.members.filter(m => m.host).length === 1, 'the match starts and the first player is the room host');
    check(ro.members.find(m => m.c === 1).name === 'Ann_1', 'a player\'s chosen name is shown where there are no accounts');
    check(ro.members.find(m => m.c === 2).name === null, 'a name that breaks the rule is dropped');
    check(sims.length === 1, 'the room made exactly one simulation');
    check(sims[0].ran.some(c => /setRoster\(\[0,1\], \[0,1\]\)/.test(c)) && sims[0].ran.some(c => c.includes("allPlayers[1].special = 'bat'")), 'the sim was told who sits where and each seat\'s special');
    check(a.of('snap').length > 0 && b.of('snap').length > 0 && a.of('snap')[0].kf === 1 && a.of('snap')[0].s.ball.x === 1.23, 'players get a keyframe snapshot, rounded to 2 decimals');

    console.log('\nthe clock');
    const room = rooms.get('p2p'), t0 = room.last;
    a.sent.length = 0;
    for (let i = 1; i <= 10; i++) room.advance(t0 + i * 10); // like the real 4 ms loop: advance() runs at most 8 catch-up ticks per call
    check(sims[0].ctx.ticks >= 11 && sims[0].ctx.ticks <= 13 && room.tick === sims[0].ctx.ticks, `100 ms of real time runs about 12 sim ticks (${sims[0].ctx.ticks})`);
    check(a.of('snap').every(m => m.tick % 6 === 0), 'snapshots go out every 6th tick');

    console.log('\nchat, host rights, limits');
    a.say({ t: 'chat', text: 'hello' }); await sleep(10);
    check(b.of('chat').pop().text === 'hello' && w.of('chat').pop().text === 'hello', 'chat reaches everybody in the room');
    b.say({ t: 'flex', v: true }); await sleep(10);
    check(rooms.get('p2p').flex === false, 'only the host can change room settings');
    a.say({ t: 'ranked', v: true }); await sleep(10);
    check(rooms.get('p2p').ranked === false && a.of('chat').some(m => m.sys && /signed in/.test(m.text)), 'ranked cannot be switched on without accounts');
    a.say({ t: 'refresh', token: 'x' }); await sleep(10);
    check(true, 'a refresh message with no accounts is ignored (no crash)');
    const f = conn(); handler(f); f.say({ t: 'join' });
    for (let i = 0; i < 450; i++) f.say({ t: 'ping', c: i });
    check(f.closed, 'a flooding connection is closed');
    check(!a.closed && !b.closed, 'others are not affected');
    for (const c of [a, b, w]) c.close();
    check(rooms.size === 0, 'when everyone has left the room is removed');

    console.log('\nthe same kit with accounts (the Render server)');
    const calls = [];
    const accounts = { enabled: () => true, identify: async tok => { calls.push(tok); return tok === 'good' ? { uid: 'u1', name: 'Real_Name', skin: [] } : null; }, recordMatch() {} };
    const kit2 = createRoomKit({ makeSim: fakeSim, skinClean, accounts, snapEvery: 4 });
    const rooms2 = new Map(), h2 = kit2.makeConnectionHandler({ rooms: rooms2, maxRooms: 2 });
    const p = conn(), q = conn();
    h2(p); h2(q);
    p.say({ t: 'join', room: 'r1', token: 'good', name: 'Fake_Name' });
    q.say({ t: 'join', room: 'r1', token: 'bad', name: 'Fake_Name' });
    await sleep(20);
    const m2 = p.of('roster').pop().members;
    check(calls.length === 2 && m2.find(m => m.c === 1).name === 'Real_Name', 'with accounts on, the verified name is used');
    check(m2.find(m => m.c === 2).name === null, 'and a self-chosen name is ignored: a bad token is just a guest');
    check(p.of('welcome')[0].snapEvery === 4 && p.of('welcome')[0].room === 'r1', 'snapEvery is configurable and rooms keep the requested name');
    const r3 = conn(), r4 = conn(), r5 = conn();
    h2(r3); h2(r4); h2(r5);
    r3.say({ t: 'join', room: 'r2' }); r4.say({ t: 'join', room: 'r3' });
    await sleep(10);
    check(r4.of('error').length === 1 && /full/.test(r4.of('error')[0].msg), 'maxRooms is enforced');
    for (const c of [p, q, r3, r4, r5]) c.close();

    console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
    process.exit(fails ? 1 : 0);
})();
