// SIGNAL (server) - a tiny relay that lets two browsers find each other for a peer-to-peer room. Players type a short ROOM CODE instead of copy-pasting WebRTC handshake text.
// It only ever forwards the handshake (an "offer" and an "answer", a few KB each): the game itself flows straight between the browsers, so this costs almost nothing.
// It can run on this game server (js/server/server.js routes /signal here) or on any other small Node host: the browser takes the address from netServerUrl() + '/signal'.
//
// Protocol (JSON text over a WebSocket at /signal):
//   host  -> relay   {t:'host'}                         register a room; the relay answers {t:'hosted', code}
//   guest -> relay   {t:'join', code}                    ask for that room; the host is told {t:'guest', id}; unknown code -> {t:'error', msg} and the socket closes
//   host  -> relay   {t:'sig', to:id, data}              data = { type:'offer', sdp }   -> forwarded to that guest as {t:'sig', data}
//   guest -> relay   {t:'sig', data}                     data = { type:'answer', sdp }  -> forwarded to the host as {t:'sig', from:id, data}
//   relay -> host    {t:'gone', id}                      a guest's socket closed (normal once the connection is up)
//   relay -> guest   {t:'closed'}                        the host stopped taking guests
// A host registration lasts HOST_TTL_MS at most; a guest has GUEST_TTL_MS to finish the handshake. Both ends close the socket as soon as they are connected.
'use strict';
const crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', CODE_LEN = 5; // no 0 / O / 1 / I / L: easy to read out loud
const MAX_HOSTS = +process.env.MAX_SIGNAL_HOSTS || 200, MAX_GUESTS = 11; // 11 = the 4 seats and 8 spectators, minus the host
const HOST_TTL_MS = 30 * 60 * 1000, GUEST_TTL_MS = 90 * 1000;
const MAX_SDP = 12000, MSG_PER_SEC = 30;

const hosts = new Map(); // code -> { conn, guests: Map(id -> conn), seq }
const send = (c, o) => { try { c.send(JSON.stringify(o)); } catch (e) { /* socket already gone */ } };
const okSig = d => !!d && typeof d === 'object' && (d.type === 'offer' || d.type === 'answer') && typeof d.sdp === 'string' && d.sdp.length <= MAX_SDP;
function newCode() {
    for (let n = 0; n < 50; n++) {
        let s = '';
        for (let i = 0; i < CODE_LEN; i++)
            s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
        if (!hosts.has(s))
            return s;
    }
    return null;
}

function attach(conn) {
    let role = null, code = '', gid = 0, count = 0, since = Date.now(), timer = null;
    const fail = msg => { send(conn, { t: 'error', msg }); conn.close(); };
    conn.on('message', str => {
        const now = Date.now();
        if (now - since > 1000) { since = now; count = 0; }
        if (++count > MSG_PER_SEC)
            return conn.close(1008);
        let m;
        try { m = JSON.parse(str); } catch (e) { return; }
        if (!m || typeof m.t !== 'string')
            return;
        if (m.t === 'host' && !role) {
            if (hosts.size >= MAX_HOSTS)
                return fail('The room-code server is busy. Try again in a minute.');
            code = newCode();
            if (!code)
                return fail('Could not make a room code. Try again.');
            role = 'host';
            hosts.set(code, { conn, guests: new Map(), seq: 0 });
            send(conn, { t: 'hosted', code });
            timer = setTimeout(() => conn.close(), HOST_TTL_MS);
            if (timer.unref) timer.unref();
        } else if (m.t === 'join' && !role) {
            const want = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), h = hosts.get(want);
            if (!h)
                return fail('No room with that code. Check it and try again.');
            if (h.guests.size >= MAX_GUESTS)
                return fail('That room is full.');
            role = 'guest';
            code = want;
            gid = ++h.seq;
            h.guests.set(gid, conn);
            timer = setTimeout(() => conn.close(), GUEST_TTL_MS);
            if (timer.unref) timer.unref();
            send(h.conn, { t: 'guest', id: gid });
        } else if (m.t === 'sig' && okSig(m.data)) {
            const h = hosts.get(code);
            if (!h)
                return;
            const data = { type: m.data.type, sdp: m.data.sdp }; // forward only what we checked
            if (role === 'host') {
                const g = h.guests.get(Number(m.to));
                if (g)
                    send(g, { t: 'sig', data });
            } else if (role === 'guest' && h.guests.get(gid) === conn)
                send(h.conn, { t: 'sig', from: gid, data });
        }
    });
    conn.on('close', () => {
        clearTimeout(timer);
        const h = hosts.get(code);
        if (!h)
            return;
        if (role === 'host' && h.conn === conn) {
            hosts.delete(code);
            for (const g of h.guests.values()) {
                send(g, { t: 'closed' });
                g.close();
            }
        } else if (role === 'guest' && h.guests.get(gid) === conn) {
            h.guests.delete(gid);
            send(h.conn, { t: 'gone', id: gid });
        }
    });
}

module.exports = { attach, hostCount: () => hosts.size };
