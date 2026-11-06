# BUILDER special — integration patches

New files (drop in as-is):
- `js/physics/builder.js`
- `js/render/builder.js`

Nothing here has been run: I only had the repo dump, not a checkout. Run `node js/test/*` and a local match after applying.
`js/physics/constants.js` was not in the dump, so the constants and the `ABILITY` entry below are written to match the other specials but I could not see the real file format. Copy the shape of the `accelerator` entry.

---------------------------------------------------------------------------

## 1. `js/physics/constants.js`

Add (tune freely). `BUILDER_SIZE` should be your player's DIAMETER (2 * player radius) so the square is "the size of you".

```js
const BUILDER_SIZE = 32;          // square side = player diameter (set to 2 * player r). UD is 2*SIZE wide x SIZE tall.
const BUILDER_COOLDOWN = 2.5;     // s after a successful build
const BUILDER_MISS_CD = 0.4;      // s after a build that was blocked by terrain / no room
const BUILDER_MAX = 4;            // blocks per player; the oldest vanishes on the next build
const BUILDER_LIFE = 1e9;         // seconds before a block disappears by itself. MUST be > 0: projectiles die when life <= 0 (0 would remove it instantly). Use e.g. 30 for a timeout.
const BUILDER_M = BALL_M;         // collision mass: same as the death ball (BALL_M, in the units PLAYER_M / BALL_M use)
const BUILDER_G = BALL_G;         // gravity: same as the death ball
const BUILDER_DRAG = 0.05;        // air drag per second: the death ball's (0.05)
const BUILDER_E = 0.25;           // bounce off terrain
const BUILDER_E_BODY = 0.4;       // bounce off the death ball / decoys / other blocks
const BUILDER_E_PLAYER = 0.15;    // bounce off players (low: players land on them)
const BUILDER_MU = 0.5;           // friction between a block and terrain / the ball (players never rub on blocks). Makes blocks tip, roll and spin.
const BUILDER_INHERIT = 1;        // how much of your velocity the block is built with (0 = starts still, 1 = your full momentum)
const BUILDER_BREAK_V = 650;      // closing speed that breaks a block
const BUILDER_TERRAIN_K = 0.7;    // terrain hits count this much toward breaking
const BUILDER_GRACE = 0.3;        // s after being built during which it cannot break
const BUILDER_BREAK_R = 90;       // radius of the break shove
const BUILDER_BREAK_KICK = 260;   // the "slight impulse" on break (u/s)
```
(`BUILDER_FRICTION` and `BUILDER_VMAX` from the first version are gone: blocks use `BALL_VMAX`, `BALL_W_MAX` and `BALL_SPIN_DRAG` directly, like the ball. Place this block AFTER the BALL_* constants.)
`BUILDER_LIFE` must be positive (see above).

Add to the `ABILITY` table (same shape as the other entries, e.g. `accelerator`):
```js
builder: { cd: BUILDER_COOLDOWN },
```
(`player.js` reset() fills `p.cd[id]` from it, and `render/key-hints.js` reads `ABILITY[id].cd` for the key meter.)

---------------------------------------------------------------------------

## 2. Script lists (keep in sync)

`index.html`, after `<script src="js/physics/accelerator.js"></script>`:
```html
<script src="js/physics/builder.js"></script>
```
and after `<script src="js/render/fighter.js"></script>` (PROJ_DRAW is defined there), e.g. next to `render/accelerator.js`:
```html
<script src="js/render/builder.js"></script>
```
`js/server/sim-node.js` `SIM_FILES`: change
`'js/physics/statics.js', 'js/physics/accelerator.js',` to
`'js/physics/statics.js', 'js/physics/accelerator.js', 'js/physics/builder.js',`
(physics only; the render file is not part of the server sim). `build-static.js`: if it keeps its own file list, add both files.

---------------------------------------------------------------------------

## 3. Registering the special (5 places, same id `'builder'`)

- `js/game/rules.js`: append `'builder'` to `PICK_LIST` (before `'fighter'`, which must stay last because it is a dual-slot row).
- `js/render/pick-screen.js` `PICK_DESC`:
  ```js
  builder: ['Builds a block by your arrows:', 'square, 2:1 slab or circle.', 'Weight: triangle, tall slab, oval.'],
  ```
- `js/render/special-menu.js` `SPECIALS`: add `{ id: 'builder', name: 'BUILDER', icon: 'builder' },` before `fighter`, and change `const SP_ROW = 30;` to `26` (21 entries would otherwise run off the canvas; check `HINT_*` layout visually).
- `js/server/server.js` `SPECIAL_IDS`: add `'builder'` before `'fighter'`.
- `js/render/key-hints.js` `iconGlyph`: add before the `kind === 'locked'` branch:
  ```js
  } else if (kind === 'builder') { // a block and a slope stacked
      cx.lineWidth = 2;
      cx.strokeRect(-9, -2, 10, 10);
      cx.beginPath(); cx.moveTo(1, 8); cx.lineTo(9, 8); cx.lineTo(1, -2); cx.closePath(); cx.stroke();
  ```

---------------------------------------------------------------------------

## 4. `js/physics/player-casts.js` — `startAbility`

Builder is instant (no cast). Add next to the other instant ones, e.g. right before `} else if (id === 'warp') {`:
```js
} else if (id === 'builder') { // instant: build a block in the arrows' direction; weight = the sloped / domed version
    if (this.cd.builder <= 0 && !this.sim) {
        buildBlock(this, hx, hy, !!k.x);
        return true;
    }
```
(`!this.sim`: the AI's planning copies must not touch the real world.) No change is needed in the cast-completion chain.

---------------------------------------------------------------------------

## 5. `js/physics/player-collide.js` — standing on blocks

In `stepCollide`, directly after
```js
if (collideTerrain(this, 0, 0, stuckSegs, ARROW_HALF_W))
    this.ground = true; // standing on a stuck arrow counts as ground
```
add:
```js
if (!this.sim && blocksVsPlayer(this))
    this.ground = true; // standing on a builder block counts as ground
```

---------------------------------------------------------------------------

## 6. `js/physics/player-grapple.js` — grappling blocks

Blocks are projectiles, not balls, but they carry `x y vx vy r th=0 w=0`, so the ball tether works unchanged except the hook must sit ON the polygon rather than on the bounding circle. `builder.js` stores nothing for that, so the grapple records it (`hookR`, per player).

1. `candidates(ball)`: after the `for (const b of this.sim ? [ball] : [ball, ...decoys])` loop and before `return c.filter(...)`:
   ```js
   if (!this.sim)
       for (const b of projectiles)
           if (b.type === 'block' && !b.broken) {
               const hp = blockNearest(b, this.x, this.y), hd = Math.hypot(hp.x - this.x, hp.y - this.y);
               c.push({ p: hp, d: hd, len: Math.max(hd, 41), b: true, ground: false, ball: b, decoy: true, block: true });
           }
   ```
   (`blockNearest` returns `{x, y}` on the outline.)
2. `attach(ball)`: replace the line
   `this.hookAng = Math.atan2(best.p.y - best.ball.y, best.p.x - best.ball.x) - best.ball.th;`
   with
   ```js
   this.hookAng = Math.atan2(best.p.y - best.ball.y, best.p.x - best.ball.x) - best.ball.th;
   this.hookR = best.block ? Math.hypot(best.p.x - best.ball.x, best.p.y - best.ball.y) : 0; // 0 = on the ball's edge (tb.r)
   ```
   Also add `this.hookR = 0;` next to `this.hookAng = 0;` in `player.js` (constructor/reset, ~line 6722) so it is saved and reset.
3. Per-tick hook position (the `if (this.onBall)` block that does `a.x = tb.x + Math.cos(ang) * tb.r`): replace `tb.r` with `(this.hookR || tb.r)` in both lines.
4. Mass and inertia. The rope code uses `BALL_TM` and `BALL_I` for whatever it is tied to. Blocks carry their own (`b.tm`, `b.ti`), which is what makes the swing tip a block about the point you grabbed: pulling on a corner spins it, pulling through its middle doesn't. In `step` (the `if (this.onBall) { ... }` rope code) add `const TM = tb.tm || BALL_TM, TI = tb.ti || BALL_I;` once, right after `const a = this.rope, tb = this.tball || ball;`, then replace every `BALL_TM` with `TM` and every `BALL_I` with `TI` in that function (the four places: `im = 1 + 1 / BALL_TM + c * c / BALL_I`, `tb.vx -= nx * J / BALL_TM` and its `tb.vy` line, `tb.w -= J * c / BALL_I`, the `f` pull's `tb.vx / tb.vy -= ... / BALL_TM` and `tb.w += ... / BALL_I`, and the snap's `BALL_TM` terms). Plain balls have no `tm`/`ti`, so they behave exactly as before.
5. `flickBall` needs no change.
6. `lastGrab` (used by ACCELERATOR) is set on `best.ball`, which works for blocks (`lastGrab: -1` is initialised in `buildBlock`).

---------------------------------------------------------------------------

## 7. `js/game/simstate.js` — save / load the tether

Blocks are in `projectiles`, which already round-trips through `owned` / `relink`, so only `tball` needs a new encoding (negative = projectile index).

- `saveState`: `const ballRef = b => (b == null ? null : b === ball ? 0 : decoys.indexOf(b) + 1);` becomes
  ```js
  const ballRef = b => (b == null ? null : b === ball ? 0 : b.type === 'block' ? -(projectiles.indexOf(b) + 1) : decoys.indexOf(b) + 1); // 0 = death ball, 1.. = decoy, ..-1 = projectile (block)
  ```
- `loadState`, last block: `p.tball = r === null ? null : r === 0 ? ball : decoys[r - 1] || null;` becomes
  ```js
  p.tball = r === null ? null : r === 0 ? ball : r < 0 ? projectiles[-r - 1] || null : decoys[r - 1] || null;
  ```
  If `tball` ends up `null` while `onBall` is true after a load, also clear `p.onBall`/`p.rope` (same as a decoy that no longer exists).
  Note `hookR` is a plain number on the player, so `cloneData` already carries it.

---------------------------------------------------------------------------

## 8. `js/net/predict.js` — known gap

The prediction-merge code (≈ lines 4426–4456) understands only `tball > 0` (decoy index). A block tether is `tball < 0`, so in the merge step treat `q.tball < 0` as "let go" for OTHER players (`tball: null, onBall: false, rope: null`) and leave your own as is. Blocks are projectiles, which are already interpolated and rolled back, so the only visible effect of skipping this is a possible rope snap on a mispredict, not a desync (the server is authoritative).

---------------------------------------------------------------------------

## 9. Behaviour notes / assumptions to confirm

- LR: square / right triangle (upright side toward you, slope away). UD: 2 wide x 1 tall slab / 1 wide x 2 tall (with weight). N: circle / oval 2 wide x 1 tall (the spec didn't say which way the oval lies: change `ring(S, h, 20)` in `bkShape` to `ring(h, S, 20)` for a tall one).
- No arrows builds toward the net side; a diagonal counts as LR. The block is built with your velocity; players take no friction from blocks.
- Blocks are rigid bodies (rotating), with the death ball's gravity, drag, speed cap and spin drag, and they pass through the net (the net does not affect the ball either).
- Max 4 blocks per player, the oldest vanishes. Blocks collide with the net and are solid for players, the ball, decoys and each other.
- Break: closing speed > `BUILDER_BREAK_V` (terrain hits weigh `BUILDER_TERRAIN_K`). Breaking removes the block, shoves everything within `BUILDER_BREAK_R` by `BUILDER_BREAK_KICK`, and releases anyone tethered to it.
- A block's shape is plain data (`pts` around its centre of mass) plus `th` / `w`, so saving, rollback and the grapple hook (`hookAng`/`hookR` relative to `th`) all work.
