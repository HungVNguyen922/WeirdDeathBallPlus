// HOST WORKER - runs a whole room inside a player's browser. It loads the same simulation files the Node server loads (plus js/host/room.js, the same Room) into this Worker's own
// global scope, which is a separate world from the page's: the page keeps drawing its own copy of the game, this one is the authoritative match.
// WebRTC is not available inside Workers in every browser, so the page (js/host/host.js) owns the data channels and this file only sees "connections" that the page forwards:
//   page -> worker   {t:'open', id}              a connection arrived (id 0 is the host's own player, the others are remote players)
//                    {t:'msg', id, data}         a text message from that connection
//                    {t:'closed', id}            that connection went away
//                    {t:'backlog', n:{id: bytes}}   how much each remote connection still has queued (the room skips snapshots for slow ones)
//   worker -> page   {t:'ready'}  {t:'error', msg}
//                    {t:'send', id, data}        send this text to that connection
//                    {t:'close', id, code}       close that connection
'use strict';

// Same files, same order as SIM_FILES in js/server/sim-node.js (paths here are relative to js/). Keep the two lists in step.
const SIM_FILES = [
    'physics/constants.js', 'physics/terrain.js', 'physics/collision.js', 'physics/ball.js',
    'physics/bat.js', 'physics/player.js', 'physics/player-grapple.js', 'physics/player-collide.js', 'physics/player-casts.js', 'physics/player-specials.js', 'physics/player-hopper.js',
    'physics/bodies.js', 'physics/projectiles.js', 'physics/arrows.js', 'physics/boomerangs.js', 'physics/portals.js', 'physics/swap.js', 'physics/mines.js', 'physics/split.js', 'physics/fighter.js',
    'physics/statics.js', 'physics/accelerator.js', 'physics/builder.js', 'physics/block-interactions.js', 'physics/reel.js',
    'game/rules.js', 'game/simstate.js', 'game/ai.js',
];
const HOSTED_ROOM = 'p2p';

try {
    importScripts(...SIM_FILES.map(f => '../' + f), '../skin-data.js', 'room.js');
} catch (e) {
    postMessage({ t: 'error', msg: 'The host could not load the game files: ' + (e && e.message ? e.message : e) });
}

if (typeof createRoomKit === 'function') {
    // The simulation lives in this Worker's global scope, so "run some code in the sim" is a global (indirect) eval. Top-level let / const from the scripts above are visible to it.
    const sim = { ctx: self, run: code => (0, eval)(code) };
    const kit = createRoomKit({ makeSim: () => sim, skinClean }); // no accounts here: every player is a guest, ranked play is off
    const rooms = new Map();
    const conns = new Map();
    const handler = kit.makeConnectionHandler({ rooms, maxRooms: 1, fixedRoom: HOSTED_ROOM });

    class WorkerConn { // the same small interface the Node server's WebSocket connections have
        constructor(id) { this.id = id; this.open = true; this.buffered = 0; this.handlers = {}; this.remoteAddress = 'peer'; }
        on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
        emit(ev, arg) { for (const f of this.handlers[ev] || []) f(arg); }
        send(str) { if (this.open) postMessage({ t: 'send', id: this.id, data: str }); }
        backlog() { return this.open ? this.buffered : 0; }
        close(code = 1000) {
            if (!this.open)
                return;
            this.open = false;
            conns.delete(this.id);
            postMessage({ t: 'close', id: this.id, code });
            this.emit('close');
        }
    }

    onmessage = e => {
        const m = e.data;
        if (m.t === 'open') {
            const c = new WorkerConn(m.id);
            conns.set(m.id, c);
            handler(c);
        } else if (m.t === 'msg') {
            const c = conns.get(m.id);
            if (c && c.open && typeof m.data === 'string')
                c.emit('message', m.data);
        } else if (m.t === 'closed') {
            const c = conns.get(m.id);
            if (c && c.open) {
                c.open = false;
                conns.delete(m.id);
                c.emit('close');
            }
        } else if (m.t === 'backlog') {
            for (const id in m.n) {
                const c = conns.get(+id);
                if (c)
                    c.buffered = m.n[id];
            }
        }
    };

    setInterval(() => {
        const now = performance.now();
        for (const r of rooms.values())
            r.advance(now);
    }, 4);

    postMessage({ t: 'ready' });
}