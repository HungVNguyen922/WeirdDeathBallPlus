// Tests for the room-code relay (js/server/signal.js), with fake connections (no sockets). Run:  node js/test/signal-test.js
const { EventEmitter } = require('events');
const signal = require('../server/signal.js');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
function conn() {
    const c = new EventEmitter();
    c.sent = [];
    c.closed = false;
    c.send = s => c.sent.push(JSON.parse(s));
    c.close = () => { if (!c.closed) { c.closed = true; c.emit('close'); } };
    c.say = o => c.emit('message', typeof o === 'string' ? o : JSON.stringify(o));
    c.last = () => c.sent[c.sent.length - 1];
    return c;
}
const offer = { type: 'offer', sdp: 'v=0 offer' }, answer = { type: 'answer', sdp: 'v=0 answer' };
const host = () => { const h = conn(); signal.attach(h); h.say({ t: 'host' }); return h; };
const guest = code => { const g = conn(); signal.attach(g); g.say({ t: 'join', code }); return g; };

console.log('\nhosting and joining');
{
    const h = host(), code = h.last().code;
    check(h.last().t === 'hosted' && /^[A-HJ-KM-NP-Z2-9]{5}$/.test(code), 'a host gets a 5 character code without confusing letters (' + code + ')');
    check(signal.hostCount() === 1, 'the relay counts it');
    const g = guest(code.toLowerCase());
    check(h.last().t === 'guest' && h.last().id === 1, 'a guest joining (lower case is fine) tells the host');
    h.say({ t: 'sig', to: 1, data: offer });
    check(g.last().t === 'sig' && g.last().data.type === 'offer' && g.last().data.sdp === 'v=0 offer', 'the host\'s offer reaches the guest');
    g.say({ t: 'sig', data: answer });
    check(h.last().t === 'sig' && h.last().from === 1 && h.last().data.type === 'answer', 'the guest\'s answer reaches the host, tagged with the guest id');
    const g2 = guest(code);
    h.say({ t: 'sig', to: 2, data: offer });
    check(g2.last().t === 'sig' && g.sent.filter(m => m.t === 'sig').length === 1, 'a second guest gets its own offer and the first guest does not see it');
    g.close();
    check(h.sent.some(m => m.t === 'gone' && m.id === 1), 'the host hears when a guest\'s socket closes');
    h.close();
    check(g2.last().t === 'closed' && g2.closed && signal.hostCount() === 0, 'when the host leaves, remaining guests are told and dropped, and the code is freed');
}

console.log('\nbad input');
{
    const g = guest('ZZZZZ');
    check(g.last().t === 'error' && /No room/.test(g.last().msg) && g.closed, 'an unknown code is refused and the socket closes');
    const h = host(), code = h.last().code;
    const x = conn(); signal.attach(x);
    x.say('not json'); x.say({ t: 'sig', data: offer }); x.say({ t: 'nothing' }); x.say({ t: 5 });
    check(x.sent.length === 0 && !x.closed, 'junk before joining is ignored without a crash or a reply');
    const g1 = guest(code);
    const before = g1.sent.length;
    h.say({ t: 'sig', to: 1, data: { type: 'offer', sdp: 'x'.repeat(13000) } });
    h.say({ t: 'sig', to: 1, data: { type: 'bogus', sdp: 'a' } });
    h.say({ t: 'sig', to: 1, data: 'string' });
    h.say({ t: 'sig', to: 99, data: offer });
    check(g1.sent.length === before, 'oversized, mistyped and mis-addressed handshakes are not forwarded');
    h.say({ t: 'sig', to: 1, data: { type: 'offer', sdp: 'ok', evil: 'x' } });
    check(g1.last().data && Object.keys(g1.last().data).sort().join() === 'sdp,type', 'only the checked fields are forwarded');
    h.say({ t: 'host' });
    check(h.sent.filter(m => m.t === 'hosted').length === 1, 'a host cannot register twice');
    h.close();
}

console.log('\nlimits');
{
    const h = host(), code = h.last().code, gs = [];
    for (let i = 0; i < 11; i++) gs.push(guest(code));
    const extra = guest(code);
    check(gs.every(g => !g.closed) && extra.last().t === 'error' && /full/.test(extra.last().msg), 'a room takes 11 guests (4 seats + 8 spectators - the host), then says it is full');
    const f = conn(); signal.attach(f);
    for (let i = 0; i < 40; i++) f.say({ t: 'nothing' });
    check(f.closed, 'a flooding client is dropped');
    h.close();
    check(signal.hostCount() === 0, 'everything is cleaned up');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
