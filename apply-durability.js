// Builder changes: (1) two durability levels: 1:1 blocks (square, triangle, circle) break at BUILDER_BREAK_V, 2:1 blocks (slab, tall slab, oval) at BUILDER_DUR_BIG x that.
// (2) A block that is moving the SAME WAY as the player it touches pushes them instead of breaking on the impact (BUILDER_PUSH_MIN_V = how fast both must be going to count).
// Run from your project root (or any folder in it):   node apply-durability.js     Edits js/physics/builder.js and js/physics/constants.js by finding text, not line numbers.
// Skips edits already made; if an anchor is missing it writes NOTHING and says which.
const fs = require('fs'), path = require('path');
const roots = []; for (const st of [process.cwd(), __dirname]) for (let d = st; ; d = path.dirname(d)) { roots.push(d); if (path.dirname(d) === d) break; }
const root = roots.find(d => fs.existsSync(path.join(d, 'js', 'physics', 'builder.js')));
if (!root) { console.error('could not find js/physics/builder.js (run this inside your WeirdDeathBallPlus folder)'); process.exit(1); }
const rd = f => { const s = fs.readFileSync(path.join(root, f), 'utf8'); return { s: s.replace(/\r\n/g, '\n'), eol: s.includes('\r\n') ? '\r\n' : '\n' }; };
const B = rd('js/physics/builder.js'), C = rd('js/physics/constants.js');
const fail = m => { console.error('\n' + m + '\nNOTHING was written.'); process.exit(1); };
let did = 0;
const once = (F, name, done, a, b) => {
    if (F.s.includes(done)) return console.log('  already in place  ' + name);
    const n = F.s.split(a).length - 1;
    if (n !== 1) fail('Could not place "' + name + '": its anchor appears ' + n + ' times (expected 1).\nLooking for: ' + a.split('\n')[0].trim());
    F.s = F.s.replace(a, () => b); did++; console.log('  + ' + name);
};
// constants.js: two new numbers right after BUILDER_BREAK_V
if (C.s.includes('BUILDER_DUR_BIG')) console.log('  already in place  constants');
else {
    const m = /^const BUILDER_BREAK_V\b.*$/m.exec(C.s);
    if (!m) fail('Could not find "const BUILDER_BREAK_V" in constants.js. Add these two lines yourself next to the other BUILDER_ constants:\n  const BUILDER_DUR_BIG = 2;\n  const BUILDER_PUSH_MIN_V = 40;');
    C.s = C.s.slice(0, m.index + m[0].length) +
        '\nconst BUILDER_DUR_BIG = 2;        // 2:1 blocks (slab, tall slab, oval) take this many times BUILDER_BREAK_V to break. 1:1 blocks (square, triangle, circle) break at BUILDER_BREAK_V: lower that to make them frailer.' +
        '\nconst BUILDER_PUSH_MIN_V = 40;    // u/s: a block and a player both moving at least this fast the same way push each other instead of breaking the block' +
        C.s.slice(m.index + m[0].length);
    did++; console.log('  + constants (BUILDER_DUR_BIG, BUILDER_PUSH_MIN_V)');
}
once(B, 'each block records its durability', 'dur: kind === ',
    `lastGrab: -1, shape: kind + (tri ? 'T' : '') });`,
    `lastGrab: -1, shape: kind + (tri ? 'T' : ''), dur: kind === 'UD' || (kind === 'N' && tri) ? BUILDER_DUR_BIG : 1 }); // dur: 2:1 shapes (slab, tall slab, oval) are sturdier`);
once(B, 'a block moving with the player pushes instead of breaking', 'together',
    `    k.hitV = Math.max(k.hitV, cv * (c.crashK || 1)); // (Awakened players hit harder)`,
    `    if (!together) // (a block and a player moving the same way just push each other: no break)
        k.hitV = Math.max(k.hitV, cv * (c.crashK || 1)); // (Awakened players hit harder)`);
once(B, 'measure which way each was going', 'kvn0',
    `    const cv = bkImpulse(k, c, 1 / mc,`,
    `    const kvn0 = k.vx * h.nx + k.vy * h.ny, cvn0 = c.vx * h.nx + c.vy * h.ny; // before the impulse: each one's speed along the contact line (it points from the block to c)
    const together = c instanceof Player && kvn0 * cvn0 > 0 && Math.min(Math.abs(kvn0), Math.abs(cvn0)) > BUILDER_PUSH_MIN_V; // both going the same way: a push, not a crash
    const cv = bkImpulse(k, c, 1 / mc,`);
once(B, 'break threshold scales with durability', '(b.dur || 1)',
    `if (b.age > BUILDER_GRACE && b.hitV > BUILDER_BREAK_V)`,
    `if (b.age > BUILDER_GRACE && b.hitV > BUILDER_BREAK_V * (b.dur || 1))`);
once(B, 'the crack display follows the durability', 'b.hitV / (BUILDER_BREAK_V',
    `Math.min(1, b.hitV / BUILDER_BREAK_V)`,
    `Math.min(1, b.hitV / (BUILDER_BREAK_V * (b.dur || 1)))`);
if (did) { fs.writeFileSync(path.join(root, 'js/physics/builder.js'), B.s.replace(/\n/g, B.eol)); fs.writeFileSync(path.join(root, 'js/physics/constants.js'), C.s.replace(/\n/g, C.eol)); }
console.log('\n' + did + ' edits made.');
