// Loads the game's simulation files (no renderer, no audio, no DOM) into an isolated Node context and exposes it.
// The game's files are plain browser <script>s that share top-level const/let, so they are run in ONE vm context in index.html's order.
// Usage:  const sim = loadSim();   sim.run('update()');   sim.eval('players[0].x')
const fs = require('fs'), path = require('path'), vm = require('vm');

// The project root is the nearest folder above this file that holds js/physics/constants.js, so this file works wherever it is put (server/, js/server/, ...).
function findRoot() {
    for (let dir = __dirname; ; dir = path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'js', 'physics', 'constants.js')))
            return dir;
        if (path.dirname(dir) === dir)
            throw new Error('sim-node.js: could not find js/physics/constants.js in any folder above ' + __dirname);
    }
}
const ROOT = findRoot();
const SIM_FILES = [ // same order as index.html's <script> tags, minus everything that draws, plays sound or reads the keyboard
    'js/physics/constants.js', 'js/physics/terrain.js', 'js/physics/collision.js', 'js/physics/ball.js',
    'js/physics/bat.js', 'js/physics/player.js', 'js/physics/player-grapple.js', 'js/physics/player-collide.js', 'js/physics/player-casts.js', 'js/physics/player-specials.js', 'js/physics/player-hopper.js',
    'js/physics/bodies.js', 'js/physics/projectiles.js', 'js/physics/arrows.js', 'js/physics/boomerangs.js', 'js/physics/portals.js', 'js/physics/swap.js', 'js/physics/mines.js', 'js/physics/split.js', 'js/physics/fighter.js', 
    'js/physics/statics.js', 'js/physics/accelerator.js', 'js/physics/builder.js', 
    'js/game/rules.js', 'js/game/simstate.js', 'js/game/ai.js',
];

const SIM_SCRIPTS = new Map(); // file -> compiled vm.Script, built once and reused by every room (each room still gets its own fresh context)
function simScript(f) {
    let s = SIM_SCRIPTS.get(f);
    if (!s)
        SIM_SCRIPTS.set(f, s = new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }));
    return s;
}
function loadSim() {
    const ctx = vm.createContext({ console });
    for (const f of SIM_FILES)
        simScript(f).runInContext(ctx);
    const run = code => vm.runInContext(code, ctx);
    return {
        ctx,
        run,
        eval: run,
        tick: () => run('update()'),
        save: () => run('saveState()'),
        load: s => { ctx.__s = s; run('loadState(__s)'); delete ctx.__s; },
        hash: () => run('stateHash()'),
    };
}

module.exports = { loadSim, SIM_FILES, ROOT };
