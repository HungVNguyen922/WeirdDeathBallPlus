// MUSIC - plays BeepBox songs (song-data format) through a live Web Audio synth, or looped recordings. One song per place: see THEMES just below (js/audio/themes/mainTheme, c1s6, ...).
// Load order in your HTML:  <script src="song-data.js"></script> (optional now: it is only the fallback when js/audio/themes has no mainTheme)  then  <script src="music.js"></script>
// To make a song: edit it in BeepBox, export .mid, run  python midi_to_song.py song.mid > js/audio/themes/c1s6.js  and add its name to THEME_FILES
// To change how each channel SOUNDS: edit the instrument tables in INSTRUMENTS below (and the knobs just above them).
// A look-ahead scheduler keeps stepping through the loop forever, so there is no gap and reverb / delay tails
// ring straight across the loop point. Press M or use the Music button to mute.
//
// The six pitched channels are small FM synths, written to match the instruments in the BeepBox file:
// operator frequency ratios, how much each operator modulates another, and the "twang" envelopes (a bright, hard attack that
// mellows quickly, which is what makes a plucked-string / koto sound) all come from there.
const Music = (() => {
    // ---- THEMES: one song per place (the menu / base game, each campaign stage) ----
    // A theme is a file in THEME_DIR named after it. Two kinds work, and the first one found for a name is used:
    //   NAME.js              a BeepBox song in the song-data.js format (midi_to_song.py output: a `const SONG = {...}`; any variable name will do), played by the synth below
    //   NAME.mp3 .ogg .wav   a recording, looped
    // Names:  mainTheme = the menu and the base game.   c<campaign>s<stage> = a campaign stage, e.g. c1s6 = campaign 1, stage 6 (campaign.js asks for them, see campaignThemeName).
    // A stage with no song falls back to mainTheme. List every song you have in THEME_FILES (that stops the game asking for files that are not there).
    const THEME_DIR = 'js/audio/themes/';
    const THEME_MAIN = 'mainTheme';
    const THEME_FILES = ['mainTheme', 'c1s4', 'c1s5', 'c1s6'];
    const THEME_EXT = ['js', 'mp3', 'ogg', 'wav', 'm4a'];
    let song = typeof SONG !== 'undefined' ? SONG : null;   // the song the synth plays (the built-in one from song-data.js until a theme loads)
    let BPM = 130, STEP = 60 / 130 / 4;          // one 16th note, in seconds (BPM comes from the BeepBox file)
    const BAR = 16;                              // steps per bar
    let STEPS = song ? song.bars * BAR : 16;     // steps in the whole loop
    const setTiming = () => { BPM = song.bpm; STEP = 60 / BPM / 4; STEPS = song.bars * BAR; };
    if (song) setTiming();
    const AHEAD = 0.3, TICK = 50;                // schedule 0.3 s ahead, check every 50 ms
    const LEVEL = 0.38;                          // master volume (it's background music)
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

    // ---- sound knobs ----
    const FM_INDEX = 3.2;   // overall FM brightness: higher = brighter / glassier / more metallic, lower = rounder
    const RING = 1;         // multiplies every note's ring-out after it ends (BeepBox's fade-out of 48 ticks is very long; 1 is a shortened version of that)
    const PLUCK = 1;        // multiplies how fast plucks lose their brightness: lower = longer sparkle, higher = quicker, drier "pluck"

    // ---- audio graph state ----
    let ctx = null, master, duck, revIn, dlyIn, noiseBuf, dlyNode;
    let enabled = true, step = 0, nextT = 0, timer = null;
    try { enabled = localStorage.getItem('wdb-music') !== '0'; } catch (e) {}

    function init() {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15;
        master = ctx.createGain(); master.gain.value = 0;
        master.connect(comp); comp.connect(ctx.destination);
        duck = ctx.createGain();                       // sidechain-style pump: pads and arps dip on every kick
        duck.connect(master);
        // reverb: generated noise impulse response
        const len = Math.floor(ctx.sampleRate * 2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        }
        const conv = ctx.createConvolver(); conv.buffer = ir;
        revIn = ctx.createGain();
        const revOut = ctx.createGain(); revOut.gain.value = 0.45;
        revIn.connect(conv); conv.connect(revOut); revOut.connect(master);
        // dotted-eighth feedback delay
        const dly = dlyNode = ctx.createDelay(1); dly.delayTime.value = STEP * 3;
        const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
        const fb = ctx.createGain(); fb.gain.value = 0.36;
        const dlyOut = ctx.createGain(); dlyOut.gain.value = 0.5;
        dlyIn = ctx.createGain();
        dlyIn.connect(dly); dly.connect(dlp); dlp.connect(fb); fb.connect(dly); dlp.connect(dlyOut); dlyOut.connect(master);
        // shared white noise for hats / claps
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        theme.name = null;
        startTheme(theme.want);                        // (a theme asked for before the first key press starts now)
    }

    // ---- FM voice ----
    // An FM synth note is a few sine oscillators ("operators") where some of them wobble the pitch of others. That wobble adds overtones:
    // a lot of it = bright and metallic, a little = round. Fade the wobble out quickly after the attack and you get a pluck.
    //   ops    [{ r: frequency ratio to the note, a: 0-15 level (as in BeepBox), env: optional shape for it }]
    //   mods   [[i, j], ...] operator i modulates operator j (0-based)          out  which operators you actually hear
    //   env    { fall: s, floor: 0-1 } = starts at full, settles to floor over about `fall` seconds;  { rise: s, from: 0-1 } = swells up from `from`
    const idx = a => FM_INDEX * (a / 15) * (a / 15);   // BeepBox 0-15 level -> modulation index
    function shape(param, base, e, t) {
        if (!e) { param.setValueAtTime(base, t); return; }
        if (e.fall) {
            param.setValueAtTime(base, t);
            param.setTargetAtTime(base * e.floor, t, Math.max(0.005, e.fall / PLUCK));
        } else {
            param.setValueAtTime(base * e.from, t);
            param.setTargetAtTime(base, t, Math.max(0.005, e.rise));
        }
    }
    function fm(o) {
        const { t, freq, dur, ops, mods, out, vol = 0.1, a = 0.004, r = 0.3, filt, pl, scoop = 0, sub = 0, vib = 0, det = 0,
                dest = master, rev = 0, dly = 0 } = o;
        const hold = t + Math.max(a, dur), end = hold + r * RING;
        const osc = ops.map(op => {
            const x = ctx.createOscillator();
            x.frequency.value = freq * op.r;
            x.detune.value = det;
            return x;
        });
        for (const [i, j] of mods) {                   // operator i wobbles operator j's pitch by (index x i's own frequency) Hz
            const g = ctx.createGain();
            shape(g.gain, idx(ops[i].a) * freq * ops[i].r, ops[i].env, t);
            osc[i].connect(g);
            g.connect(osc[j].frequency);
        }
        const mix = ctx.createGain();
        for (const c of out) {
            const g = ctx.createGain();
            shape(g.gain, ops[c].a / 15 / Math.sqrt(out.length), ops[c].env, t);
            osc[c].connect(g);
            g.connect(mix);
            if (scoop) {                               // the string "pulled sharp" at the very start of a pluck
                const f = freq * ops[c].r;
                osc[c].frequency.setValueAtTime(f * (1 + scoop), t);
                osc[c].frequency.exponentialRampToValueAtTime(f, t + 0.035);
            }
        }
        const extra = [];
        if (sub) {                                     // plain sine at the note's own pitch: low-end weight
            const s = ctx.createOscillator(), g = ctx.createGain();
            s.frequency.value = freq; g.gain.value = sub;
            s.connect(g); g.connect(mix);
            extra.push(s);
        }
        let n = mix;
        if (filt) {                                    // low-pass that starts open and closes: the other half of the pluck
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass'; f.Q.value = filt.q || 0.7;
            f.frequency.setValueAtTime(filt.from, t);
            f.frequency.setTargetAtTime(filt.to, t, Math.max(0.005, (filt.tc || 0.15) / PLUCK));
            n.connect(f); n = f;
        }
        if (pl) {                                      // the note's loudness itself dies away, like a string does
            const g = ctx.createGain();
            g.gain.setValueAtTime(1, t);
            g.gain.setTargetAtTime(pl.sus, t, Math.max(0.01, pl.tc));
            n.connect(g); n = g;
        }
        const gate = ctx.createGain();
        gate.gain.setValueAtTime(0.0001, t);
        gate.gain.linearRampToValueAtTime(vol, t + a);
        gate.gain.setValueAtTime(vol, hold);
        gate.gain.exponentialRampToValueAtTime(0.0001, end);
        n.connect(gate); gate.connect(dest);
        if (rev) { const s = ctx.createGain(); s.gain.value = rev; gate.connect(s); s.connect(revIn); }
        if (dly) { const s = ctx.createGain(); s.gain.value = dly; gate.connect(s); s.connect(dlyIn); }
        if (vib) {                                     // vibrato that fades in a moment after the attack
            const l = ctx.createOscillator(), lg = ctx.createGain();
            l.frequency.value = 5.5;
            lg.gain.setValueAtTime(0, t);
            lg.gain.linearRampToValueAtTime(vib, t + 0.3);
            l.connect(lg);
            for (const x of osc) lg.connect(x.detune);
            l.start(t); l.stop(end + 0.05);
        }
        for (const x of osc.concat(extra)) { x.start(t); x.stop(end + 0.05); }
    }

    // ---- simple (non-FM) voice: used for the saw layers of the lead ----
    function voice(o) {
        const { t, dur, freq, type = 'sawtooth', vol = 0.1, a = 0.005, r = 0.05, cut, cutEnd, cd, q = 1,
                dest = master, rev = 0, dly = 0, det = 0, vib = 0, scoop = 0 } = o;
        const osc = ctx.createOscillator();
        osc.type = type; osc.frequency.value = freq; osc.detune.value = det;
        if (scoop) {                                   // slide into the note from a little flat (negative) or sharp (positive)
            osc.frequency.setValueAtTime(freq * (1 + scoop), t);
            osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
        }
        const g = ctx.createGain(), hold = t + Math.max(a, dur), end = hold + r;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + a);
        g.gain.setValueAtTime(vol, hold);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        let n = osc;
        if (cut) {
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass'; f.Q.value = q;
            f.frequency.setValueAtTime(cut, t);
            if (cutEnd) f.frequency.exponentialRampToValueAtTime(cutEnd, t + (cd || dur));
            osc.connect(f); n = f;
        }
        n.connect(g); g.connect(dest);
        if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(revIn); }
        if (dly) { const s = ctx.createGain(); s.gain.value = dly; g.connect(s); s.connect(dlyIn); }
        if (vib) {
            const l = ctx.createOscillator(), lg = ctx.createGain();
            l.frequency.value = 5.5; lg.gain.value = vib;
            l.connect(lg); lg.connect(osc.detune);
            l.start(t); l.stop(end + 0.05);
        }
        osc.start(t); osc.stop(end + 0.05);
    }

    // ---- drums ----
    function noise(t, len, type, freq, vol, q = 0.7, dest = master) {
        const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        s.connect(f); f.connect(g); g.connect(dest);
        s.start(t, Math.random() * 0.5); s.stop(t + len + 0.02);
    }
    function kick(t) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(170, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(0.95, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + 0.32);
        duck.gain.cancelScheduledValues(t);
        duck.gain.setValueAtTime(0.25, t);
        duck.gain.linearRampToValueAtTime(1, t + 0.2);
    }
    const hat = (t, vol, len) => noise(t, len, 'highpass', 7500, vol, 0.7);
    const clap = (t, vol) => { noise(t - 0.012, 0.03, 'bandpass', 1700, vol * 0.6, 0.8); noise(t, 0.16, 'bandpass', 1700, vol, 0.8); };

    // ---- the instruments: one table per BeepBox channel ----
    // Each is the BeepBox instrument translated: same operator ratios and levels, same modulation routing ("1←(2 3←4)" = op 2 and op 3 modulate op 1,
    // and op 4 modulates op 3), and the same twang / swell envelopes. Operators are written 0-based here, so BeepBox's op 1 is index 0.
    // An env of { fall: 0.15 } means "bright at the start, settled in about 0.15 s": shorter = harder pluck.
    const INSTRUMENTS = {
        // KOTO: the slow melody. Carrier at 4x with a 1x and a (twanging) 11x operator wobbling it = a hard, bright string attack that
        // mellows fast; the filter closes over the same time, and the note keeps ringing long after it ends.
        koto: {
            ops: [{ r: 4, a: 14 }, { r: 1, a: 10 }, { r: 11, a: 3, env: { fall: 0.10, floor: 0.08 } }, { r: 1, a: 11 }],
            mods: [[1, 0], [2, 0], [3, 2]], out: [0],
            filt: { from: 9000, to: 3300, tc: 0.12 }, pl: { tc: 0.9, sus: 0.3 }, scoop: 0.012,
            vol: 0.085, a: 0.002, r: 1.3, rev: 0.45, dly: 0.3,
        },
        // HARP: the fast runs. Two carriers (1x and 6x, each with its own modulator) = glassy, bell-like strings; the modulators twang away in a
        // fraction of a second. Each note is short but rings, so the runs blur into a koto glissando.
        harp: {
            ops: [{ r: 1.012, a: 12 }, { r: 6, a: 10 }, { r: 4, a: 8, env: { fall: 0.22, floor: 0.08 } }, { r: 2.01, a: 8, env: { fall: 0.22, floor: 0.08 } }],
            mods: [[2, 0], [3, 1]], out: [0, 1],
            filt: { from: 9500, to: 4700, tc: 0.08 }, pl: { tc: 0.5, sus: 0.2 }, scoop: 0.008,
            vol: 0.13, a: 0.001, r: 1.0, rev: 0.4, dly: 0.35,
        },
        // CHORDS: a plucked FM electric-piano stab that rings; the 16x operator is the bright "tine" click on top. Played twice, slightly detuned, for width.
        chords: {
            ops: [{ r: 1, a: 15 }, { r: 1, a: 12 }, { r: 16, a: 4, env: { fall: 0.12, floor: 0.05 } }, { r: 1, a: 7 }],
            mods: [[1, 0], [2, 0], [3, 2]], out: [0],
            filt: { from: 7500, to: 1800, tc: 0.4 }, pl: { tc: 1.1, sus: 0.45 },
            vol: 0.03, a: 0.004, r: 1.4, rev: 0.5, dest: 'duck',
        },
        // BASS A: the rolling low line. Carriers at 3x and 4x (so it speaks even on small speakers) with a slowly swelling 7x operator for a hollow,
        // metallic, marimba-ish growl. A sine sub underneath keeps the weight.
        bassA: {
            ops: [{ r: 4, a: 9 }, { r: 3, a: 9 }, { r: 2, a: 7 }, { r: 7, a: 5, env: { rise: 0.25, from: 0.2 } }],
            mods: [[2, 0], [3, 1]], out: [0, 1],
            filt: { from: 2800, to: 2800, tc: 0.1, q: 1 }, sub: 0.35, vib: 8,
            vol: 0.11, a: 0.03, r: 0.12,
        },
        // BASS B: the punchy one. Almost a pure sine carrier with a light 2x / 1x wobble and a pitch "pop" at the start.
        bassB: {
            ops: [{ r: 1, a: 15 }, { r: 2, a: 4 }, { r: 1, a: 3 }, { r: 1.01, a: 1 }],
            mods: [[1, 0], [2, 0], [3, 0]], out: [0],
            filt: { from: 2200, to: 1100, tc: 0.15 }, scoop: 0.06,
            vol: 0.13, a: 0.012, r: 0.05,
        },
        // LEAD: warm FM lead (three 1x operators, which sounds like a soft saw), with two detuned saws under it for the synth edge, and vibrato.
        // Brass works the opposite way to a pluck: the note starts dull and the brightness BLOOMS over the first ~0.1 s (the "blat"), so the modulator
        // swells up instead of fading and the filter opens instead of closing. It also scoops up into the pitch and gets vibrato once it is held.
        lead: {
            ops: [{ r: 1, a: 14 }, { r: 1, a: 12, env: { rise: 0.07, from: 0.2 } }],
            mods: [[1, 0]], out: [0],
            filt: { from: 700, to: 4800, tc: 0.07, q: 2 }, vib: 14, scoop: -0.03,
            vol: 0.13, a: 0.03, r: 0.12, rev: 0.25, dly: 0.2,
        },
    };

    // ---- what each BeepBox channel plays: (time, midi note, length in steps) ----
    // Names match the channel names in song-data.js. Delete a line to mute that channel; point it at a different instrument to swap sounds.
    const play = (name, extra = {}) => (t, m, len) => fm({ ...INSTRUMENTS[name], ...extra, t, freq: mtof(m), dur: len * STEP * 0.95, dest: INSTRUMENTS[name].dest === 'duck' ? duck : master });
    const PARTS = {
        pitch1: play('harp'),
        pitch2: play('koto'),
        pitch3: play('bassA'),
        pitch4: play('bassB'),
        pitch5: (t, m, len) => { for (const d of [-7, 7]) play('chords', { det: d })(t, m, len); },
        pitch6: (t, m, len) => {
            play('lead')(t, m, len);
            for (const d of [-6, 6])                   // the body: two saws whose filter opens as the note swells (resonant = the brassy honk)
                voice({ t, freq: mtof(m), vol: 0.04, a: 0.03, dur: len * STEP * 0.95, r: 0.12, cut: 650, cutEnd: 4200, cd: 0.09, q: 3, rev: 0.25, dly: 0.15, det: d, vib: 14, scoop: -0.03 });
        },
    };
    // drum notes from the BeepBox noise channel (GM numbers): (time)
    const DRUMS = {
        36: t => kick(t),
        40: t => clap(t, 0.32),
        46: t => hat(t, 0.1, 0.13),     // the off-beat tick
        55: t => hat(t, 0.06, 0.05),    // steady 8th-note hat
    };

    // ---- turn SONG into a per-step event list (done once) ----
    const events = [];
    function buildEvents() {
        events.length = 0;
        for (let s = 0; s < STEPS; s++) events[s] = [];
        for (const name in song.tracks) {
            if (!PARTS[name]) continue;
            song.tracks[name].forEach((bar, b) => {
                for (const [st, m, len] of bar) {
                    const s = b * BAR + st;
                    if (s < STEPS) events[s].push(t => PARTS[name](t, m, len));
                }
            });
        }
        for (const n in song.drums) {
            if (!DRUMS[n]) continue;
            for (const s of song.drums[n]) if (s < STEPS) events[s].push(DRUMS[n]);
        }
    }

    function schedule() {
        if (!song || !events.length)
            return;
        while (nextT < ctx.currentTime + AHEAD) {
            for (const ev of events[step % STEPS]) ev(nextT);
            nextT += STEP;
            step++;
        }
    }

    // ---- themes: load, switch ----
    const theme = { want: THEME_MAIN, name: null, token: 0, audio: null, node: null };
    const found = {};                                  // name -> Promise of { kind: 'song', song } | { kind: 'file', url } | null
    function loadTheme(name) {
        if (found[name]) return found[name];
        const urlOf = e => THEME_DIR + encodeURIComponent(name) + '.' + e;
        const tryExt = i => {
            if (i >= THEME_EXT.length) return Promise.resolve(null);
            const ext = THEME_EXT[i], url = urlOf(ext);
            return fetch(url, ext === 'js' ? undefined : { method: 'HEAD' }).then(r => {
                if (!r.ok) return tryExt(i + 1);
                if (ext !== 'js') return { kind: 'file', url };
                return r.text().then(text => {
                    const m = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/m.exec(text);   // song-data.js format: whatever the variable is called
                    const sg = m ? new Function(text + '\n;return ' + m[1] + ';')() : null;

                    console.log('[Theme parse]', name, {
                        foundDeclaration: !!m,
                        song: sg,
                        bpm: sg?.bpm,
                        bars: sg?.bars,
                        tracks: Object.keys(sg?.tracks || {})
                    });

                    if (!sg || !sg.bpm || !sg.bars || !sg.tracks) { console.warn('theme ' + name + ': ' + url + ' is not a song-data file'); return tryExt(i + 1); }
                    return { kind: 'song', song: sg };
                });
            }).catch(() => tryExt(i + 1));
        };
        return (found[name] = tryExt(0));
    }
    function stopTheme() {
        if (timer) { clearInterval(timer); timer = null; }
        if (theme.audio) { theme.audio.pause(); theme.audio = null; }
    }
    function playSong(sg) {
        song = sg;
        setTiming();
        if (dlyNode) dlyNode.delayTime.value = STEP * 3;
        buildEvents();
        nextT = ctx.currentTime + 0.15;
        step = 0;
        timer = setInterval(schedule, TICK);
    }
    function playFile(url) {
        const a = new Audio(url);
        a.loop = true;
        a.crossOrigin = 'anonymous';
        const src = ctx.createMediaElementSource(a);
        src.connect(master);
        theme.audio = a;
        a.play().catch(() => {});
    }
    // Switch to the theme called name. Falls back to mainTheme (then to the built-in song) when there is no such song. The same theme twice is a no-op, so a retry of a stage keeps playing.
    function startTheme(name) {
        if (!ctx || name === theme.name) return;
        const my = ++theme.token;
        theme.name = name;
        const known = THEME_FILES.includes(name) ? name : THEME_MAIN;
        const fade = (name2) => loadTheme(name2).then(t => {
            if (my !== theme.token) return;            // (another switch came in while this one loaded)
            if (!t && name2 !== THEME_MAIN)
                return loadTheme(THEME_MAIN).then(m => { if (my === theme.token) go(m); });
            go(t);
        });
        const go = t => {
            stopTheme();
            if (t && t.kind === 'file') playFile(t.url);
            else if (t && t.kind === 'song') playSong(t.song);
            else if (song) playSong(song);             // nothing in the themes folder: the song-data.js one
            if (enabled) master.gain.setTargetAtTime(LEVEL, ctx.currentTime, 0.12);
        };
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.06);   // a short dip between songs
        setTimeout(() => { if (my === theme.token) fade(known); }, 220);
    }
    // Ask for a theme by name (before the audio has started this just remembers it).
    function playTheme(name) {
        theme.want = name || THEME_MAIN;
        if (ctx) startTheme(theme.want);
    }

    // ---- on/off ----
    function apply() {
        if (!ctx) return;
        if (enabled) {
            ctx.resume();
            master.gain.setTargetAtTime(LEVEL, ctx.currentTime, 0.08);
        } else {
            master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
            setTimeout(() => { if (!enabled) ctx.suspend(); }, 400);
        }
    }
    function label() {
        const b = document.getElementById('music');
        if (!b) return;
        b.textContent = '\u266A Music: ' + (enabled ? 'On' : 'Off');
        b.classList.toggle('on', enabled);
    }
    function toggle() {
        enabled = ctx ? !enabled : true;                 // before the first start, a click/M means "start it"
        try { localStorage.setItem('wdb-music', enabled ? '1' : '0'); } catch (e) {}
        if (enabled && !ctx) init();
        apply();
        label();
    }

    // Browsers only allow audio after a user gesture, so start on the first key press or click.
    function firstGesture(e) {
        if ((e.target && e.target.id === 'music') || e.key === 'm' || e.key === 'M') return;   // those toggle by themselves
        if (!enabled) return;
        window.removeEventListener('keydown', firstGesture);
        window.removeEventListener('pointerdown', firstGesture);
        if (!ctx) init();
        apply();
    }
    window.addEventListener('keydown', firstGesture);
    window.addEventListener('pointerdown', firstGesture);
    window.addEventListener('keydown', e => { if (!e.repeat && (e.key === 'm' || e.key === 'M')) toggle(); });
    const btn = document.getElementById('music');
    if (btn) btn.addEventListener('click', () => { toggle(); const c = document.getElementById('c'); if (c) c.focus(); });
    document.addEventListener('visibilitychange', () => {       // timers are throttled in hidden tabs, so just pause
        if (!ctx) return;
        if (document.hidden) { ctx.suspend(); if (theme.audio) theme.audio.pause(); }
        else if (enabled) { ctx.resume(); if (theme.audio) theme.audio.play().catch(() => {}); }
    });
    label();

    return { toggle, play: playTheme, get theme() { return theme.want; }, get playing() { return { name: theme.name, kind: theme.audio ? 'file' : 'song', bpm: BPM }; }, get enabled() { return enabled; } };
})();
