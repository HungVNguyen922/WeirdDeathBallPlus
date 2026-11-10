// HOST - peer-to-peer rooms over WebRTC, and the panel on the menu's Game tab that drives them. Load after net/client.js (it uses `net` and `netServerUrl`) and before touch.js / main.js.
//
// One player HOSTS: their browser runs the real match in a Web Worker (host/host-worker.js: the same Room the Node server uses), and everybody else connects straight to it over a WebRTC
// data channel. The host's own player talks to the Worker through a loopback "socket", so net/client.js (interpolation, prediction, chat...) cannot tell it from a real server.
// The browsers are introduced by a ROOM CODE: both meet at the small relay in js/server/signal.js (only the handshake goes through it). The host's code is also a link: ?join=CODE.
// Open the game from your own computer (npm start, http://<its address>:8080) and that computer is the relay too, so a LAN game never touches Render.
// Not available in these rooms: ranked play and account names (nobody can verify them). Your account's sign-in token is never sent to a peer.
const hosting = (() => {
    const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] }; // free public STUN servers: they only tell a browser its own public address
    const GATHER_MS = 3500;               // how long to wait for the network addresses to be found before sending what we have
    const INVITE_WINDOW_MS = 15 * 60 * 1000; // a room code stops taking new players after this long (the relay keeps a connection open meanwhile)
    const PEER_WAIT_MS = 45 * 1000;       // a relay guest has this long to finish connecting
    const MAX_PEERS = 11;                 // 4 seats and 8 spectators, minus the host (the room itself also enforces its limits)
    const P2P_ROOM = 'p2p';
    const root = document.getElementById('p2p');

    const plain = d => ({ type: d.type, sdp: d.sdp });
    function gathered(pc) { // resolves once the browser has found its network addresses (or after GATHER_MS): we send one complete description instead of trickling candidates
        return new Promise(res => {
            if (pc.iceGatheringState === 'complete')
                return res();
            let t = 0;
            const done = () => { pc.removeEventListener('icegatheringstatechange', ch); clearTimeout(t); res(); };
            const ch = () => { if (pc.iceGatheringState === 'complete') done(); };
            pc.addEventListener('icegatheringstatechange', ch);
            t = setTimeout(done, GATHER_MS);
        });
    }

    // ---- a socket-shaped object for net.join(): send / close / onopen / onmessage / onclose / readyState, which is all net/client.js touches ----
    class PeerSocket {
        constructor(sendFn, closeFn) {
            this.readyState = 1;
            this.onopen = this.onmessage = this.onclose = this.onerror = null;
            this._send = sendFn;
            this._close = closeFn;
            setTimeout(() => { if (this.onopen) this.onopen({}); }, 0); // after net.join has attached its handlers
        }
        send(str) { if (this.readyState === 1) this._send(str); }
        close() {
            if (this.readyState > 1)
                return;
            this.readyState = 3;
            try { this._close(); } catch (e) {}
            if (this.onclose) this.onclose({});
        }
        _in(data) { if (this.onmessage) this.onmessage({ data }); }
        _closed() {
            if (this.readyState === 3)
                return;
            this.readyState = 3;
            if (this.onclose) this.onclose({});
        }
    }
    function enter(sock) { // this browser is now a player in the room behind `sock`
        net.p2p = true; // net/client.js: no sign-in token goes to a peer
        net.join(P2P_ROOM, null, sock);
        if (typeof gameMenu !== 'undefined')
            gameMenu.close();
        render();
    }

    // ---- JOINING ----
    async function guestAnswer(offer) { // answer an offer: { pc, answer, channel } (channel resolves to the open data channel)
        const pc = new RTCPeerConnection(ICE);
        const channel = new Promise((res, rej) => {
            pc.ondatachannel = e => { const dc = e.channel; if (dc.readyState === 'open') res(dc); else dc.onopen = () => res(dc); };
            pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') rej(new Error('Could not connect to the host. A strict network or firewall may be blocking peer-to-peer.')); };
            setTimeout(() => rej(new Error('The host did not answer in time.')), 60000);
        });
        channel.catch(() => {}); // (the caller awaits it later; this only keeps an early failure from looking unhandled)
        await pc.setRemoteDescription(offer);
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        return { pc, answer: plain(pc.localDescription), channel };
    }
    function guestSocket(pc, dc) {
        const sock = new PeerSocket(s => dc.send(s), () => { try { dc.close(); pc.close(); } catch (e) {} });
        dc.onmessage = e => { if (typeof e.data === 'string') sock._in(e.data); };
        dc.onclose = () => sock._closed();
        const prev = pc.onconnectionstatechange;
        pc.onconnectionstatechange = ev => { if (prev) prev(ev); if (pc.connectionState === 'failed' || pc.connectionState === 'closed') sock._closed(); };
        return sock;
    }
    const signalUrl = () => netServerUrl().replace(/\/+$/, '') + '/signal';

    function joinWithCode(code) { // meet the host at the relay, swap descriptions, then talk directly
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(signalUrl());
            let settled = false;
            const finish = err => { if (settled) return; settled = true; clearTimeout(limit); try { ws.close(); } catch (e) {} if (err) reject(err); else resolve(); };
            const limit = setTimeout(() => finish(new Error('Could not reach the room-code server. If it was asleep, try again in a minute.')), 75000);
            ws.onopen = () => ws.send(JSON.stringify({ t: 'join', code }));
            ws.onerror = () => finish(new Error('Could not reach the room-code server.'));
            ws.onclose = () => finish(new Error('The connection to the room-code server closed.'));
            ws.onmessage = async e => {
                let m;
                try { m = JSON.parse(e.data); } catch (er) { return; }
                if (m.t === 'error')
                    return finish(new Error(m.msg || 'Could not join.'));
                if (m.t === 'closed')
                    return finish(new Error('The host closed the room.'));
                if (m.t !== 'sig' || !m.data || m.data.type !== 'offer')
                    return;
                try {
                    net.setStatus('Connecting to the host...');
                    const g = await guestAnswer(m.data);
                    ws.send(JSON.stringify({ t: 'sig', data: g.answer }));
                    const dc = await g.channel;
                    settled = true; clearTimeout(limit); ws.onclose = null; ws.close();
                    enter(guestSocket(g.pc, dc));
                    resolve();
                } catch (er) { finish(er); }
            };
        });
    }

    // ---- HOSTING ----
    let worker = null, loopSock = null, nextId = 1, backlogTimer = 0, stopping = false;
    const peers = new Map();      // id -> HostPeer, once its channel is open (these are connections the Worker knows about)
    const waiting = new Map();    // relay guest id -> HostPeer still connecting
    let sigWs = null, code = '', inviteTimer = 0;

    const post = m => { if (worker) worker.postMessage(m); };
    class HostPeer {
        constructor(ttl) {
            this.id = nextId++;
            this.opened = false;
            this.dead = false;
            this.pc = new RTCPeerConnection(ICE);
            this.dc = this.pc.createDataChannel('wdb', { ordered: true });
            this.dc.onopen = () => { this.opened = true; peers.set(this.id, this); post({ t: 'open', id: this.id }); render(); };
            this.dc.onmessage = e => { if (typeof e.data === 'string') post({ t: 'msg', id: this.id, data: e.data }); };
            this.dc.onclose = () => this.gone();
            this.pc.onconnectionstatechange = () => { if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') this.gone(); };
            this.timer = setTimeout(() => { if (!this.opened) this.gone(); }, ttl);
        }
        async makeOffer() {
            await this.pc.setLocalDescription(await this.pc.createOffer());
            await gathered(this.pc);
            return plain(this.pc.localDescription);
        }
        async accept(answer) {
            if (!answer || answer.type !== 'answer' || typeof answer.sdp !== 'string')
                throw new Error('That is not a reply text.');
            await this.pc.setRemoteDescription(answer);
        }
        send(str) { if (this.dc.readyState === 'open') { try { this.dc.send(str); } catch (e) { console.warn('could not send to a peer', e); } } }
        close() { try { this.dc.close(); this.pc.close(); } catch (e) {} }
        gone() {
            if (this.dead)
                return;
            this.dead = true;
            clearTimeout(this.timer);
            if (this.opened)
                post({ t: 'closed', id: this.id });
            peers.delete(this.id);
            for (const [k, v] of waiting)
                if (v === this)
                    waiting.delete(k);
            this.close();
            render();
        }
    }

    function onWorker(e) {
        const m = e.data;
        if (m.t === 'send') {
            if (m.id === 0)
                loopSock._in(m.data);
            else if (peers.has(m.id))
                peers.get(m.id).send(m.data);
        } else if (m.t === 'close') {
            if (m.id === 0)
                loopSock._closed();
            else if (peers.has(m.id))
                peers.get(m.id).close();
        }
    }
    function start() { // start the Worker and sit down as its first player
        if (worker || net.on)
            return Promise.resolve();
        return new Promise((resolve, reject) => {
            const w = worker = new Worker('js/host/host-worker.js');
            w.onerror = e => { worker = null; reject(new Error('Could not start the host: ' + (e.message || 'the worker failed to load.'))); };
            w.onmessage = e => {
                if (e.data.t === 'error') { worker = null; w.terminate(); return reject(new Error(e.data.msg)); }
                if (e.data.t !== 'ready')
                    return;
                w.onmessage = onWorker;
                w.onerror = () => { net.setStatus('The host stopped unexpectedly. Reload the page.'); };
                loopSock = new PeerSocket(s => post({ t: 'msg', id: 0, data: s }), () => post({ t: 'closed', id: 0 }));
                post({ t: 'open', id: 0 });
                backlogTimer = setInterval(() => {
                    const n = {};
                    for (const [id, p] of peers)
                        n[id] = p.dc.bufferedAmount;
                    post({ t: 'backlog', n });
                }, 100);
                window.addEventListener('beforeunload', e2 => { if (!stopping && peers.size) { e2.preventDefault(); e2.returnValue = ''; } });
                net.p2p = true;
                net.hosting = true;
                net.join(P2P_ROOM, null, loopSock);
                resolve();
            };
        });
    }
    function openInvites() { // ask the relay for a room code; resolves with it. The relay connection stays open while new players may still join.
        return new Promise((resolve, reject) => {
            const ws = sigWs = new WebSocket(signalUrl());
            let got = false;
            const limit = setTimeout(() => { if (!got) { try { ws.close(); } catch (e) {} reject(new Error('Could not reach the room-code server. If it was asleep, try again in a minute.')); } }, 75000);
            ws.onopen = () => ws.send(JSON.stringify({ t: 'host' }));
            ws.onerror = () => { if (!got) { clearTimeout(limit); reject(new Error('Could not reach the room-code server.')); } };
            ws.onclose = () => { clearTimeout(limit); clearTimeout(inviteTimer); if (sigWs === ws) { sigWs = null; code = ''; } if (!got) reject(new Error('The room-code server closed the connection.')); render(); };
            ws.onmessage = async e => {
                let m;
                try { m = JSON.parse(e.data); } catch (er) { return; }
                if (m.t === 'hosted') {
                    got = true; clearTimeout(limit);
                    code = m.code;
                    inviteTimer = setTimeout(closeInvites, INVITE_WINDOW_MS);
                    resolve(code);
                    render();
                } else if (m.t === 'error') {
                    if (!got) { clearTimeout(limit); reject(new Error(m.msg || 'The room-code server said no.')); }
                } else if (m.t === 'guest') {
                    if (peers.size + waiting.size >= MAX_PEERS)
                        return;
                    const p = new HostPeer(PEER_WAIT_MS);
                    waiting.set(m.id, p);
                    try { ws.send(JSON.stringify({ t: 'sig', to: m.id, data: await p.makeOffer() })); } catch (er) { p.gone(); }
                } else if (m.t === 'sig') {
                    const p = waiting.get(m.from);
                    if (p) { try { await p.accept(m.data); } catch (er) { p.gone(); } }
                }
            };
        });
    }
    function closeInvites() { if (sigWs) sigWs.close(); }
    // ---- the panel ----
    const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
    const draft = { code: '' };
    let msg = '', busy = false;
    for (const type of ['keydown', 'keyup', 'keypress']) // typing in these boxes must not drive the game (R restarts, M mutes, 1-4 toggle the AI...)
        window.addEventListener(type, e => {
            const t = e.target;
            if (t && t.closest && t.closest('#p2p') && /^(INPUT|TEXTAREA)$/.test(t.tagName) && e.key !== 'Escape')
                e.stopPropagation();
        }, true);
    async function copy(text) {
        try { await navigator.clipboard.writeText(text); msg = 'Copied.'; } catch (e) { msg = 'Could not copy automatically: select the text and copy it yourself.'; }
        render();
    }
    const shareLink = () => location.origin + location.pathname + '?join=' + code;
    const note = (text, cls) => el('p', { className: 'hint' + (cls ? ' ' + cls : ''), textContent: text });
    function run(label, fn) { // a button action: shows a note while it works, and any error afterwards
        return async () => {
            if (busy) return;
            busy = true; msg = label; render();
            try { await fn(); msg = ''; } catch (e) { msg = e.message || String(e); }
            busy = false; render();
        };
    }
    function idleView() {
        const box = el('div');
        box.append(el('div', { className: 'row' }, el('button', { className: 'mode', textContent: 'Host a room', disabled: busy, title: 'Your browser runs the match and gives you a room code to share', onclick: run('Starting... (getting a room code can take a minute if the server was asleep)', async () => {
            await start();
            try { await openInvites(); } catch (e) { msg = 'You are hosting, but there is no room code: ' + e.message + ' Use Get a room code to try again.'; }
        }) })));
        const input = el('input', { type: 'text', placeholder: 'Room code', maxLength: 8, value: draft.code, autocomplete: 'off', autocapitalize: 'characters' });
        input.addEventListener('input', () => { draft.code = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
        box.append(el('div', { className: 'row', style: 'margin-top:8px' }, input, el('button', { className: 'mode', textContent: 'Join', disabled: busy, onclick: run('Joining...', async () => {
            if (draft.code.length < 4) throw new Error('Type the room code first.');
            await joinWithCode(draft.code);
        }) })));
        return box;
    }
    function hostView() {
        const box = el('div');
        box.append(note('You are hosting. ' + (peers.size ? peers.size + (peers.size === 1 ? ' other player is' : ' other players are') + ' connected.' : 'Nobody else has joined yet.')));
        if (code) {
            box.append(el('div', { className: 'code', textContent: code }),
                el('div', { className: 'row' }, el('button', { className: 'mode', textContent: 'Copy join link', onclick: () => copy(shareLink()) }), el('button', { className: 'mode', textContent: 'Close room code', onclick: closeInvites })),
                note('Friends type this code under Join, or open the link. The code stops working after 15 minutes or when you close it; people already connected stay connected.'));
        } else
            box.append(el('div', { className: 'row' }, el('button', { className: 'mode', textContent: 'Get a room code', disabled: busy, onclick: run('Getting a room code...', () => openInvites()) })));
        box.append(el('div', { className: 'row', style: 'margin-top:8px' }, el('button', { className: 'mode', textContent: 'Stop hosting', onclick: () => { stopping = true; location.href = location.pathname; } })),
            note('Keep this tab open and in view: the match runs in it, and everyone is disconnected if it closes. Ranked play and account names are not available in these rooms.'));
        return box;
    }
    function render() {
        if (!root)
            return;
        root.textContent = '';
        if (typeof RTCPeerConnection === 'undefined') {
            root.append(note('This browser does not support peer-to-peer connections (WebRTC).'));
            return;
        }
        if (net.hosting)
            root.append(hostView());
        else if (net.on)
            root.append(note(net.p2p ? 'You joined a peer-to-peer room. Reload the page to leave it.' : 'You are playing online. Reload the page to host or join a peer-to-peer room.'));
        else
            root.append(idleView());
        if (msg)
            root.append(note(msg));
    }
    document.querySelector('[data-tab="game"]') && document.querySelector('[data-tab="game"]').addEventListener('click', render);

    render();
    { // ?join=CODE in the address: join that room straight away
        const j = new URLSearchParams(location.search).get('join');
        if (j && /^[A-Za-z0-9]{4,8}$/.test(j) && !net.on && typeof RTCPeerConnection !== 'undefined') {
            net.setStatus('Joining room ' + j.toUpperCase() + '...');
            busy = true; msg = 'Joining ' + j.toUpperCase() + '...'; render();
            joinWithCode(j.toUpperCase()).then(() => { msg = ''; }, e => { msg = e.message; net.setStatus(e.message); }).then(() => { busy = false; render(); });
        }
    }
    return { start, openInvites, closeInvites, joinWithCode, get active() { return !!worker; }, get code() { return code; } };
})();
