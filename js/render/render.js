// QUAKE SHAKE: the whole picture jiggles while a quake graphic is running, harder for a harder slam (quakeFx.s, 0..1) and dying away with the graphic (QUAKE_FX_T).
// Put quakeShake() anywhere above draw() in js/render/render.js, and replace draw() with the one below.
const QUAKE_SHAKE_PX = 2; // peak jiggle in px at the hardest slam, right at the moment of impact. THE knob: lower = subtler, higher = heavier
function quakeShake() { // display only: reads quakeFx, never writes anything
    // The offset is a pure function of the time LEFT on the quake (no state, no random numbers), so it looks the same online and simply holds still if the game is paused.
    const q = quakeFx;
    if (q.t <= 0)
        return { x: 0, y: 0 };
    const t = q.t, k = t / QUAKE_FX_T, amp = QUAKE_SHAKE_PX * Math.sqrt(q.s) * k; // sqrt: even a weak quake gives a small but visible rumble, a big one a lot more
    const x = (Math.sin(t * 113) + 0.5 * Math.sin(t * 271 + 1.7)) / 1.5, y = (Math.sin(t * 127 + 2.1) + 0.5 * Math.sin(t * 233 + 0.4)) / 1.5; // two out-of-step wobbles per axis, so it rumbles rather than swings
    return { x: Math.round(amp * 0.7 * x), y: Math.round(amp * y) }; // a pop is mostly vertical; whole pixels keep the shapes crisp
}

function drawScene() {
    cx.save();
    cx.translate(OX, HUD); // arena coordinates stay 0..W, 0..H; the margins are negative x / x > W
    cx.beginPath(); cx.rect(-OX, 0, CW, H + PIT); cx.clip();
    const sh = quakeShake();
    if (sh.x || sh.y) { // draw() never clears the canvas, so paint the out-of-bounds colour first: the strip the shake uncovers at the edge shows that instead of last frame's pixels
        cx.fillStyle = '#0b0e12';
        cx.fillRect(-OX, 0, CW, H + PIT);
    }
    cx.save();
    cx.translate(sh.x, sh.y); // everything in the picture shakes together...
    drawArena();
    drawQuakeFx(); // the seesaw floor's quake graphic: on the floor, behind everything that stands on it
    drawPongSurfaces(); // new: the rubber glow, over the terrain and behind everything on it
    drawAccelerators(); // placed accelerator nodes and the lines between them
    drawMines(); // planted mines, the planting ring and the blast ring: on the surfaces, behind everything that moves
    drawHud(); // the score (and the online status under it) live on the floor, drawn in arena coordinates right after the arena they sit on
    drawMenuTile(); // the Menu tile on Blue's wall, under the weight key
    const hid = smokeBeginHide(); // Smoke Screen: everything from here to drawBoomerangs is cut out of the other team's cloud
    drawPegs();    drawAITags();
    drawCasts();
    drawWarps();
    drawPortals();
    drawSwaps();
    drawAwakened();
    drawPongRings();    // new: next to the Awakened ring, so Smoke hides it from the other team too
    drawExplode();
    drawMineBlasts();
    drawGrappleRange();
    drawRopes();
    drawReelFx();
    drawDashStreaks();
    drawPlayerTrails();
    drawPlayers();
    drawClones();
    drawNames();
    drawBalls();
    drawImpacts();
    drawProjectiles(); drawFighterMoves(); drawFighterInputs(); drawStuns();
    smokeEndHide(hid);
    drawSmoke();
    drawPointFx();
    cx.restore();
    drawPickScreen(); // ...except the screens drawn over it, which have things to click on: the special-ability select grid, when one is open,
    drawSideChangeBanner(performance.now()); // the "SIDE CHANGE" banner, over everything except the menu
    drawSpecialMenu(); // and the special menu
    cx.restore();
}
 
// Visual-effects toggle: hides the Hyper / Xeric bursts and the Quake graphic + screen shake. Display only: the physics timers are put back right after drawing.
const FLOORFX_STORE = 'wdb-floorfx';
let floorFxOn = true;
try { floorFxOn = localStorage.getItem(FLOORFX_STORE) !== '0'; } catch (e) {}
function setFloorFx(v) {
    floorFxOn = !!v;
    try { localStorage.setItem(FLOORFX_STORE, floorFxOn ? '1' : '0'); } catch (e) {}
    const b = document.getElementById('floorfx');
    if (b) {
        b.textContent = 'Floor effects: ' + (floorFxOn ? 'On' : 'Off');
        b.classList.toggle('on', floorFxOn);
    }
}
{
    const b = document.getElementById('floorfx');
    if (b)
        b.addEventListener('click', () => { setFloorFx(!floorFxOn); cv.focus(); });
    setFloorFx(floorFxOn); // paints the label from the remembered setting
}
function draw() {
    if (floorFxOn)
        return drawScene();
    const saved = allPlayers.map(p => [p.hyperT, p.xericT, p.boostFx, p.fizzleFx]), qt = quakeFx.t;
    for (const p of allPlayers)
        p.hyperT = p.xericT = p.boostFx = p.fizzleFx = 0;
    quakeFx.t = 0; // drawQuakeFx and quakeShake both read this
    try { drawScene(); } finally {
        allPlayers.forEach((p, i) => { [p.hyperT, p.xericT, p.boostFx, p.fizzleFx] = saved[i]; });
        quakeFx.t = qt;
    }
}