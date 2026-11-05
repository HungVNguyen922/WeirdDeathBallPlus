// SERVER - a small, dependency-free WebSocket server (RFC 6455) on top of Node's http module, so the game server runs with plain `node server/server.js` and no `npm install`.
// It does only what the game needs: text frames, ping/pong, clean close, fragmentation, a payload size limit. No extensions (no compression).
// The rest of the server only sees the tiny interface below, so swapping this file for the `ws` package later means changing this one file:
//     attachWebSocket(httpServer, onConnection)      onConnection(conn)
//     conn.send(string)    conn.close(code?)    conn.on('message', str => ...)    conn.on('close', () => ...)    conn.remoteAddress
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024; // one message may not be bigger than this (the game's messages are a few KB at most)
const MAX_PER_IP = +process.env.MAX_CONN_PER_IP || 20; // simultaneous connections from one address (loopback is exempt, so local tests are unaffected)
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean); // same list server.js uses for CORS; empty = any origin
const PING_EVERY = 15000, DEAD_AFTER = 40000; // ms: ping idle connections, drop ones that have been silent this long

class Conn extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
        this.remoteAddress = socket.remoteAddress;
        this.open = true;
        this.buf = Buffer.alloc(0);
        this.frag = null; // { op, parts: [] } while a fragmented message is arriving
        this.lastSeen = Date.now();
        socket.setNoDelay(true); // no Nagle: small messages go out immediately (this matters a lot for a real-time game)
        socket.on('data', d => this.onData(d));
        socket.on('close', () => this.end());
        socket.on('error', () => this.end());
    }
    backlog() { // bytes queued for this client that the network has not taken yet
        return this.open ? this.socket.writableLength : 0;
    }
    send(str) {
        if (this.open)
            this.write(0x1, Buffer.from(str, 'utf8'));
    }
    write(op, payload) {
        const n = payload.length;
        let head;
        if (n < 126)
            head = Buffer.from([0x80 | op, n]);
        else if (n < 65536) {
            head = Buffer.alloc(4);
            head[0] = 0x80 | op;
            head[1] = 126;
            head.writeUInt16BE(n, 2);
        } else {
            head = Buffer.alloc(10);
            head[0] = 0x80 | op;
            head[1] = 127;
            head.writeBigUInt64BE(BigInt(n), 2);
        }
        this.socket.write(Buffer.concat([head, payload])); // server frames are never masked
    }
    close(code = 1000) {
        if (!this.open)
            return;
        const p = Buffer.alloc(2);
        p.writeUInt16BE(code);
        try { this.write(0x8, p); } catch (e) { /* socket already gone */ }
        this.socket.end();
        this.end();
    }
    end() {
        if (!this.open)
            return;
        this.open = false;
        this.socket.destroy();
        this.emit('close');
    }
    onData(d) {
        this.lastSeen = Date.now();
        this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
        while (this.open) {
            const b = this.buf;
            if (b.length < 2)
                return;
            const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
            let len = b[1] & 0x7f, off = 2;
            if (len === 126) {
                if (b.length < 4)
                    return;
                len = b.readUInt16BE(2);
                off = 4;
            } else if (len === 127) {
                if (b.length < 10)
                    return;
                const big = b.readBigUInt64BE(2);
                if (big > BigInt(MAX_PAYLOAD))
                    return this.close(1009);
                len = Number(big);
                off = 10;
            }
            if (len > MAX_PAYLOAD)
                return this.close(1009); // message too big
            if (!masked)
                return this.close(1002); // clients must mask (protocol error otherwise)
            if (b.length < off + 4 + len)
                return; // wait for the rest
            const mask = b.subarray(off, off + 4), payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
            for (let i = 0; i < len; i++)
                payload[i] ^= mask[i & 3];
            this.buf = b.subarray(off + 4 + len);
            this.onFrame(fin, op, payload);
        }
    }
    onFrame(fin, op, payload) {
        if (op >= 0x8) { // control frames
            if (op === 0x8)
                return this.close(1000);
            if (op === 0x9)
                this.write(0xA, payload); // ping -> pong
            return; // 0xA pong: lastSeen already updated
        }
        if (op === 0x1 || op === 0x2) {
            if (this.frag)
                return this.close(1002);
            this.frag = { op, parts: [payload], size: payload.length };
        } else if (op === 0x0) {
            if (!this.frag)
                return this.close(1002);
            this.frag.parts.push(payload);
            this.frag.size += payload.length;
            if (this.frag.size > MAX_PAYLOAD)
                return this.close(1009);
        } else
            return this.close(1002);
        if (fin) {
            const { op: o, parts } = this.frag;
            this.frag = null;
            if (o === 0x1)
                this.emit('message', Buffer.concat(parts).toString('utf8')); // binary messages are ignored: the game speaks text (JSON)
        }
    }
}

function attachWebSocket(httpServer, onConnection) {
    const live = new Set(), perIp = new Map();
    httpServer.on('upgrade', (req, socket) => {
        const key = req.headers['sec-websocket-key'];
        if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
            return;
        }
        // ---- abuse limits (see apply-fixes.js) ----
        const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
        const ip = (xff.length ? xff[xff.length - 2] : socket.remoteAddress) || '', loop = /^(::1|127\.|::ffff:127\.)/.test(ip);
        const origin = req.headers.origin;
        if (origin && ORIGINS.length && !ORIGINS.includes(origin)) {
            try { if (new URL(origin).host !== req.headers.host) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; } } catch (e) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
        }
        if (!loop && (perIp.get(ip) || 0) >= MAX_PER_IP) {
            socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');
            return;
        }
        const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
        const conn = new Conn(socket);
        live.add(conn);
        if (!loop)
            perIp.set(ip, (perIp.get(ip) || 0) + 1);
        conn.on('close', () => { live.delete(conn); if (!loop) perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1)); });
        onConnection(conn, req);
    });
    const timer = setInterval(() => { // keepalive: ping everyone, drop the dead
        const now = Date.now();
        for (const c of live) {
            if (now - c.lastSeen > DEAD_AFTER)
                c.end();
            else if (now - c.lastSeen > PING_EVERY)
                c.write(0x9, Buffer.alloc(0));
        }
    }, 5000);
    timer.unref();
    httpServer.on('close', () => clearInterval(timer));
}

module.exports = { attachWebSocket, MAX_PAYLOAD };
