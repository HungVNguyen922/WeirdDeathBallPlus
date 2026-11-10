// SERVER - serves the game files and runs online matches.  Start:  node js/server/server.js [port]     then open  http://localhost:8080/?room=test  in two tabs.
//
// Model (authoritative host): the server owns the real simulation, one per room. Clients send only their key presses; the server steps the sim at the game's fixed rate and
// sends everybody snapshots of the whole world (saveState), plus the one-off events (goals, impacts, bat hits) the renderer needs for its effects.
// The room logic and the message protocol live in js/host/room.js, which is shared with the peer-to-peer host (js/host/host-worker.js): read the protocol notes there.
// This file is only the plumbing: HTTP (static files, /health, /api/*), the WebSocket upgrade (game rooms, and /signal for peer-to-peer room codes), and the tick loop.
//
// /health reports the measured snapshot traffic (Render's free tier meters outbound traffic).
const http = require('http'), fs = require('fs'), path = require('path');
const { attachWebSocket } = require('./ws.js');
const { loadSim, ROOT } = require('./sim-node.js');
const accounts = require('./accounts.js');
const signal = require('./signal.js');
const { createRoomKit } = require('../host/room.js');
const { skinClean } = require('../skin-data.js');

const STATS = { bytes: 0, snaps: 0, since: Date.now() }; // measured snapshot traffic (see /health)
const MAX_ROOMS = +process.env.MAX_ROOMS || 50; // each room is its own vm context, so size it to your RAM
const kit = createRoomKit({
    makeSim: loadSim, accounts, skinClean, stats: STATS,
    snapEvery: +process.env.SNAP_EVERY, // 6 = 20 Hz (the default), 4 = 30 Hz, 8 = 15 Hz
    snapDecimals: process.env.SNAP_DECIMALS === undefined || process.env.SNAP_DECIMALS === '' ? 2 : +process.env.SNAP_DECIMALS, // decimals kept in snapshots; the server's own simulation is never rounded
});

const SERVE_STATIC = process.env.SERVE_STATIC !== '0'; // set SERVE_STATIC=0 on Render
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean); // e.g. https://wdb.pages.dev
function cors(req, res) {
    const o = req.headers.origin;
    if (o && ALLOWED_ORIGINS.includes(o)) {
        res.setHeader('Access-Control-Allow-Origin', o);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
}

function startServer(port = 8080, host = '0.0.0.0') {
    accounts.init();
    const rooms = new Map();
    const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
    const server = http.createServer((req, res) => { // plain static file server for the game itself (never the server code, tests or dotfiles)
        let p;
        try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400).end(); return; }
        if (p === '/health') {
            const hours = (Date.now() - STATS.since) / 3.6e6;
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                ok: true, rooms: rooms.size, maxRooms: MAX_ROOMS, signalHosts: signal.hostCount(), memMB: Math.round(process.memoryUsage().rss / 1048576), runningRooms: [...rooms.values()].filter(r => r.running).length, minTps: Math.min(...[...rooms.values()].filter(r => r.running && r.tps).map(r => r.tps)) || null, avgSnapBytes: STATS.snaps ? Math.round(STATS.bytes / STATS.snaps) : 0,
                snapshotMB: +(STATS.bytes / 1e6).toFixed(2), snapshots: STATS.snaps, hoursUp: +hours.toFixed(2), mbPerHour: +(STATS.bytes / 1e6 / Math.max(hours, 1e-6)).toFixed(1)
            }));
            return;
        }
        if (p.startsWith('/api/')) {
            cors(req, res);
            if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; } // preflight (the Authorization header triggers one)
            accounts.handleApi(req, res, p);
            return;
        }
        if (!SERVE_STATIC) { res.writeHead(404).end('not found'); return; }
        if (p === '/')
            p = '/index.html';
        const parts = p.split('/').filter(Boolean);
        if (parts.some(s => s === '..' || s.startsWith('.') || s === 'server' || s === 'test' || s === 'node_modules')) {
            res.writeHead(403).end('forbidden');
            return;
        }
        const okTop = (parts.length === 1 && (parts[0] === 'index.html' || parts[0] === 'icon.png')) || parts[0] === 'css' || parts[0] === 'js'; // an allowlist: nothing else in the project folder is ever served
        if (!okTop || /\.(bak|old|py|mid)$/i.test(p)) {
            res.writeHead(404).end('not found');
            return;
        }
        const file = path.join(ROOT, ...parts);
        if (!file.startsWith(ROOT + path.sep)) {
            res.writeHead(403).end('forbidden');
            return;
        }
        fs.stat(file, (err, st) => {
            if (err || !st.isFile()) {
                res.writeHead(404).end('not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            fs.createReadStream(file).pipe(res);
        });
    });

    const onGame = kit.makeConnectionHandler({ rooms, maxRooms: MAX_ROOMS });
    attachWebSocket(server, (conn, req) => {
        if (/^\/signal(\?|$)/.test(req.url || ''))
            signal.attach(conn); // peer-to-peer room codes: only the short WebRTC handshake passes through here, never any game traffic
        else
            onGame(conn);
    });

    const loop = setInterval(() => {
        const now = performance.now();
        for (const r of rooms.values())
            r.advance(now);
    }, 4);
    server.on('close', () => clearInterval(loop));

    return new Promise(resolve => server.listen(port, host, () => resolve({ server, rooms, port: server.address().port, close: () => new Promise(r => { clearInterval(loop); for (const rm of rooms.values()) rm.everyone.forEach(c => c.close(1001)); server.close(r); server.closeAllConnections?.(); }) })));
}

module.exports = { startServer };

if (require.main === module) {
    const port = +(process.argv[2] || process.env.PORT || 8080);
    startServer(port, process.env.HOST || '0.0.0.0').then(s => {
        console.log(`Weird Death Ball server listening on port ${s.port}`);
        console.log(`  play:  http://localhost:${s.port}/?room=test   (open it in two tabs or two machines on your network)`);
        console.log('  stop:  Ctrl+C');
    });
}
