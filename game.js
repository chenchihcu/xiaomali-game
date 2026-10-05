/* 小瑪莉 Little Mary — pure static fruit-machine game.
 * No build step, no dependencies. All money is fake play credit.
 *
 * Sections:
 *   1. Config (data/odds from engine.js)
 *   2. Seven-segment LED renderer
 *   3. Sound (Web Audio beeps) + Music (procedural BGM loops)
 *   4. Game state + settings + persistence
 *   5. DOM build + render (+ center 3-reel panel)
 *   6. Actions (bet / clear / all / start / collect / big-small /
 *               open / wash / double / rebet / auto)
 *   7. Settings UI
 *   8. Input wiring
 */
(() => {
  'use strict';

  const E = window.XiaomaliEngine;
  if (!E) {
    console.error('engine.js must load before game.js');
    return;
  }
  const {
    SYMBOLS, SYM_INDEX, TRACK, N, MAX_ONCE_MORE_CHAIN, JP,
    MODE_KEYS, MODE_LABELS, MODE_HINTS, PRESETS, WEIGHT_KEYS, WEIGHT_LABELS,
    BINGO_CELLS, BINGO_LINES,
  } = E;

  const TRACK_POS = (() => {
    const p = [];
    for (let c = 0; c < 7; c++) p.push([1, c + 1]);
    for (let r = 1; r < 7; r++) p.push([r + 1, 7]);
    for (let c = 5; c >= 0; c--) p.push([7, c + 1]);
    for (let r = 5; r >= 1; r--) p.push([r + 1, 1]);
    return p;
  })();

  const START_CREDIT = 1000;
  const CREDIT_CAP = 999999;
  const MAX_BET_PER_SYMBOL = 99;
  const STORAGE_KEY = 'xiaomali.v1';
  const SETTINGS_KEY = 'xiaomali.settings.v1';

  // Reel strip cycles these ids (no ONCE MORE on side reels; middle may show it).
  const REEL_IDS = SYMBOLS.map((s) => s.id);

  // ---------------------------------------------------------------------------
  // 2. Seven-segment LED
  // ---------------------------------------------------------------------------

  const SEG_PATHS = (() => {
    const t = 1.7;
    const h = (x1, x2, y) =>
      `${x1},${y} ${x1 + t / 2},${y - t / 2} ${x2 - t / 2},${y - t / 2} ${x2},${y} ${x2 - t / 2},${y + t / 2} ${x1 + t / 2},${y + t / 2}`;
    const v = (x, y1, y2) =>
      `${x},${y1} ${x + t / 2},${y1 + t / 2} ${x + t / 2},${y2 - t / 2} ${x},${y2} ${x - t / 2},${y2 - t / 2} ${x - t / 2},${y1 + t / 2}`;
    return {
      a: h(2.3, 9.7, 1.4),
      b: v(10.6, 2.3, 9.6),
      c: v(10.6, 10.4, 17.7),
      d: h(2.3, 9.7, 18.6),
      e: v(1.4, 10.4, 17.7),
      f: v(1.4, 2.3, 9.6),
      g: h(2.3, 9.7, 10),
    };
  })();
  const SEG_MAP = {
    '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
    '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
    '-': 'g', ' ': '', 'E': 'afged', 'r': 'eg',
  };

  function makeLed(el, digits) {
    el.innerHTML = '';
    const cells = [];
    for (let i = 0; i < digits; i++) {
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 12 20');
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('transform', 'skewX(-6) translate(1 0)');
      const segs = {};
      for (const [k, pts] of Object.entries(SEG_PATHS)) {
        const poly = document.createElementNS(svgNS, 'polygon');
        poly.setAttribute('points', pts);
        poly.setAttribute('class', 'seg');
        g.appendChild(poly);
        segs[k] = poly;
      }
      svg.appendChild(g);
      el.appendChild(svg);
      cells.push(segs);
    }
    let last = null;
    return {
      set(value, { pad = ' ' } = {}) {
        let str = typeof value === 'number' ? String(Math.max(0, Math.floor(value))) : String(value);
        if (str.length > digits) str = str.slice(-digits);
        str = str.padStart(digits, pad);
        if (str === last) return;
        last = str;
        for (let i = 0; i < digits; i++) {
          const on = SEG_MAP[str[i]] ?? '';
          for (const k in cells[i]) cells[i][k].classList.toggle('on', on.includes(k));
        }
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Sound + Music
  // ---------------------------------------------------------------------------

  const Sound = {
    ctx: null,
    on: true,
    _resume: null,
    unlock() {
      // Must run inside a user gesture. Await resume BEFORE starting BGM/SFX:
      // WebKit & post-background tabs stay "suspended" briefly; nodes created then
      // are often silent. Also play a 1-sample buffer (iOS unlock quirk).
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return Promise.resolve(null);
        try { this.ctx = new AC(); } catch { return Promise.resolve(null); }
      }
      const ctx = this.ctx;
      const tap = () => {
        try {
          const n = Math.max(1, Math.floor((ctx.sampleRate || 22050) * 0.01));
          const buf = ctx.createBuffer(1, n, ctx.sampleRate || 22050);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
        } catch { /* ignore */ }
      };
      tap();
      const after = () => { Music.update(); return ctx; };
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        this._resume = Promise.resolve(ctx.resume()).then(after).catch(after);
        return this._resume;
      }
      return Promise.resolve(after());
    },
    /** Run `fn` only when Sound is on and AudioContext is running. */
    whenReady(fn) {
      if (!this.on) return;
      const go = () => {
        if (!this.on || !this.ctx || this.ctx.state === 'closed') return;
        if (this.ctx.state === 'running') { fn(); return; }
        this.unlock().then(() => {
          if (this.on && this.ctx && this.ctx.state === 'running') fn();
        });
      };
      if (!this.ctx) this.unlock().then(go);
      else go();
    },
    sfxScale() {
      return (typeof settings !== 'undefined' && settings && Number.isFinite(settings.sfxVol))
        ? Math.max(0, Math.min(1, settings.sfxVol)) : 1;
    },
    beep(freq, dur = 0.05, type = 'square', vol = 0.04, when = 0) {
      this.whenReady(() => {
        const ctx = this.ctx;
        const v = vol * this.sfxScale();
        if (v <= 0) return;
        const t = ctx.currentTime + when;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(Math.max(v, 0.0001), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, 0.01));
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
      });
    },
    seq(notes, step = 0.09, type = 'square', vol = 0.05) {
      this.whenReady(() => {
        const v = vol * this.sfxScale();
        if (v <= 0) return;
        notes.forEach((f, i) => {
          if (!f) return;
          const t = this.ctx.currentTime + i * step;
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = type;
          o.frequency.setValueAtTime(f, t);
          g.gain.setValueAtTime(Math.max(v, 0.0001), t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.9);
          o.connect(g).connect(this.ctx.destination);
          o.start(t);
          o.stop(t + step * 0.9 + 0.02);
        });
      });
    },
    /** Layered tone: optional detune twin + soft attack (original synth, no samples). */
    tone(freq, dur = 0.12, type = 'square', vol = 0.05, when = 0, { detune = 0, attack = 0.008, slideTo = 0 } = {}) {
      this.whenReady(() => {
        const ctx = this.ctx;
        const v = vol * this.sfxScale();
        if (v <= 0 || !freq) return;
        const t = ctx.currentTime + when;
        const mk = (f, det) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = type;
          o.frequency.setValueAtTime(f, t);
          if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
          if (det) o.detune.setValueAtTime(det, t);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), t + Math.max(0.004, attack));
          g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, 0.02));
          o.connect(g).connect(ctx.destination);
          o.start(t);
          o.stop(t + dur + 0.03);
        };
        mk(freq, 0);
        if (detune) mk(freq, detune);
      });
    },
    chord(freqs, dur = 0.18, type = 'square', vol = 0.035, when = 0) {
      freqs.forEach((f, i) => this.tone(f, dur, type, vol * (1 - i * 0.08), when, { detune: i ? 7 : 0 }));
    },
    /** Filtered noise crash / sparkle (procedural, original). */
    noiseBurst(dur = 0.18, vol = 0.04, when = 0, { freq = 2400, type = 'bandpass', Q = 1.2 } = {}) {
      this.whenReady(() => {
        const ctx = this.ctx;
        const v = vol * this.sfxScale();
        if (v <= 0) return;
        const t = ctx.currentTime + when;
        const len = Math.max(1, Math.floor(ctx.sampleRate * Math.max(dur, 0.04)));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(freq, t);
        f.Q.value = Q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(Math.max(v, 0.0001), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(ctx.destination);
        src.start(t);
        src.stop(t + dur + 0.02);
      });
    },
    /** Impactful fanfare scaled by tier 0..5 (tiny→JP). Original arcade-style synth. */
    celebrate(tier = 1, kind = 'win') {
      const t = Math.max(0, Math.min(5, tier | 0));
      if (kind === 'jp' || t >= 5) {
        this.noiseBurst(0.22, 0.06, 0, { freq: 900, type: 'lowpass', Q: 0.7 });
        this.chord([262, 330, 392, 523], 0.28, 'sawtooth', 0.04, 0.02);
        this.seq([523, 659, 784, 1047, 1319, 1568, 2093, 2637], 0.07, 'square', 0.055);
        this.chord([1047, 1319, 1568, 2093], 0.45, 'triangle', 0.04, 0.55);
        this.tone(2093, 0.55, 'square', 0.035, 0.7, { detune: 12 });
        this.noiseBurst(0.35, 0.045, 0.75, { freq: 3200, type: 'highpass', Q: 0.8 });
        return;
      }
      if (kind === 'fever' || t >= 4) {
        this.noiseBurst(0.16, 0.05, 0, { freq: 1800, type: 'bandpass', Q: 0.9 });
        this.seq([392, 523, 659, 784, 988, 1175, 1319, 1568, 1976], 0.055, 'square', 0.05);
        this.chord([784, 988, 1175, 1568], 0.32, 'sawtooth', 0.032, 0.35);
        this.tone(1568, 0.4, 'triangle', 0.04, 0.5, { detune: -9, slideTo: 2093 });
        this.noiseBurst(0.28, 0.04, 0.55, { freq: 4000, type: 'highpass', Q: 1 });
        return;
      }
      if (t >= 3) {
        this.noiseBurst(0.12, 0.04, 0, { freq: 2200, type: 'bandpass', Q: 1.1 });
        this.seq([523, 659, 784, 1047, 1319, 1568, 1319, 1568, 2093], 0.065, 'square', 0.05);
        this.chord([659, 831, 988], 0.22, 'triangle', 0.035, 0.4);
        this.tone(2093, 0.28, 'square', 0.03, 0.55, { detune: 8 });
        return;
      }
      if (t >= 2) {
        this.seq([523, 659, 784, 1047, 1319, 1047, 1319], 0.07, 'square', 0.048);
        this.chord([523, 659, 784], 0.2, 'triangle', 0.03, 0.28);
        this.noiseBurst(0.1, 0.028, 0.35, { freq: 2800, type: 'highpass', Q: 1.2 });
        return;
      }
      if (t >= 1) {
        this.seq([523, 659, 784, 1047, 784, 1047], 0.075, 'square', 0.048);
        this.chord([523, 784], 0.16, 'triangle', 0.028, 0.2);
        return;
      }
      this.chord([784, 988, 1175], 0.14, 'triangle', 0.04, 0);
      this.tone(1568, 0.1, 'square', 0.03, 0.08);
    },
    tick()  { this.beep(1320, 0.025, 'square', 0.03); },
    bet()   { this.beep(880, 0.04, 'triangle', 0.08); },
    error() { this.seq([220, 165], 0.12, 'sawtooth', 0.04); },
    win()   { this.celebrate(1, 'win'); },
    big()   { this.celebrate(3, 'win'); },
    lose()  { this.seq([392, 330, 262], 0.14, 'triangle', 0.06); },
    once()  {
      this.seq([784, 988, 1175, 1568, 0, 1568], 0.07, 'square', 0.05);
      this.noiseBurst(0.08, 0.025, 0.12, { freq: 3500, type: 'highpass', Q: 1 });
    },
    coin()  { this.beep(1568, 0.03, 'square', 0.03); },
    lucky() {
      this.seq([659, 784, 988, 1319, 988, 1319, 1568, 1976], 0.055, 'square', 0.05);
      this.chord([659, 831, 988], 0.2, 'triangle', 0.03, 0.25);
      this.noiseBurst(0.12, 0.03, 0.3, { freq: 3000, type: 'bandpass', Q: 1 });
    },
    jp()    { this.celebrate(5, 'jp'); },
    slot()  {
      this.seq([440, 554, 659, 880, 0, 880, 1175], 0.07, 'square', 0.05);
      this.noiseBurst(0.09, 0.022, 0.4, { freq: 2000, type: 'bandpass', Q: 1.3 });
    },
    fever() { this.celebrate(4, 'fever'); },
    bingo() {
      this.seq([659, 784, 988, 1319, 1568], 0.075, 'triangle', 0.05);
      this.chord([659, 988, 1319], 0.22, 'square', 0.028, 0.2);
    },
    super() {
      this.seq([392, 523, 659, 784, 988, 1175, 1319, 1568], 0.048, 'square', 0.045);
      this.noiseBurst(0.14, 0.035, 0.2, { freq: 1600, type: 'bandpass', Q: 0.9 });
    },
    stageOpen() {
      this.seq([523, 659, 784, 988, 1175], 0.06, 'square', 0.048);
      this.noiseBurst(0.1, 0.03, 0.15, { freq: 2400, type: 'bandpass', Q: 1 });
    },
    wheelTick() { this.beep(1480, 0.018, 'square', 0.022); },
    gacha() {
      this.noiseBurst(0.08, 0.04, 0, { freq: 900, type: 'lowpass', Q: 0.8 });
      this.seq([880, 1175, 1568], 0.08, 'triangle', 0.045);
    },
    dice() {
      this.noiseBurst(0.06, 0.05, 0, { freq: 1200, type: 'bandpass', Q: 0.7 });
      this.beep(660, 0.04, 'square', 0.03);
    },
    pachi() {
      this.beep(1760, 0.02, 'square', 0.02);
      this.noiseBurst(0.04, 0.02, 0.01, { freq: 3000, type: 'highpass', Q: 1.2 });
    },
    ballPop() {
      this.beep(990, 0.05, 'triangle', 0.04);
      this.noiseBurst(0.05, 0.025, 0.02, { freq: 2200, type: 'bandpass', Q: 1 });
    },
    roulette() {
      this.seq([440, 554, 659, 0, 880], 0.07, 'square', 0.04);
      this.noiseBurst(0.1, 0.03, 0.2, { freq: 1800, type: 'bandpass', Q: 1.1 });
    },
  };

  const MUSIC_TRACKS = {
    off: { name: '安靜' },
    arcade: {
      name: '街機', bpm: 138, leadWave: 'square', bassWave: 'triangle', leadVol: 0.022, bassVol: 0.05,
      lead: [72,0,76,0,79,0,76,0, 77,0,74,0,71,0,74,0, 72,0,76,0,79,0,84,0, 83,0,79,0,74,0,0,0],
      bass: [48,0,0,0,55,0,0,0, 50,0,0,0,55,0,0,0, 48,0,0,0,55,0,0,0, 43,0,0,0,47,0,0,0],
      drums: 'h.h.h.h.h.h.h.h.h.h.h.h.h.h.h.h.',
    },
    breezy: {
      name: '輕快', bpm: 116, leadWave: 'triangle', bassWave: 'sine', leadVol: 0.05, bassVol: 0.06,
      lead: [67,0,69,71,0,74,0,71, 69,0,67,0,64,0,67,0, 67,0,69,71,0,74,76,0, 74,0,71,0,69,0,0,0],
      bass: [43,0,0,50,0,0,47,0, 45,0,0,52,0,0,48,0, 43,0,0,50,0,0,47,0, 50,0,0,45,0,0,50,0],
      drums: 'k...h...k...h...k...h...k.h.h...',
    },
    festive: {
      name: '歡慶', bpm: 152, leadWave: 'square', bassWave: 'triangle', leadVol: 0.022, bassVol: 0.055,
      lead: [72,72,0,72,76,0,79,0, 84,0,79,0,76,0,72,0, 74,74,0,74,77,0,81,0, 79,0,76,0,79,0,0,0],
      bass: [48,0,55,0,48,0,55,0, 48,0,55,0,48,0,55,0, 50,0,57,0,50,0,57,0, 55,0,47,0,55,0,43,0],
      drums: 'k.h.s.h.k.h.s.h.k.h.s.h.k.k.s.s.',
    },
    retro: {
      name: '復古', bpm: 108, leadWave: 'square', bassWave: 'square', leadVol: 0.016, bassVol: 0.022,
      lead: [69,72,76,81,76,72,69,72, 65,69,72,77,72,69,65,69, 60,64,67,72,67,64,60,64, 67,71,74,79,74,71,67,71],
      bass: [45,0,0,0,45,0,0,0, 41,0,0,0,41,0,0,0, 36,0,0,0,36,0,0,0, 43,0,0,0,43,0,0,0],
      drums: 'k.......s.......k...k...s.......',
    },
    neon: {
      name: '霓虹', bpm: 128, leadWave: 'sawtooth', bassWave: 'triangle', leadVol: 0.014, bassVol: 0.05,
      lead: [76,0,79,0,83,0,79,0, 81,0,76,0,72,0,76,0, 74,0,77,0,81,0,84,0, 83,0,79,0,74,0,0,0],
      bass: [40,0,0,47,0,0,43,0, 45,0,0,52,0,0,48,0, 40,0,0,47,0,0,43,0, 38,0,0,45,0,0,50,0],
      drums: 'k.h.k.h.k.h.s.h.k.h.k.h.k.s.h.h.',
    },
  };
  const MUSIC_IDS = Object.keys(MUSIC_TRACKS);

  const Music = {
    track: 'arcade',
    timer: null,
    gain: null,
    noise: null,
    step: 0,
    nextTime: 0,
    setTrack(id) {
      if (!MUSIC_TRACKS[id]) return;
      this.track = id;
      this.stop();
      this.update();
    },
    update() {
      const want = Sound.on && Sound.ctx && Sound.ctx.state === 'running'
        && this.track !== 'off' && !document.hidden;
      if (want) this.start(); else this.stop();
    },
    bgmScale() {
      return (typeof settings !== 'undefined' && settings && Number.isFinite(settings.bgmVol))
        ? Math.max(0, Math.min(1, settings.bgmVol)) : 1;
    },
    applyVolume() {
      if (!this.gain || !Sound.ctx) return;
      try { this.gain.gain.setTargetAtTime(this.bgmScale(), Sound.ctx.currentTime, 0.05); } catch { /* */ }
    },
    /** Duck BGM under a win sting so fanfares punch through (ms, depth 0–1). */
    duck(ms = 700, depth = 0.22) {
      if (!this.gain || !Sound.ctx || this.track === 'off') return;
      const t = Sound.ctx.currentTime;
      const base = this.bgmScale();
      const low = Math.max(0.02, base * Math.max(0.05, Math.min(1, depth)));
      const dur = Math.max(0.2, ms / 1000);
      try {
        this.gain.gain.cancelScheduledValues(t);
        this.gain.gain.setValueAtTime(Math.max(this.gain.gain.value, 0.0001), t);
        this.gain.gain.linearRampToValueAtTime(low, t + 0.04);
        this.gain.gain.linearRampToValueAtTime(base, t + dur);
      } catch { /* */ }
    },
    start() {
      if (this.timer || !Sound.ctx) return;
      const ctx = Sound.ctx;
      this.gain = ctx.createGain();
      this.gain.gain.value = this.bgmScale();
      this.gain.connect(ctx.destination);
      if (!this.noise) {
        const len = Math.floor(ctx.sampleRate * 0.2);
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      this.step = 0;
      this.nextTime = ctx.currentTime + 0.08;
      this.timer = setInterval(() => this.tick(), 25);
    },
    stop() {
      clearInterval(this.timer);
      this.timer = null;
      if (this.gain && Sound.ctx) {
        const g = this.gain;
        const t = Sound.ctx.currentTime;
        try {
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0, t + 0.08);
        } catch { /* ignore */ }
        setTimeout(() => { try { g.disconnect(); } catch { /* */ } }, 150);
      }
      this.gain = null;
    },
    tick() {
      const ctx = Sound.ctx;
      const T = MUSIC_TRACKS[this.track];
      if (!ctx || !T || !T.lead || !this.gain) return;
      const dur = 60 / T.bpm / 4;
      if (this.nextTime < ctx.currentTime - 0.3) this.nextTime = ctx.currentTime + 0.05;
      while (this.nextTime < ctx.currentTime + 0.12) {
        const i = this.step % T.lead.length;
        this.note(T.lead[i], this.nextTime, dur * 0.9, T.leadWave, T.leadVol);
        this.note(T.bass[i], this.nextTime, dur * 1.6, T.bassWave, T.bassVol);
        this.drum(T.drums[i], this.nextTime);
        this.nextTime += dur;
        this.step++;
      }
    },
    note(midi, t, dur, type, vol) {
      if (!midi) return;
      const ctx = Sound.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.gain);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    drum(kind, t) {
      if (!kind || kind === '.') return;
      const ctx = Sound.ctx;
      const g = ctx.createGain();
      g.connect(this.gain);
      if (kind === 'k') {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.15);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = kind === 'h' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'h' ? 7000 : 1800;
      const len = kind === 'h' ? 0.03 : 0.1;
      g.gain.setValueAtTime(kind === 'h' ? 0.025 : 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(f).connect(g);
      src.start(t);
      src.stop(t + len + 0.02);
    },
  };

  // ---------------------------------------------------------------------------
  // 4. State + persistence
  // ---------------------------------------------------------------------------

  const state = {
    credit: START_CREDIT,
    win: 0,
    bets: new Array(SYMBOLS.length).fill(0),
    betsPaid: true,
    lastPlayedBets: new Array(SYMBOLS.length).fill(0),
    pos: 0,
    busy: false,
    auto: false,
    jp: JP.seed,
    bingo: new Array(9).fill(false),
  };

  let settings = E.normalizeSettings(null);

  /** While a round animates, persist WIN/bingo as of round-start so a mid-spin
   *  refresh refunds the stake WITHOUT keeping partial round wins / bingo marks
   *  (visibilitychange / pagehide call save() while busy). */
  let roundPersist = null; // { win, bingo, jp } | null

  function loadSettings() {
    try {
      const d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (d && MUSIC_TRACKS[d.music]) Music.track = d.music;
      const v = validateSettings(d);
      settings = v.s;
      if (d && (v.fixed.length || v.errors.length)) {
        settingsNotice = v.errors[0] || `設定超出範圍，已修正：${v.fixed.slice(0, 3).join('、')}${v.fixed.length > 3 ? '…' : ''}`;
        saveSettings();
      }
    } catch { settings = E.normalizeSettings(null); }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, music: Music.track }));
    } catch { /* private mode */ }
  }

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (d && Number.isFinite(d.credit)) {
        state.credit = Math.min(CREDIT_CAP, Math.max(0, Math.floor(d.credit)));
        state.win = Math.min(CREDIT_CAP, Math.max(0, Math.floor(d.win || 0)));
        state.pos = (d.pos | 0) % N;
        Sound.on = d.sound !== false;
        if (Number.isFinite(d.jp) && d.jp >= 0) state.jp = Math.min(JP.max, d.jp);
        if (Array.isArray(d.bingo) && d.bingo.length === 9) state.bingo = d.bingo.map(Boolean);
        if (Array.isArray(d.lastBets) && d.lastBets.length === SYMBOLS.length) {
          state.bets = d.lastBets.map((n) => Math.min(MAX_BET_PER_SYMBOL, Math.max(0, n | 0)));
          state.betsPaid = false;
        }
        if (Array.isArray(d.lastPlayedBets) && d.lastPlayedBets.length === SYMBOLS.length) {
          state.lastPlayedBets = d.lastPlayedBets.map((n) => Math.min(MAX_BET_PER_SYMBOL, Math.max(0, n | 0)));
        } else if (sum(state.bets) > 0) {
          state.lastPlayedBets = state.bets.slice();
        }
        if (Number.isFinite(d.holdCount)) {
          // Applied after FX/holds exist — boot calls FX.holdsSet below if needed.
          state._pendingHold = Math.max(0, Math.min(4, d.holdCount | 0));
        }
      }
    } catch { /* ignore */ }
  }

  function save() {
    try {
      // Always fold paid stakes into saved CREDIT. Mid-spin refresh used to
      // drop the stake (busy ⇒ no refund) while reloading bets as unpaid.
      const refund = state.betsPaid ? sum(state.bets) : 0;
      // Freeze WIN/bingo at round-start while animating — otherwise refresh
      // kept partial wins AND refunded the stake (free credit).
      const win = roundPersist ? roundPersist.win : state.win;
      const bingo = roundPersist ? roundPersist.bingo : state.bingo;
      const jp = roundPersist ? roundPersist.jp : state.jp;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        credit: state.credit + refund,
        win,
        pos: state.pos,
        sound: Sound.on,
        lastBets: state.bets,
        lastPlayedBets: state.lastPlayedBets,
        jp,
        bingo,
        holdCount,
      }));
    } catch { /* */ }
  }

  // ---------------------------------------------------------------------------
  // 5. DOM
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const center = $('center');
  const betpanel = $('betpanel');   // payout display row (mult + LED) under the track
  const betKeysRow = $('betKeys');  // physical bet buttons on the control deck
  const msgEl = $('msg');
  const btn = {
    start: $('btnStart'), clear: $('btnClear'), all: $('btnAll'),
    collect: $('btnCollect'), small: $('btnSmall'), big: $('btnBig'),
    open: $('btnOpen'), wash: $('btnWash'), dbl: $('btnDouble'),
    rebet: $('btnRebet'), auto: $('btnAuto'),
    sound: $('btnSound'), settings: $('btnSettings'), reset: $('btnReset'),
    openHelp: $('btnOpenHelp'),
  };

  // ---------------------------------------------------------------------------
  // Cabinet light FX (visual only — pachinko-inspired rails / hold / fever)
  // ---------------------------------------------------------------------------
  const cabinetEl = $('cabinet');
  const holdLamps = Array.from(document.querySelectorAll('#holdStrip .hold-lamp'));
  const feverBanner = $('feverBanner');
  const feverTag = $('feverTag');
  let feverTimer = null;
  let holdCount = 0;

  function buildRails() {
    const specs = [
      ['railTop', 14], ['railBot', 14], ['railLeft', 18], ['railRight', 18],
    ];
    for (const [id, n] of specs) {
      const el = $(id);
      if (!el || el.childElementCount) continue;
      for (let i = 0; i < n; i++) {
        const d = document.createElement('i');
        d.className = 'rail-dot';
        el.appendChild(d);
      }
    }
  }

  const FX = {
    clear() {
      if (!cabinetEl) return;
      cabinetEl.classList.remove('fx-spin', 'fx-win', 'fx-reach', 'fx-expect', 'fx-fever',
        'haptic-bump', 'haptic-bump-big');
    },
    set(...modes) {
      this.clear();
      for (const m of modes) cabinetEl?.classList.add('fx-' + m);
    },
    spin() { this.set('spin'); this.holdsSpin(); },
    expect() { this.set('expect', 'reach'); },
    reach() { this.set('reach'); },
    win(tier = 1) {
      this.set('win');
      // Restore persistent holds (holdsSpin is visual-only and may differ).
      holdLamps.forEach((el, i) => { el.classList.toggle('on', i < holdCount); });
      this.holdsFlash(true);
      const t = Math.max(0, Math.min(5, tier | 0));
      cabinetEl?.classList.remove('haptic-bump', 'haptic-bump-big');
      // force reflow so CSS animation restarts
      void cabinetEl?.offsetWidth;
      cabinetEl?.classList.add(t >= 3 ? 'haptic-bump-big' : 'haptic-bump');
      if (t >= 1 && typeof flourishSparkles === 'function') {
        const lit = document.querySelector('.tile.lit, .tile.win') || $('center');
        flourishSparkles(8 + t * 4, lit);
      }
    },
    idle() {
      this.clear();
      this.holdsFlash(false);
      this.hideFever();
      this.holdsSet(holdCount);
    },
    holdsSet(n) {
      holdCount = Math.max(0, Math.min(holdLamps.length, n | 0));
      holdLamps.forEach((el, i) => {
        el.classList.toggle('on', i < holdCount);
      });
    },
    holdsSpin() {
      // Visual only during a spin — do NOT clobber persistent holdCount.
      // (Old holdsSet(n) made end-of-round holdCount±1 climb from random 1–3.)
      const n = 1 + Math.floor(randomFloat() * 3);
      holdLamps.forEach((el, i) => {
        el.classList.toggle('on', i < n);
        el.classList.remove('flash');
      });
    },
    holdsFlash(on) {
      holdLamps.forEach((el) => el.classList.toggle('flash', !!on && el.classList.contains('on')));
    },
    showFever(kind) {
      if (!feverBanner) return;
      clearTimeout(feverTimer);
      feverBanner.hidden = false;
      feverBanner.classList.toggle('ready', kind === 'ready');
      feverBanner.classList.toggle('fever', kind === 'fever');
      if (feverTag) feverTag.textContent = kind === 'fever' ? 'FEVER' : 'READY';
      cabinetEl?.classList.add('fx-fever');
    },
    hideFever() {
      clearTimeout(feverTimer);
      if (feverBanner) feverBanner.hidden = true;
      cabinetEl?.classList.remove('fx-fever');
    },
    flashFever(kind, ms = 1600) {
      this.showFever(kind);
      flourishFeverSplash(kind);
      feverTimer = setTimeout(() => this.hideFever(), ms);
    },
  };
  buildRails();
  FX.holdsSet(0);

  // Bingo 3×3 mission board (Medal/Bingo hybrid — marks on land)
  (function buildBingo() {
    const root = $('bingoBoard');
    if (!root || root.childElementCount) return;
    const labels = {
      apple: '蘋', orange: '橙', mango: '芒', bell: '鈴',
      melon: '西', star: '星', seven: '77', bar: 'BAR', once: 'OM',
    };
    BINGO_CELLS.forEach((id, i) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'bingo-cell';
      c.dataset.b = String(i);
      c.disabled = true;
      c.setAttribute('aria-label', WEIGHT_LABELS[id] || id);
      c.innerHTML = `<span>${labels[id] || id}</span>`;
      root.appendChild(c);
    });
  })();

  /** Classic 小瑪莉 cabinet tile icons: glossy molded plastic on cream face. */
  let _icUid = 0;
  function iconHTML(symId) {
    if (symId === 'once') return '<span class="ic-once">ONCE<br>MORE</span>';
    if (symId === 'seven') return '<span class="ic-77">77</span>';
    if (symId === 'bar') return '<span class="ic-bar"><i>BAR</i><i>BAR</i><i>BAR</i></span>';
    const u = 'i' + (++_icUid);
    // Thick outline + plastic gloss = arcade-sticker look (not flat emoji).
    const SVGS = {
      apple: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${u}a" cx="32%" cy="28%"><stop offset="0%" stop-color="#ffb0b0"/><stop offset="35%" stop-color="#e82020"/><stop offset="78%" stop-color="#a00808"/><stop offset="100%" stop-color="#4a0000"/></radialGradient><linearGradient id="${u}ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fff" stop-opacity=".55"/><stop offset="40%" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><ellipse cx="32" cy="37" rx="21" ry="22.5" fill="url(#${u}a)" stroke="#3a0000" stroke-width="2.2"/><path d="M32 16c1-7 8-11 14-10" stroke="#2a5a10" stroke-width="3.2" fill="none" stroke-linecap="round"/><ellipse cx="40" cy="9" rx="8" ry="4" fill="#58c038" stroke="#1e5a12" stroke-width="1.4" transform="rotate(28 40 9)"/><ellipse cx="23" cy="28" rx="8" ry="4.5" fill="url(#${u}ag)" transform="rotate(-32 23 28)"/><ellipse cx="38" cy="44" rx="10" ry="5" fill="#000" opacity=".12"/></svg>`,
      orange: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${u}o" cx="30%" cy="26%"><stop offset="0%" stop-color="#ffe8b0"/><stop offset="38%" stop-color="#ff9a14"/><stop offset="80%" stop-color="#d06000"/><stop offset="100%" stop-color="#8a3800"/></radialGradient></defs><circle cx="32" cy="35" r="22.5" fill="url(#${u}o)" stroke="#6a2a00" stroke-width="2.2"/><circle cx="32" cy="35" r="22.5" fill="none" stroke="#ffcc66" stroke-width=".7" stroke-dasharray="1.8 2.6" opacity=".55"/><path d="M32 13v7M27 15h10" stroke="#2a6a14" stroke-width="2.8" stroke-linecap="round"/><ellipse cx="38" cy="12" rx="5" ry="2.4" fill="#4cb828" stroke="#1e5a12" stroke-width="1" transform="rotate(18 38 12)"/><ellipse cx="23" cy="27" rx="9" ry="5" fill="#fff" opacity=".42" transform="rotate(-38 23 27)"/></svg>`,
      mango: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${u}m" cx="34%" cy="28%"><stop offset="0%" stop-color="#fff0b0"/><stop offset="40%" stop-color="#ffc018"/><stop offset="85%" stop-color="#c87800"/><stop offset="100%" stop-color="#8a4800"/></radialGradient></defs><path d="M20 49c-9-11-6-28 7-36 11-7 24-3 28 10 4 13-3 29-16 35-9 4-15 1-19-9z" fill="url(#${u}m)" stroke="#6a3a00" stroke-width="2.2"/><path d="M41 13c5-7 12-9 16-6" stroke="#2a6a14" stroke-width="2.8" fill="none" stroke-linecap="round"/><ellipse cx="48" cy="10" rx="6" ry="2.8" fill="#4cb828" stroke="#1e5a12" stroke-width="1" transform="rotate(-18 48 10)"/><ellipse cx="29" cy="28" rx="8" ry="4" fill="#fff" opacity=".4" transform="rotate(-42 29 28)"/></svg>`,
      bell: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${u}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fff2a0"/><stop offset="35%" stop-color="#ffd000"/><stop offset="70%" stop-color="#d0a000"/><stop offset="100%" stop-color="#8a6000"/></linearGradient><linearGradient id="${u}bg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#fff" stop-opacity=".5"/><stop offset="55%" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path d="M32 7c-2.4 0-4.4 2.2-4.4 5.2v2.2C16.8 17.4 11 27 11 39.5h42C53 27 47.2 17.4 36.4 14.4v-2.2C36.4 9.2 34.4 7 32 7z" fill="url(#${u}b)" stroke="#5a3a00" stroke-width="2"/><ellipse cx="32" cy="41" rx="23" ry="5.5" fill="#c89800" stroke="#5a3a00" stroke-width="1.4"/><circle cx="32" cy="50" r="4.4" fill="#7a5000" stroke="#3a2800" stroke-width="1.3"/><path d="M18 22c4-8 10-12 14-12" fill="none" stroke="url(#${u}bg)" stroke-width="4" stroke-linecap="round"/></svg>`,
      melon: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${u}w" cx="38%" cy="32%"><stop offset="0%" stop-color="#ffb0bc"/><stop offset="45%" stop-color="#e01840"/><stop offset="100%" stop-color="#6a0018"/></radialGradient><linearGradient id="${u}wr" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#7ae050"/><stop offset="55%" stop-color="#2ea028"/><stop offset="100%" stop-color="#146018"/></linearGradient></defs><path d="M9 41c0-17 13-30 30-30 4 0 8 1 12 3.2C49 32 36 47 19 52c-6-2.2-10-6.5-10-11z" fill="url(#${u}w)" stroke="#4a0010" stroke-width="2"/><path d="M51 14.2c6.5 4.2 11 13 11 23.5 0 8.5-4.2 15-11 19.2" fill="url(#${u}wr)" stroke="#0e4a14" stroke-width="1.8"/><path d="M51 14c-1 9-1 20 0 30" fill="none" stroke="#1e7a28" stroke-width="2.4"/><circle cx="22" cy="31" r="1.7" fill="#2a1000"/><circle cx="30" cy="39" r="1.5" fill="#2a1000"/><circle cx="26" cy="47" r="1.4" fill="#2a1000"/><circle cx="34" cy="29" r="1.3" fill="#2a1000"/><ellipse cx="21" cy="25" rx="7" ry="3.2" fill="#fff" opacity=".38" transform="rotate(-28 21 25)"/></svg>`,
      star: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${u}s" cx="38%" cy="28%"><stop offset="0%" stop-color="#fff8c0"/><stop offset="35%" stop-color="#ffd400"/><stop offset="80%" stop-color="#d09000"/><stop offset="100%" stop-color="#8a5800"/></radialGradient></defs><path d="M32 5l7 19.5H60L44.5 37l5.8 20L32 45.2 13.7 57l5.8-20L4 24.5h21z" fill="url(#${u}s)" stroke="#6a4000" stroke-width="2.1" stroke-linejoin="round"/><path d="M32 14l4 11H48" fill="none" stroke="#fff" stroke-width="2.4" opacity=".5" stroke-linecap="round"/><path d="M32 22l2.2 6H41" fill="none" stroke="#fff6a0" stroke-width="1.4" opacity=".7" stroke-linecap="round"/></svg>`,
    };
    return SVGS[symId] || '';
  }

  const tileEls = TRACK.map((t, i) => {
    const el = document.createElement('div');
    const [r, c] = TRACK_POS[i];
    // side class positions the inner-edge lamp bulb (like a real cabinet)
    const side = r === 1 ? (c === 1 ? 'tl' : c === 7 ? 'tr' : 't')
      : r === 7 ? (c === 1 ? 'bl' : c === 7 ? 'br' : 'b')
      : c === 7 ? 'r' : 'l';
    el.className = 'tile side-' + side + (t.small ? ' small' : '') + (t.s === 'once' ? ' once' : '');
    el.style.gridRow = r;
    el.style.gridColumn = c;
    el.innerHTML = `<span class="ic">${iconHTML(t.s)}</span>` +
      (t.small ? `<span class="badge">${t.pay === 3 ? '×3' : t.pay}</span>` : '');
    el.setAttribute('aria-label', t.s === 'once' ? 'ONCE MORE' :
      SYMBOLS[SYM_INDEX[t.s]].name + (t.small ? ` 小（${t.pay} 倍）` : ''));
    board.insertBefore(el, center);
    return el;
  });

  const betKeys = SYMBOLS.map((s, i) => {
    // payout cell (display only): multiplier header + 2-digit bet LED
    const cell = document.createElement('div');
    cell.className = 'paycell';
    cell.innerHTML = `<span class="mult">${s.mult}</span><span class="led"></span>`;
    betpanel.appendChild(cell);
    // physical bet key with the fruit printed on its cap
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'betkey';
    b.setAttribute('aria-label', `押 ${s.name}（${s.mult} 倍）`);
    b.innerHTML = `<span class="bicon">${iconHTML(s.id)}</span>`;
    betKeysRow.appendChild(b);
    return { el: b, cell, led: makeLed(cell.querySelector('.led'), 2) };
  });
  const setKeyHit = (k, on) => { k.el.classList.toggle('hit', on); k.cell.classList.toggle('hit', on); };

  const winLed = makeLed($('winLed'), 6);
  const creditLed = makeLed($('creditLed'), 6);
  const diceLed = makeLed($('diceLed'), 1);

  $('paytable').innerHTML = SYMBOLS.map((s) =>
    `<tr><td>${iconHTML(s.id)}</td><td>${s.name}</td><td>× ${s.mult}</td></tr>`).join('') +
    '<tr><td>×3</td><td>小圖／BAR50</td><td>×3／×50</td></tr>' +
    '<tr><td><span class="ic-once" style="font-size:8px">ONCE<br>MORE</span></td><td>再跑／連跑</td><td>FREE</td></tr>' +
    `<tr><td>JP</td><td>大 BAR＋押 BAR</td><td>彩金</td></tr>` +
    '<tr><td>★</td><td>送燈／火車／三元</td><td>中彩</td></tr>' +
    '<tr><td>🎰</td><td>三輪 Bonus／FEVER／賓果</td><td>舞台</td></tr>' +
    '<tr><td>💡</td><td>倒跑／跳格／假停／雙燈／超跑</td><td>跑燈</td></tr>';

  // --- 3 fruit reels --------------------------------------------------------
  const REEL_LOOPS = 8; // repeated strip length multiplier
  const reelStrips = [0, 1, 2].map((ri) => {
    const strip = $('reel' + ri);
    const seq = [];
    for (let L = 0; L < REEL_LOOPS; L++) {
      for (const id of REEL_IDS) seq.push(id);
    }
    // allow ONCE MORE only on middle reel strip (decorative)
    if (ri === 1) {
      for (let L = 0; L < 2; L++) seq.push('once');
    }
    strip.innerHTML = seq.map((id) => `<div class="reel-cell">${iconHTML(id)}</div>`).join('');
    return { el: strip, parent: strip.closest('.reel'), seq, cellH: 0 };
  });

  function measureReelCells() {
    const sample = reelStrips[0].el.querySelector('.reel-cell');
    const h = sample ? sample.getBoundingClientRect().height : 0;
    reelStrips.forEach((r) => { r.cellH = h || (parseFloat(getComputedStyle(document.documentElement).fontSize) * 2); });
  }

  function setReelOffset(ri, index, animate) {
    const r = reelStrips[ri];
    if (!r.cellH) measureReelCells();
    const y = -(index * r.cellH);
    r.el.classList.toggle('settle', !!animate);
    r.el.style.transform = `translateY(${y}px)`;
  }

  function findReelIndex(ri, symId, preferNearEnd) {
    const seq = reelStrips[ri].seq;
    if (preferNearEnd) {
      for (let i = seq.length - 1; i >= 0; i--) if (seq[i] === symId) return i;
    }
    const start = Math.floor(seq.length * 0.4);
    for (let i = start; i < seq.length; i++) if (seq[i] === symId) return i;
    return seq.indexOf(symId);
  }

  function idleReels() {
    measureReelCells();
    const picks = [
      REEL_IDS[Math.floor(Math.random() * REEL_IDS.length)],
      REEL_IDS[Math.floor(Math.random() * REEL_IDS.length)],
      REEL_IDS[Math.floor(Math.random() * REEL_IDS.length)],
    ];
    picks.forEach((id, ri) => {
      reelStrips[ri].parent.classList.remove('spinning', 'landed');
      setReelOffset(ri, findReelIndex(ri, id, false), false);
    });
  }

  /** Spin all three reels; settle middle on `centerId`, sides on random fruits. */
  async function spinReels(centerId, durationMs) {
    measureReelCells();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sideL = REEL_IDS[Math.floor(randomFloat() * REEL_IDS.length)];
    const sideR = REEL_IDS[Math.floor(randomFloat() * REEL_IDS.length)];
    const targets = [sideL, centerId === 'once' ? 'once' : (SYM_INDEX[centerId] != null ? centerId : REEL_IDS[0]), sideR];

    if (reduced) {
      targets.forEach((id, ri) => {
        setReelOffset(ri, findReelIndex(ri, id, true), false);
        reelStrips[ri].parent.classList.add('landed');
      });
      return;
    }

    reelStrips.forEach((r) => {
      r.parent.classList.remove('landed');
      r.parent.classList.add('spinning');
      r.el.classList.remove('settle');
    });

    const start = performance.now();
    const baseSpeed = [2.8, 3.4, 3.0]; // cells per frame-ish via time
    let raf = 0;
    await new Promise((resolve) => {
      const tick = (now) => {
        const t = now - start;
        if (t >= durationMs) {
          cancelAnimationFrame(raf);
          resolve();
          return;
        }
        reelStrips.forEach((r, ri) => {
          const cells = (t / 16) * baseSpeed[ri];
          const idx = Math.floor(cells) % r.seq.length;
          setReelOffset(ri, idx, false);
        });
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });

    // staggered settle
    for (let ri = 0; ri < 3; ri++) {
      const idx = findReelIndex(ri, targets[ri], true);
      setReelOffset(ri, idx, true);
      reelStrips[ri].parent.classList.remove('spinning');
      reelStrips[ri].parent.classList.add('landed');
      Sound.beep(900 + ri * 120, 0.04, 'square', 0.03);
      await sleep(120);
    }
  }

  function sum(a) { return a.reduce((x, y) => x + y, 0); }

  function setMsg(text, cls = '') {
    msgEl.textContent = text;
    msgEl.className = 'msg' + (cls ? ' ' + cls : '');
  }

  // --- 防呆 feedback: toast + confirm --------------------------------------
  // Toast lives in <body>, but re-parents into an open modal <dialog> so it
  // stays visible above the top layer (settings errors, etc.).
  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'alert');
  toastEl.setAttribute('aria-live', 'assertive');
  document.body.appendChild(toastEl);
  let toastTimer = null;
  function toast(text, kind = 'info', ms = 1900) {
    const host = document.querySelector('dialog[open]') || document.body;
    if (toastEl.parentNode !== host) host.appendChild(toastEl);
    const same = toastEl.classList.contains('show') && toastEl.textContent === text;
    toastEl.textContent = text;
    toastEl.className = 'toast show ' + kind;
    if (same) {
      // re-trigger a small bump so repeated taps still read as feedback
      toastEl.classList.remove('bump');
      void toastEl.offsetWidth;
      toastEl.classList.add('bump');
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  /** Reject an action: error beep + red toast (+ VFD line). */
  function deny(reason, { vfd = true } = {}) {
    Sound.error();
    toast(reason, 'bad');
    if (vfd) setMsg(reason, 'bad');
  }

  const confirmDlg = $('confirmDialog');
  const settingsDlgEarly = $('settingsDialog');
  const helpDlgEarly = $('helpDialog');
  function dialogOpen() {
    return !!(settingsDlgEarly?.open || helpDlgEarly?.open || confirmDlg?.open);
  }
  /** Cabinet-styled confirm. Resolves true on 確定. */
  function confirmBox(title, text, okLabel = '確定') {
    if (!confirmDlg || typeof confirmDlg.showModal !== 'function') {
      return Promise.resolve(window.confirm(`${title}\n${text}`));
    }
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmOk').textContent = okLabel;
    confirmDlg.returnValue = '';
    return new Promise((resolve) => {
      confirmDlg.addEventListener('close', () => resolve(confirmDlg.returnValue === 'ok'), { once: true });
      confirmDlg.showModal();
      $('confirmCancel').focus();
    });
  }

  const onceBanner = $('onceBanner');
  const onceBannerTag = $('onceBannerTag');
  const onceBannerCount = $('onceBannerCount');
  const ONCE_VARIANT_LABEL = { single: 'ONCE MORE', multi: '連跑', big: '大 ONCE' };

  function showOnceBanner(variant, remaining) {
    if (!onceBanner) return;
    onceBannerTag.textContent = ONCE_VARIANT_LABEL[variant] || 'ONCE MORE';
    onceBannerCount.textContent = remaining > 0 ? `×${remaining}` : '結束';
    // Always show — previously remaining<=0 set hidden and the 「結束」cue never appeared.
    onceBanner.hidden = false;
    onceBanner.classList.toggle('pulse', remaining > 0);
  }
  function hideOnceBanner() {
    if (!onceBanner) return;
    onceBanner.hidden = true;
    onceBanner.classList.remove('pulse');
  }

  function setLight(pos, trail = 0) {
    for (const el of tileEls) el.classList.remove('lit', 'trail1', 'trail2', 'trail3');
    tileEls[pos].classList.add('lit');
    if (trail >= 1) tileEls[(pos - 1 + N) % N].classList.add('trail1');
    if (trail >= 2) tileEls[(pos - 2 + N) % N].classList.add('trail2');
    if (trail >= 3) tileEls[(pos - 3 + N) % N].classList.add('trail3');
  }

  // --- 防呆: availability rules. Each returns a reason string (blocked) or null.
  const BUSY_MSG = '轉動中';
  const NO_CREDIT = 'CREDIT 不足';
  const avail = () => state.credit + state.win;          // WIN auto-collects before betting
  const paidRefund = () => (state.betsPaid ? sum(state.bets) : 0);
  const lastPattern = () => (sum(state.lastPlayedBets) > 0 ? state.lastPlayedBets : state.bets);
  const doubledTotal = () => state.bets.reduce((a, b) => a + Math.min(MAX_BET_PER_SYMBOL, b * 2), 0);

  const why = {
    start() {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      const total = sum(state.bets);
      if (total <= 0) return '請先押注';
      if (!state.betsPaid && avail() < total) return `需 ${total}・請清押或開分`;
      return null;
    },
    clear() {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      if (sum(state.bets) <= 0) return '目前沒有押注';
      return null;
    },
    all() {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      if (avail() < 1) return NO_CREDIT;
      if (state.bets.every((b) => b >= MAX_BET_PER_SYMBOL)) return `已全部押滿 ${MAX_BET_PER_SYMBOL}`;
      if (!state.betsPaid) {
        // Mirror betAll affordability (betUnit), not just avail>=1.
        const unit = betUnit();
        let trial = sum(state.bets);
        let can = false;
        for (let i = 0; i < SYMBOLS.length; i++) {
          if (state.bets[i] >= MAX_BET_PER_SYMBOL) continue;
          const add = Math.min(unit, MAX_BET_PER_SYMBOL - state.bets[i]);
          if (add >= 1 && avail() >= trial + add) { can = true; break; }
        }
        if (!can) return '需更多分數・請開分';
      }
      return null;
    },
    bet(i) {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      if (state.bets[i] >= MAX_BET_PER_SYMBOL) return `${SYMBOLS[i].name} 已達上限 ${MAX_BET_PER_SYMBOL}`;
      // Paid: need credit in hand. Unpaid preview: need current pattern + next unit (betUnit).
      const unit = betUnit();
      const room = MAX_BET_PER_SYMBOL - state.bets[i];
      const add = Math.min(unit, room);
      if (add < 1) return `${SYMBOLS[i].name} 已達上限 ${MAX_BET_PER_SYMBOL}`;
      if (state.betsPaid) {
        if (avail() < 1) return NO_CREDIT;
      } else if (avail() < sum(state.bets) + add) {
        return `需 ${sum(state.bets) + add}・請開分`;
      }
      return null;
    },
    dbl() {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      const total = sum(state.bets);
      if (total <= 0) return '請先押注';
      const dbl = doubledTotal();
      if (dbl <= total) return '押注已達上限';
      if (state.betsPaid) { if (avail() < 1) return NO_CREDIT; }
      else if (avail() < dbl) return `加倍需 ${dbl}`;
      return null;
    },
    rebet() {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      const need = sum(lastPattern());
      if (need <= 0) return '沒有上一局押注';
      if (avail() + paidRefund() < need) return `續押需 ${need}`;
      return null;
    },
    auto() {
      if (state.auto) return null; // always allowed to switch off
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      const need = sum(lastPattern());
      if (need <= 0) return '請先押注';
      if (!(state.betsPaid && sum(state.bets) > 0) && avail() + paidRefund() < need) return `自動需 ${need}`;
      return null;
    },
    collect() {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      if (state.win <= 0) return '沒有 WIN';
      return null;
    },
    gamble() {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      if (state.win <= 0) return '沒有 WIN 可比倍';
      return null;
    },
    open() {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      if (state.credit >= CREDIT_CAP) return 'CREDIT 已達上限';
      return null;
    },
    wash() {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      if (avail() + paidRefund() <= 0) return '沒有分數可洗';
      return null;
    },
    reset() {
      if (state.busy) return BUSY_MSG;
      if (dialogOpen()) return '請先關閉視窗';
      return null;
    },
  };

  /** Grey a control but keep it tappable so a tap can explain why (toast). */
  function setAvail(el, reason) {
    const off = !!reason;
    el.disabled = false;
    el.classList.toggle('off', off);
    el.setAttribute('aria-disabled', String(off));
    if (off) el.title = reason; else el.removeAttribute('title');
  }

  function render() {
    const jpRow = $('jpRow');
    if (jpRow) {
      jpRow.hidden = !settings.modes.jp;
      $('jpVal').textContent = String(Math.floor(state.jp));
    }
    const jpMini = $('jpMini');
    const jpMiniVal = $('jpMiniVal');
    if (jpMiniVal) jpMiniVal.textContent = String(Math.floor(state.jp));
    if (jpMini) jpMini.classList.toggle('off', !settings.modes.jp);
    renderBingo();
    winLed.set(state.win);
    creditLed.set(state.credit);
    betKeys.forEach((k, i) => {
      k.led.set(state.bets[i] || 0, { pad: ' ' });
      k.cell.classList.toggle('stale', !state.betsPaid && state.bets[i] > 0);
    });
    const startWhy = why.start();
    setAvail(btn.start, startWhy);
    setAvail(btn.clear, why.clear());
    setAvail(btn.all, why.all());
    setAvail(btn.collect, why.collect());
    setAvail(btn.small, why.gamble());
    setAvail(btn.big, why.gamble());
    setAvail(btn.open, why.open());
    setAvail(btn.wash, why.wash());
    setAvail(btn.dbl, why.dbl());
    setAvail(btn.rebet, why.rebet());
    setAvail(btn.auto, why.auto());
    betKeys.forEach((k, i) => setAvail(k.el, why.bet(i)));
    if (btn.reset) btn.reset.disabled = state.busy;
    document.body.classList.toggle('is-busy', state.busy);
    const hasWin = state.win > 0;
    btn.collect.classList.toggle('flash', !state.busy && hasWin && !state.auto);
    btn.start.classList.toggle('flash', !startWhy && !hasWin && !state.auto);
    btn.auto.classList.toggle('on', state.auto);
    btn.auto.classList.toggle('flash', state.auto);
    const autoLab = $('autoLab');
    // Never set btn.auto.textContent — that wipes the SVG icon children.
    if (autoLab) autoLab.textContent = state.auto ? '自動中' : '自動';
    btn.auto.setAttribute('aria-label', state.auto ? '自動中' : '自動');
    btn.sound.classList.toggle('off', !Sound.on);
    btn.sound.setAttribute('aria-pressed', String(Sound.on));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function clearHighlights() {
    tileEls.forEach((el) => el.classList.remove('win', 'lit2'));
    betKeys.forEach((k) => setKeyHit(k, false));
    $('lblSmall').classList.remove('on');
    $('lblBig').classList.remove('on');
    $('jpRow')?.classList.remove('jp-hit');
    $('jpMini')?.classList.remove('is-hit');
    reelStrips.forEach((r) => r.parent.classList.remove('landed', 'spinning'));
    hideOnceBanner();
  }

  // ---------------------------------------------------------------------------
  // 6. Actions
  // ---------------------------------------------------------------------------

  function pickTarget() {
    return E.pickWeighted(E.effectiveWeights(settings), randomFloat);
  }

  function randomFloat() {
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] / 4294967296;
    }
    return Math.random();
  }

  function collectInstant() {
    if (state.win <= 0) return;
    const room = Math.max(0, CREDIT_CAP - state.credit);
    const take = Math.min(state.win, room);
    state.credit += take;
    state.win -= take;
    if (state.win > 0) toast('CREDIT 已滿・WIN 未收', 'warn');
    else state.win = 0;
    Sound.coin();
    clearHighlights();
  }

  function betUnit() {
    return Math.max(1, Math.min(10, Math.floor(settings.betUnit || 1)));
  }

  /**
   * Add bet to symbol i.
   * - Paid (betsPaid): deduct CREDIT as you tap.
   * - Unpaid preview (post-round / 續玩): keep the whole pattern and only
   *   bump amounts — 開始 charges sum(bets). Never wipe siblings (old freshBets bug).
   */
  function bet(i) {
    const reason = why.bet(i);
    if (reason) { deny(reason); render(); return false; }
    if (state.auto) stopAuto();
    collectInstant();
    clearHighlights();
    const unit = betUnit();
    if (state.bets[i] >= MAX_BET_PER_SYMBOL) {
      setMsg(`${SYMBOLS[i].name} 上限 ${MAX_BET_PER_SYMBOL}`, 'bad');
      render();
      return false;
    }
    const room = MAX_BET_PER_SYMBOL - state.bets[i];
    if (!state.betsPaid) {
      const add = Math.min(unit, room);
      if (add < 1) {
        deny(`${SYMBOLS[i].name} 已達上限`);
        render();
        return false;
      }
      if (avail() < sum(state.bets) + add) {
        deny(`需 ${sum(state.bets) + add}・請開分`);
        render();
        return false;
      }
      state.bets[i] += add;
      Sound.bet();
      setMsg(`已押 ${sum(state.bets)}`);
      render();
      save();
      return true;
    }
    const add = Math.min(unit, room, state.credit);
    if (add < 1) {
      deny(NO_CREDIT);
      render();
      return false;
    }
    state.bets[i] += add;
    state.credit -= add;
    Sound.bet();
    setMsg(`已押 ${sum(state.bets)}`);
    if (add < unit && add < room && state.credit === 0) {
      toast(`只押 ${add}`, 'warn');
    }
    render();
    save();
    return true;
  }

  function betAll() {
    const reason = why.all();
    if (reason) { deny(reason); render(); return; }
    collectInstant();
    clearHighlights();
    const unit = betUnit();
    let added = 0;
    if (!state.betsPaid) {
      // Unpaid preview: bump each symbol without wiping / without charging yet.
      for (let i = 0; i < SYMBOLS.length; i++) {
        if (state.bets[i] >= MAX_BET_PER_SYMBOL) continue;
        const room = MAX_BET_PER_SYMBOL - state.bets[i];
        const add = Math.min(unit, room);
        if (add < 1) continue;
        if (avail() < sum(state.bets) + add) break;
        state.bets[i] += add;
        added += add;
      }
    } else {
      for (let i = 0; i < SYMBOLS.length; i++) {
        if (state.credit < 1) break;
        if (state.bets[i] >= MAX_BET_PER_SYMBOL) continue;
        const room = MAX_BET_PER_SYMBOL - state.bets[i];
        const add = Math.min(unit, room, state.credit);
        if (add < 1) break;
        state.bets[i] += add;
        state.credit -= add;
        added += add;
      }
    }
    if (added) {
      Sound.seq([784, 988, 1175], 0.05, 'triangle', 0.07);
      setMsg(`全押 ${sum(state.bets)}`);
      if (state.betsPaid && state.credit === 0 && added < unit * SYMBOLS.length) toast('CREDIT 不足', 'warn');
    } else deny('無法加注');
    render();
    save();
  }

  function clearBets() {
    const reason = why.clear();
    if (reason) { deny(reason); render(); return; }
    clearHighlights();
    if (state.betsPaid) state.credit += sum(state.bets);
    state.bets.fill(0);
    state.betsPaid = true;
    Sound.beep(440, 0.08, 'triangle', 0.07);
    setMsg('已清除');
    render();
    save();
  }

  /**
   * Run the outer light to `target`.
   * fx.reverse — counterclockwise; fx.skip — step by 2; fx.fakeStop — brief pause near end then continue.
   */
  async function runLight(target, { expect = false, fx = null } = {}) {
    const rev = !!(fx && fx.reverse);
    const skip = !!(fx && fx.skip);
    const fake = !!(fx && fx.fakeStop);
    const step = skip ? 2 : 1;
    // distance in the travel direction, measured in step units
    let dist;
    if (rev) dist = (state.pos - target + N) % N;
    else dist = (target - state.pos + N) % N;
    if (skip) {
      // align so we land exactly on target with stride 2
      if (dist % 2 === 1) dist += N; // odd → add full lap of odd length? N=24 even, so odd dist never lands with step 2
      // With N even and step 2, parity must match. Nudge one single step first if needed.
    }
    const needAlign = skip && ((rev ? (state.pos - target + N) % N : (target - state.pos + N) % N) % 2 === 1);
    if (needAlign) {
      state.pos = rev ? (state.pos - 1 + N) % N : (state.pos + 1) % N;
      setLight(state.pos, 0);
      Sound.tick();
      await sleep(40);
      dist = rev ? (state.pos - target + N) % N : (target - state.pos + N) % N;
    }
    const laps = 2 + (randomFloat() < 0.5 ? 1 : 0);
    const totalSteps = Math.floor((laps * N + dist) / step);
    const FAST = skip ? 36 : 28;
    const DECEL = 15;
    let expectOn = false;
    let faked = false;
    for (let s = 1; s <= totalSteps; s++) {
      state.pos = rev
        ? (state.pos - step + N) % N
        : (state.pos + step) % N;
      const remaining = totalSteps - s;
      let delay;
      if (s <= 6) delay = FAST + (7 - s) * 16;
      else if (remaining >= DECEL) delay = FAST;
      else delay = FAST + Math.pow(DECEL - remaining, 2) * 2;
      if (expect && remaining < DECEL && !expectOn) {
        FX.expect();
        expectOn = true;
      } else if (!expect && remaining < 6 && remaining >= 0 && !expectOn) {
        FX.reach();
        expectOn = true;
      }
      // Fake stop: freeze briefly mid-decel, then resume
      if (fake && !faked && remaining === Math.floor(DECEL * 0.55)) {
        setLight(state.pos, 0);
        tileEls[state.pos].classList.add('win');
        await sleep(280);
        tileEls[state.pos].classList.remove('win');
        Sound.beep(330, 0.05, 'sawtooth', 0.04);
        faked = true;
        delay = FAST;
      }
      const trailDir = rev ? 1 : -1;
      for (const el of tileEls) el.classList.remove('lit', 'trail1', 'trail2', 'trail3');
      tileEls[state.pos].classList.add('lit');
      if (delay < 140) tileEls[(state.pos + trailDir + N) % N].classList.add('trail1');
      if (delay < 90) tileEls[(state.pos + trailDir * 2 + N) % N].classList.add('trail2');
      if (delay < 50) tileEls[(state.pos + trailDir * 3 + N) % N].classList.add('trail3');
      Sound.tick();
      await sleep(delay);
    }
    // Snap exactly onto target (parity / rounding safety)
    state.pos = target;
    setLight(state.pos, 0);
  }

  /** Estimate light-run duration so reels can finish roughly together. */
  function estimateLightMs(target, fx = null) {
    const skip = !!(fx && fx.skip);
    const step = skip ? 2 : 1;
    let dist = (target - state.pos + N) % N;
    if (fx && fx.reverse) dist = (state.pos - target + N) % N;
    if (skip && dist % 2 === 1) dist += 1; // align nudge approx
    // runLight picks 2 or 3 laps; use 2.5 mean so reel sync stays close
    const laps = 2.5;
    const totalSteps = Math.floor((laps * N + dist) / step);
    const FAST = skip ? 36 : 28;
    const DECEL = 15;
    let ms = (fx && fx.fakeStop) ? 280 : 0;
    for (let s = 1; s <= totalSteps; s++) {
      const remaining = totalSteps - s;
      if (s <= 6) ms += FAST + (7 - s) * 16;
      else if (remaining >= DECEL) ms += FAST;
      else ms += FAST + Math.pow(DECEL - remaining, 2) * 2;
    }
    return ms;
  }

  /** Compact mode tag shown on the VFD during a special light run. */
  function lightModeLabel(fx) {
    if (!fx) return '';
    const bits = [];
    if (fx.reverse) bits.push('倒跑');
    if (fx.skip) bits.push('跳格');
    if (fx.fakeStop) bits.push('假停');
    return bits.length ? bits.join('・') : '';
  }

  function countBingoLines(board) {
    let n = 0;
    for (const line of BINGO_LINES) {
      if (line.every((i) => board[i])) n += 1;
    }
    return n;
  }

  function renderBingo() {
    const root = $('bingoBoard');
    if (!root) return;
    const was = root.hidden;
    const bingoOn = !!settings.modes.bingo;
    root.hidden = !bingoOn;
    root.querySelectorAll('.bingo-cell').forEach((el, i) => {
      el.classList.toggle('on', !!state.bingo[i]);
      el.classList.toggle('flash', false);
    });

    const marked = state.bingo.reduce((n, v) => n + (v ? 1 : 0), 0);
    const lines = countBingoLines(state.bingo);
    const missionBar = $('missionBar');
    const missionFill = $('missionFill');
    const missionCnt = $('missionCnt');
    const bingoWrap = $('bingoWrap');
    const topPlaque = $('topPlaque');
    if (missionBar) missionBar.hidden = !bingoOn;
    if (missionFill) missionFill.style.width = `${Math.round((marked / 9) * 100)}%`;
    if (missionCnt) missionCnt.textContent = `${marked}/9`;
    if (bingoWrap) bingoWrap.classList.toggle('is-plaque', !bingoOn);
    if (topPlaque) topPlaque.hidden = bingoOn;

    const lineMini = $('lineMini');
    const lineMiniVal = $('lineMiniVal');
    if (lineMiniVal) lineMiniVal.textContent = String(lines);
    if (lineMini) {
      lineMini.classList.toggle('off', !bingoOn);
      lineMini.classList.toggle('is-hit', bingoOn && lines > 0);
    }

    if (was !== root.hidden && typeof scheduleFit === 'function') scheduleFit();
  }

  function flashBingoCell(i) {
    const root = $('bingoBoard');
    if (!root) return;
    const el = root.querySelector(`.bingo-cell[data-b="${i}"]`);
    if (!el) return;
    el.classList.add('on', 'flash');
    setTimeout(() => el.classList.remove('flash'), 600);
  }

  function flashBingoLine(line) {
    const root = $('bingoBoard');
    if (!root) return;
    line.forEach((i) => {
      const el = root.querySelector(`.bingo-cell[data-b="${i}"]`);
      if (el) el.classList.add('line');
    });
    setTimeout(() => {
      root.querySelectorAll('.bingo-cell.line').forEach((el) => el.classList.remove('line'));
    }, 900);
  }

  function reduceMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Public Vibration API only (no private CoreHaptics). No-op if unsupported / reduced. */
  function hapticVibrate(tier = 1) {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
      if (reduceMotion()) {
        navigator.vibrate(8);
        return;
      }
      const t = Math.max(0, Math.min(5, tier | 0));
      const patterns = [
        [10],
        [16],
        [20, 36, 20],
        [28, 36, 28, 36, 48],
        [36, 28, 36, 28, 55, 36, 70],
        [48, 28, 48, 28, 48, 28, 90, 45, 110],
      ];
      navigator.vibrate(patterns[t]);
    } catch { /* ignore */ }
  }

  /** Win intensity 0..5 from credit gained + multiplier (or forced kind). */
  function winTierFrom(amount = 0, mult = 0, kind = 'win') {
    if (kind === 'jp') return 5;
    if (kind === 'fever') return Math.max(4, amount >= 200 ? 5 : 4);
    const a = Math.max(0, amount | 0);
    const m = Math.max(0, mult | 0);
    if (a >= 500 || m >= 100) return 4;
    if (a >= 200 || m >= 40) return 3;
    if (a >= 80 || m >= 20) return 2;
    if (a >= 20 || m >= 10) return 1;
    return 0;
  }

  /** Coin-pusher style cascade (visual only). */
  function flourishCoins(n = 12) {
    const host = $('flourishLayer');
    if (!host || reduceMotion()) return;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.className = 'coin-fall';
      c.style.left = (8 + Math.random() * 84) + '%';
      c.style.animationDelay = (Math.random() * 0.35) + 's';
      c.style.animationDuration = (0.7 + Math.random() * 0.55) + 's';
      host.appendChild(c);
      setTimeout(() => c.remove(), 1600);
    }
  }

  /** Tiny e-horse dash across the marquee during FEVER (visual only). */
  function flourishHorse() {
    const host = $('flourishLayer');
    if (!host || reduceMotion()) return;
    const h = document.createElement('div');
    h.className = 'horse-dash';
    h.textContent = '馬';
    host.appendChild(h);
    setTimeout(() => h.remove(), 1400);
  }

  /** Win sparkles around the lit tile / center (original SVG, visual only). */
  function flourishSparkles(n = 10, originEl = null) {
    const host = $('flourishLayer');
    if (!host || reduceMotion()) return;
    const cab = cabinetEl || host;
    const cr = cab.getBoundingClientRect();
    let ox = cr.width * 0.5, oy = cr.height * 0.42;
    if (originEl) {
      const r = originEl.getBoundingClientRect();
      ox = r.left + r.width / 2 - cr.left;
      oy = r.top + r.height / 2 - cr.top;
    }
    for (let i = 0; i < n; i++) {
      const sp = document.createElement('i');
      sp.className = 'sparkle';
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const dist = (0.18 + Math.random() * 0.55) * Math.min(cr.width, cr.height);
      sp.style.left = ox + 'px';
      sp.style.top = oy + 'px';
      sp.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      sp.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      sp.style.setProperty('--s', (0.55 + Math.random() * 0.9).toFixed(2));
      sp.style.animationDelay = (Math.random() * 0.18) + 's';
      host.appendChild(sp);
      setTimeout(() => sp.remove(), 1100);
    }
  }

  /** Screen flash overlay (CSS only — never Camera / torch). */
  function flourishScreenFlash(tier = 1) {
    const host = $('flourishLayer');
    if (!host || reduceMotion()) return;
    const t = Math.max(0, Math.min(5, tier | 0));
    const flash = document.createElement('div');
    flash.className = 'screen-flash tier-' + t;
    host.appendChild(flash);
    setTimeout(() => flash.remove(), 650 + t * 40);
  }

  /** Multi-light cascade outward from winning tile. */
  function flourishCascade(center, tier = 1) {
    if (reduceMotion() || !tileEls || center < 0 || center >= N) return;
    const span = Math.min(Math.floor(N / 2), 2 + Math.max(0, tier | 0));
    tileEls[center].classList.add('cascade-core');
    setTimeout(() => tileEls[center]?.classList.remove('cascade-core'), 420 + tier * 40);
    for (let d = 1; d <= span; d++) {
      const delay = d * 48;
      const a = (center + d) % N;
      const b = (center - d + N) % N;
      setTimeout(() => {
        tileEls[a]?.classList.add('cascade');
        tileEls[b]?.classList.add('cascade');
        setTimeout(() => {
          tileEls[a]?.classList.remove('cascade');
          tileEls[b]?.classList.remove('cascade');
        }, 260);
      }, delay);
    }
  }

  /** Particle burst: sparkles + confetti dots + rays, scaled by tier. */
  function flourishParticles(tier = 1, originEl = null) {
    const host = $('flourishLayer');
    if (!host || reduceMotion()) return;
    const t = Math.max(0, Math.min(5, tier | 0));
    flourishSparkles(8 + t * 6, originEl);
    const cab = cabinetEl || host;
    const cr = cab.getBoundingClientRect();
    let ox = cr.width * 0.5, oy = cr.height * 0.42;
    if (originEl) {
      const r = originEl.getBoundingClientRect();
      ox = r.left + r.width / 2 - cr.left;
      oy = r.top + r.height / 2 - cr.top;
    }
    const dots = 6 + t * 5;
    for (let i = 0; i < dots; i++) {
      const d = document.createElement('i');
      d.className = 'particle-dot';
      const ang = (Math.PI * 2 * i) / dots + Math.random() * 0.5;
      const dist = (0.12 + Math.random() * 0.62) * Math.min(cr.width, cr.height);
      d.style.left = ox + 'px';
      d.style.top = oy + 'px';
      d.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      d.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      d.style.setProperty('--hue', String(28 + Math.floor(Math.random() * 50)));
      d.style.animationDelay = (Math.random() * 0.12) + 's';
      host.appendChild(d);
      setTimeout(() => d.remove(), 1000);
    }
    if (t >= 2) {
      const rays = 6 + t * 2;
      for (let i = 0; i < rays; i++) {
        const ray = document.createElement('i');
        ray.className = 'particle-ray';
        ray.style.left = ox + 'px';
        ray.style.top = oy + 'px';
        ray.style.setProperty('--rot', ((360 * i) / rays) + 'deg');
        ray.style.animationDelay = (i * 0.02) + 's';
        host.appendChild(ray);
        setTimeout(() => ray.remove(), 900);
      }
    }
  }

  /** FEVER / READY burst behind the banner (richer multi-ring). */
  function flourishFeverSplash(kind = 'fever') {
    const host = $('flourishLayer');
    if (!host || reduceMotion()) return;
    const splash = document.createElement('div');
    splash.className = 'fever-splash' + (kind === 'ready' ? ' ready' : '');
    host.appendChild(splash);
    const rings = kind === 'fever' ? 3 : 2;
    for (let i = 0; i < rings; i++) {
      const ring = document.createElement('div');
      ring.className = 'fever-ring' + (i ? ' delayed' : '');
      ring.style.animationDelay = (i * 0.12) + 's';
      host.appendChild(ring);
      setTimeout(() => ring.remove(), 1500 + i * 120);
    }
    setTimeout(() => splash.remove(), 1500);
  }

  /**
   * Unified hit celebration: audio sting + BGM duck + flash + cascade +
   * particles + FEVER splash + Vibration API + cabinet haptic bounce.
   * Scales by win size. Audio respects Sound.on (silent/mute); no Camera API.
   */
  function celebrateHit({ amount = 0, mult = 0, kind = 'win', originEl = null, target = -1, splash = true } = {}) {
    const tier = winTierFrom(amount, mult, kind);
    const origin = originEl || (target >= 0 ? tileEls[target] : null)
      || document.querySelector('.tile.lit, .tile.win') || $('center');
    Sound.celebrate(tier, kind === 'jp' ? 'jp' : kind === 'fever' ? 'fever' : 'win');
    Music.duck(450 + tier * 160, Math.max(0.12, 0.38 - tier * 0.04));
    hapticVibrate(tier);
    FX.win(tier);
    flourishScreenFlash(tier);
    flourishParticles(tier, origin);
    if (target >= 0) flourishCascade(target, tier);
    if (splash && tier >= 2) {
      const k = kind === 'fever' || tier >= 4 ? 'fever' : 'ready';
      if (tier >= 3) FX.flashFever(k, 900 + tier * 200);
      else flourishFeverSplash(k);
    }
    if (tier >= 3) flourishCoins(6 + tier * 3);
    if (tier >= 4) flourishHorse();
    return tier;
  }

  /** Pachislot-style staggered reel stop (stop-button feel). */
  // ---------------------------------------------------------------------------
  // Cabinet mini-stage overlays (wheel / gacha / sicbo / pachinko / balls / roulette)
  // ---------------------------------------------------------------------------
  const STAGE_META = {
    luckyWheel: { badge: 'WHEEL', title: '幸運轉輪' },
    gacha: { badge: 'GACHA', title: '轉蛋' },
    sicbo: { badge: 'SIC BO', title: '骰寶' },
    pachinko: { badge: 'PACHI', title: '彈珠台' },
    ballDraw: { badge: 'DRAW', title: '抽球機' },
    roulette: { badge: 'ROULETTE', title: '電子輪盤' },
  };

  function openStageOverlay(kind) {
    const overlay = $('stageOverlay');
    const body = $('stageBody');
    const result = $('stageResult');
    const badge = $('stageBadge');
    const title = $('stageTitle');
    if (!overlay || !body) return null;
    const meta = STAGE_META[kind] || { badge: 'BONUS', title: '舞台' };
    if (badge) badge.textContent = meta.badge;
    if (title) title.textContent = meta.title;
    if (result) { result.textContent = ''; result.className = 'stage-result'; }
    body.innerHTML = '';
    body.dataset.kind = kind;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    cabinetEl?.classList.add('fx-expect');
    Sound.stageOpen();
    Music.duck(600, 0.25);
    return { overlay, body, result };
  }

  function closeStageOverlay() {
    const overlay = $('stageOverlay');
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    const body = $('stageBody');
    if (body) body.innerHTML = '';
    cabinetEl?.classList.remove('fx-expect');
  }

  function setStageResult(el, gained, label) {
    if (!el) return;
    if (gained > 0) {
      el.textContent = label || `+${gained}`;
      el.className = 'stage-result hit';
    } else {
      el.textContent = label || '沒中';
      el.className = 'stage-result miss';
    }
  }

  function iconForSym(id) {
    const s = SYMBOLS.find((x) => x.id === id);
    if (!s) return '❓';
    if (s.icon) return s.icon;
    if (id === 'seven') return '7️⃣';
    if (id === 'bar') return '🅱️';
    return s.name[0];
  }

  async function playLuckyWheel(step) {
    const ui = openStageOverlay('luckyWheel');
    if (!ui) return;
    const n = (step.segments && step.segments.length) || 10;
    const segAngle = 360 / n;
    const wrap = document.createElement('div');
    wrap.className = 'sw-wheel-wrap';
    wrap.innerHTML = `<div class="sw-pointer"></div><div class="sw-wheel" id="swWheel"><div class="sw-hub">GO</div></div>`;
    ui.body.appendChild(wrap);
    const wheel = wrap.querySelector('.sw-wheel');
    // Labels around the rim
    const labs = document.createElement('div');
    labs.className = 'sw-labels';
    (step.segments || []).forEach((seg, i) => {
      const lab = document.createElement('div');
      lab.className = 'sw-lab';
      lab.textContent = seg.label;
      const ang = i * segAngle + segAngle / 2;
      lab.style.transform = `rotate(${ang}deg) translateY(calc(var(--u) * -18)) rotate(${-ang}deg)`;
      labs.appendChild(lab);
    });
    wheel.appendChild(labs);

    const targetAngle = 360 * (5 + Math.floor(randomFloat() * 3)) + (360 - (step.index * segAngle + segAngle / 2));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduced ? 500 : 3200;
    const t0 = performance.now();
    let lastTick = -1;
    await new Promise((resolve) => {
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const ease = 1 - Math.pow(1 - p, 3);
        const ang = targetAngle * ease;
        wheel.style.transform = `rotate(${ang}deg)`;
        const seg = Math.floor(((ang % 360) / segAngle)) % n;
        if (seg !== lastTick) {
          lastTick = seg;
          if (!reduced) Sound.wheelTick();
        }
        if (p < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    await sleep(280);
    if (step.gained > 0) {
      celebrateHit({ amount: step.gained, mult: step.mult || 10, kind: step.tone === 'jp' ? 'jp' : 'win', originEl: wrap });
      setStageResult(ui.result, step.gained, `${step.label}  +${step.gained}`);
    } else {
      Sound.lose();
      setStageResult(ui.result, 0, `${step.label}・沒中`);
    }
    await sleep(900);
    closeStageOverlay();
  }

  async function playGacha(step) {
    const ui = openStageOverlay('gacha');
    if (!ui) return;
    const stage = document.createElement('div');
    stage.className = 'sg-stage';
    const colors = ['#ff6080', '#42a5f5', '#66bb6a', '#ffca28', '#ab47bc', '#26c6da'];
    let caps = '';
    for (let i = 0; i < 8; i++) {
      const c = colors[i % colors.length];
      const left = 10 + (i % 4) * 20;
      const top = 15 + Math.floor(i / 4) * 28 + (i % 2) * 8;
      caps += `<span class="sg-capsule" style="left:${left}%;top:${top}%;--cap:${c};animation-delay:${(i * 0.12).toFixed(2)}s"></span>`;
    }
    stage.innerHTML = `
      <div class="sg-machine">
        <div class="sg-dome">${caps}</div>
        <div class="sg-chute"><div class="sg-prize glow-${step.glow || 'n'}" id="sgPrize">${iconForSym(step.symbol)}</div></div>
      </div>
      <div class="sg-tier" id="sgTier">…</div>`;
    ui.body.appendChild(stage);
    Sound.gacha();
    await sleep(700);
    const prize = stage.querySelector('#sgPrize');
    const tierEl = stage.querySelector('#sgTier');
    prize?.classList.add('show');
    if (tierEl) tierEl.textContent = `${step.tierName}・${step.symbolName}`;
    hapticVibrate(step.tier === 'SSR' ? 4 : step.tier === 'SR' ? 3 : 2);
    await sleep(450);
    if (step.gained > 0) {
      celebrateHit({
        amount: step.gained,
        mult: step.payMult * 5,
        kind: step.tier === 'SSR' ? 'fever' : 'win',
        originEl: prize,
      });
      setStageResult(ui.result, step.gained, `${step.tierName} ×${step.payMult}  +${step.gained}`);
    } else {
      Sound.lose();
      setStageResult(ui.result, 0, `${step.tierName}・未押 ${step.symbolName}`);
    }
    await sleep(950);
    closeStageOverlay();
  }

  async function playSicbo(step) {
    const ui = openStageOverlay('sicbo');
    if (!ui) return;
    const stage = document.createElement('div');
    stage.className = 'ss-stage';
    stage.innerHTML = `
      <div class="ss-tray">
        <div class="ss-die rolling" data-d="0">?</div>
        <div class="ss-die rolling" data-d="1">?</div>
        <div class="ss-die rolling" data-d="2">?</div>
      </div>
      <div class="ss-sum" id="ssSum">擲骰中…</div>
      <div class="ss-tag" id="ssTag">—</div>`;
    ui.body.appendChild(stage);
    const diceEls = [...stage.querySelectorAll('.ss-die')];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rollMs = reduced ? 200 : 900;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = (now) => {
        if (now - t0 < rollMs) {
          diceEls.forEach((el) => { el.textContent = String(1 + Math.floor(randomFloat() * 6)); });
          if (Math.floor((now - t0) / 80) !== Math.floor((now - t0 - 16) / 80)) Sound.dice();
          requestAnimationFrame(tick);
        } else resolve();
      };
      requestAnimationFrame(tick);
    });
    diceEls.forEach((el, i) => {
      el.classList.remove('rolling');
      el.textContent = String(step.dice[i]);
      if (step.triple) el.classList.add('triple');
    });
    const sumEl = stage.querySelector('#ssSum');
    const tagEl = stage.querySelector('#ssTag');
    if (sumEl) sumEl.textContent = `合計 ${step.sum}`;
    const outcomeLabel = { big: '大', small: '小', triple: '豹子', point: '點' }[step.outcome] || step.outcome;
    if (tagEl) {
      tagEl.textContent = outcomeLabel;
      tagEl.className = `ss-tag ${step.outcome}`;
    }
    await sleep(350);
    if (step.gained > 0) {
      celebrateHit({ amount: step.gained, mult: step.mult * 8, kind: step.triple ? 'fever' : 'win', originEl: stage });
      setStageResult(ui.result, step.gained, `${outcomeLabel}  +${step.gained}`);
    } else {
      Sound.lose();
      setStageResult(ui.result, 0, `${outcomeLabel}・沒中`);
    }
    await sleep(900);
    closeStageOverlay();
  }

  async function playPachinko(step) {
    const ui = openStageOverlay('pachinko');
    if (!ui) return;
    const stage = document.createElement('div');
    stage.className = 'sp-stage';
    const pegs = Array.from({ length: 54 }, () => '<span class="sp-peg"></span>').join('');
    const pockets = (step.pockets || []).map((p, i) =>
      `<div class="sp-pocket" data-i="${i}">${p.label}</div>`).join('');
    stage.innerHTML = `
      <div class="sp-board">
        <div class="sp-pegs">${pegs}</div>
        <div class="sp-ball" id="spBall"></div>
        <div class="sp-pockets">${pockets}</div>
      </div>`;
    ui.body.appendChild(stage);
    const ball = stage.querySelector('#spBall');
    const board = stage.querySelector('.sp-board');
    const path = step.path || [4, 4, 4, 4, 4, 4, 4, 4, step.index];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cols = 9;
    for (let i = 0; i < path.length; i++) {
      const col = path[i];
      const row = i;
      const xPct = ((col + 0.5) / cols) * 100;
      const yPct = 4 + (row / Math.max(1, path.length - 1)) * 72;
      if (ball) {
        ball.style.left = `${xPct}%`;
        ball.style.top = `${yPct}%`;
      }
      if (!reduced) Sound.pachi();
      await sleep(reduced ? 30 : 70);
    }
    const pocketEl = stage.querySelector(`.sp-pocket[data-i="${step.index}"]`);
    pocketEl?.classList.add('hit');
    await sleep(300);
    if (step.gained > 0) {
      celebrateHit({ amount: step.gained, mult: step.mult * 4, kind: step.mult >= 20 ? 'jp' : 'win', originEl: pocketEl || board });
      setStageResult(ui.result, step.gained, `${step.label}  +${step.gained}`);
    } else {
      Sound.lose();
      setStageResult(ui.result, 0, `${step.label}・沒中`);
    }
    await sleep(900);
    closeStageOverlay();
  }

  async function playBallDraw(step) {
    const ui = openStageOverlay('ballDraw');
    if (!ui) return;
    const stage = document.createElement('div');
    stage.className = 'sb-stage';
    let floats = '';
    for (let i = 0; i < 10; i++) {
      const sym = SYMBOLS[i % SYMBOLS.length];
      const left = 8 + (i % 5) * 18;
      const top = 12 + Math.floor(i / 5) * 35 + (i % 3) * 5;
      floats += `<span class="sb-float" style="left:${left}%;top:${top}%;animation-delay:${(i * 0.11).toFixed(2)}s">${iconForSym(sym.id)}</span>`;
    }
    stage.innerHTML = `
      <div class="sb-cage">${floats}</div>
      <div class="sb-drawn" id="sbDrawn"></div>`;
    ui.body.appendChild(stage);
    await sleep(600);
    const drawn = stage.querySelector('#sbDrawn');
    for (const b of step.balls || []) {
      const el = document.createElement('div');
      el.className = 'sb-ball' + (b.hit ? ' hit' : '');
      el.textContent = iconForSym(b.id);
      el.title = b.name;
      drawn.appendChild(el);
      await sleep(180);
      el.classList.add('show');
      Sound.ballPop();
      hapticVibrate(b.hit ? 2 : 1);
      await sleep(280);
    }
    await sleep(200);
    if (step.gained > 0) {
      celebrateHit({
        amount: step.gained,
        mult: step.triple ? 30 : 12,
        kind: step.triple ? 'fever' : 'win',
        originEl: drawn,
      });
      const tag = step.triple ? '三同球！' : `中 ${(step.matched || []).length} 球`;
      setStageResult(ui.result, step.gained, `${tag}  +${step.gained}`);
    } else {
      Sound.lose();
      setStageResult(ui.result, 0, '未押中');
    }
    await sleep(950);
    closeStageOverlay();
  }

  async function playRoulette(step) {
    const ui = openStageOverlay('roulette');
    if (!ui) return;
    const pockets = step.pockets || 13;
    const seg = 360 / pockets;
    const wrap = document.createElement('div');
    wrap.className = 'sr-wheel-wrap';
    wrap.innerHTML = `
      <div class="sr-pointer"></div>
      <div class="sr-wheel" id="srWheel"><div class="sr-hub" id="srHub">?</div></div>
      <div class="sr-ball" id="srBall"></div>`;
    const info = document.createElement('div');
    info.className = 'sr-info';
    info.innerHTML = `<span class="sr-chip ${step.color}" id="srColor">—</span><span id="srKind">旋轉中…</span>`;
    ui.body.appendChild(wrap);
    ui.body.appendChild(info);
    const wheel = wrap.querySelector('.sr-wheel');
    const hub = wrap.querySelector('#srHub');
    const ball = wrap.querySelector('#srBall');
    const targetAngle = 360 * (6 + Math.floor(randomFloat() * 3)) + (360 - (step.number * seg + seg / 2));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduced ? 500 : 3600;
    Sound.roulette();
    const t0 = performance.now();
    let lastTick = -1;
    if (ball) ball.classList.add('show');
    await new Promise((resolve) => {
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const ease = 1 - Math.pow(1 - p, 3.2);
        const ang = targetAngle * ease;
        if (wheel) wheel.style.transform = `rotate(${ang}deg)`;
        // Ball counter-rotates slightly for feel
        if (ball) ball.style.transform = `rotate(${-ang * 0.15}deg) translateY(0)`;
        const segI = Math.floor(((ang % 360) / seg)) % pockets;
        if (segI !== lastTick) {
          lastTick = segI;
          if (!reduced) Sound.wheelTick();
        }
        if (p < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    if (hub) hub.textContent = String(step.number);
    const colorEl = info.querySelector('#srColor');
    const kindEl = info.querySelector('#srKind');
    if (colorEl) {
      colorEl.className = `sr-chip ${step.color}`;
      colorEl.textContent = step.color === 'red' ? '紅' : step.color === 'black' ? '黑' : '0';
    }
    const kindLabel = {
      number: `號碼 ${step.number}`,
      color: step.color === 'red' ? '押紅' : '押黑',
      even: '雙數',
      odd: '單數',
      zero: '零',
    }[step.kind] || step.kind;
    if (kindEl) kindEl.textContent = kindLabel;
    await sleep(300);
    if (step.gained > 0) {
      celebrateHit({ amount: step.gained, mult: step.mult * 3, kind: step.kind === 'number' || step.kind === 'zero' ? 'fever' : 'win', originEl: wrap });
      setStageResult(ui.result, step.gained, `${kindLabel}  +${step.gained}`);
    } else {
      Sound.lose();
      setStageResult(ui.result, 0, `${kindLabel}・沒中`);
    }
    await sleep(950);
    closeStageOverlay();
  }

  /** Bridge: special / ONCE MORE lamp → stage entry (pulse trigger + celebrate). */
  async function cueStageEntry(step) {
    const trig = step && step.trigger;
    const ti = trig && Number.isInteger(trig.target) ? trig.target : -1;
    const tile = ti >= 0 ? tileEls[ti] : null;
    if (tile) {
      tile.classList.add('win', 'lit2');
      flourishCascade(ti, 2);
    }
    const why = trig && trig.kind === 'once'
      ? 'ONCE MORE・進入舞台'
      : trig && trig.kind === 'special'
        ? '特殊燈・進入舞台'
        : '進入舞台';
    setMsg(why, 'hot');
    Sound.lucky();
    celebrateHit({
      amount: 20,
      mult: 12,
      kind: 'win',
      target: ti,
      originEl: tile || $('center'),
      splash: true,
    });
    hapticVibrate(2);
    await sleep(520);
  }

  async function playCabinetStage(step) {
    try {
      await cueStageEntry(step);
      setMsg(`${(STAGE_META[step.type] || {}).title || '舞台'}！`, 'hot');
      FX.showFever('ready');
      flourishFeverSplash('ready');
      hapticVibrate(2);
      if (step.type === 'luckyWheel') await playLuckyWheel(step);
      else if (step.type === 'gacha') await playGacha(step);
      else if (step.type === 'sicbo') await playSicbo(step);
      else if (step.type === 'pachinko') await playPachinko(step);
      else if (step.type === 'ballDraw') await playBallDraw(step);
      else if (step.type === 'roulette') await playRoulette(step);
    } finally {
      closeStageOverlay();
      FX.hideFever();
    }
  }

  async function playSlotBonus(step) {
    if (step.trigger) await cueStageEntry(step);
    setMsg(step.freeSpin ? '三輪 Bonus・FREE' : '三輪 Bonus', 'hot');
    FX.flashFever('ready', 1200);
    Sound.slot();
    const ids = step.reels || ['apple', 'orange', 'mango'];
    measureReelCells();
    reelStrips.forEach((r) => {
      r.parent.classList.remove('landed');
      r.parent.classList.add('spinning');
      r.el.classList.remove('settle');
    });
    const spinMs = [900, 1300, 1700];
    const start = performance.now();
    let done = [false, false, false];
    await new Promise((resolve) => {
      const tick = (now) => {
        const t = now - start;
        let all = true;
        reelStrips.forEach((r, ri) => {
          if (done[ri]) return;
          if (t >= spinMs[ri]) {
            const idx = findReelIndex(ri, ids[ri], true);
            setReelOffset(ri, idx, true);
            r.parent.classList.remove('spinning');
            r.parent.classList.add('landed');
            Sound.beep(700 + ri * 180, 0.05, 'square', 0.045);
            done[ri] = true;
          } else {
            all = false;
            const cells = (t / 16) * (3.2 + ri * 0.35);
            setReelOffset(ri, Math.floor(cells) % r.seq.length, false);
          }
        });
        if (all) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await sleep(350);
    if (step.gained > 0) {
      celebrateHit({
        amount: step.gained,
        mult: (step.match || 1) * 10,
        kind: step.match >= 3 ? 'fever' : 'win',
        originEl: $('center'),
      });
      setMsg(`三輪 ${step.match} 連 +${step.gained}`, 'hot');
      await animateWin(state.win, state.win + step.gained);
    } else {
      setMsg('三輪・沒中', 'bad');
      Sound.lose();
    }
    if (step.freeSpin) {
      setMsg('三輪 FREE SPIN', 'hot');
      await sleep(500);
    }
    await sleep(280);
  }

  async function animateWin(from, to) {
    const capped = Math.min(CREDIT_CAP, Math.max(0, Math.floor(to)));
    const start = Math.min(CREDIT_CAP, Math.max(0, Math.floor(from)));
    if (capped <= start) {
      state.win = capped;
      winLed.set(state.win);
      return;
    }
    const steps = Math.min(30, Math.max(1, capped - start));
    for (let k = 1; k <= steps; k++) {
      state.win = Math.round(start + ((capped - start) * k) / steps);
      winLed.set(state.win);
      if (k % 2) Sound.coin();
      await sleep(25);
    }
    state.win = capped;
    if (to > CREDIT_CAP) toast('WIN 已達上限', 'warn');
  }

  async function start() {
    // Synchronous guard + busy flag (set before any await) blocks double-tap races.
    const reason = why.start();
    if (reason) { deny(reason); stopAuto(); render(); return; }
    Sound.unlock();
    if (state.win > 0) collectInstant();
    clearHighlights();
    const total = sum(state.bets);
    if (!state.betsPaid) {
      if (state.credit < total) {
        deny(`需 ${total}・請清押或開分`);
        stopAuto();
        render();
        return;
      }
      state.credit -= total;
      state.betsPaid = true;
    }
    state.lastPlayedBets = state.bets.slice();
    state.busy = true;
    // Snapshot for mid-spin persist + exception rollback (see roundPersist / save).
    roundPersist = { win: state.win, bingo: state.bingo.slice(), jp: state.jp };
    FX.spin();
    render();
    save();

    let roundOk = false;
    try {
    const potBefore = settings.modes.jp ? state.jp : 0;
    const result = E.resolveRound(state.bets, settings, randomFloat, potBefore, { bingoBoard: state.bingo });
    // Apply bingo snapshots per step (not the final board) so marks / lines animate.
    let roundWin = 0;
    let inOnceRun = false;
    let onceVariant = 'single';

    async function playLandPay(step, { fromSuper = false } = {}) {
      const sym = step.si >= 0 ? SYMBOLS[step.si] : null;
      if (step.gained > 0 && sym) {
        roundWin += step.gained;
        tileEls[step.target].classList.add('win');
        setKeyHit(betKeys[step.si], true);
        celebrateHit({
          amount: step.gained,
          mult: step.mult || 0,
          kind: 'win',
          target: step.target,
          originEl: tileEls[step.target],
        });
        const small = TRACK[step.target].small ? '小' : '';
        const prefix = fromSuper ? '超跑・' : '';
        setMsg(`${prefix}${sym.name}${small} ${state.bets[step.si]}×${step.mult}=${step.gained}`, 'hot');
        await animateWin(state.win, state.win + step.gained);
      } else if (!sym && TRACK[step.target]?.s === 'once') {
        // Super / FEVER can still land on ONCE MORE (0 pay) — don't go silent.
        tileEls[step.target].classList.add('win');
        setMsg((fromSuper ? '超跑・' : '') + 'ONCE MORE', 'hot');
        Sound.once();
        hapticVibrate(1);
      } else if (sym) {
        const special = typeof E.isSlotSpecial === 'function'
          ? E.isSlotSpecial(TRACK[step.target])
          : (!TRACK[step.target].small && ['seven', 'star', 'bar'].includes(TRACK[step.target].s));
        if (special) {
          // Special full tiles can still open Bonus / stages even with 0 pay — don't "lose" cue.
          tileEls[step.target].classList.add('win');
          setMsg(`${sym.name}・特殊燈`, 'hot');
          Sound.lucky();
          hapticVibrate(2);
          flourishCascade(step.target, 2);
          flourishScreenFlash(1);
        } else {
          setMsg(`${sym.name}${TRACK[step.target].small ? '小' : ''}・沒中`, 'bad');
          Sound.lose();
          if (!fromSuper) FX.idle();
        }
      }
    }

    for (const step of result.steps) {
      if (step.type === 'once') {
        const label = ONCE_VARIANT_LABEL[step.variant] || 'ONCE MORE';
        const modeTag = lightModeLabel(step.fx);
        showOnceBanner(step.variant, step.remaining);
        setMsg((modeTag ? modeTag + '・' : '') + (step.remaining > 0 ? `${label}…` : `${label}・上限`), 'hot');
        const dur = estimateLightMs(step.target, step.fx);
        FX.spin();
        await Promise.all([runLight(step.target, { expect: false, fx: step.fx }), spinReels('once', Math.max(900, dur - 400))]);
        tileEls[step.target].classList.add('win');
        FX.win(1);
        Sound.once();
        hapticVibrate(1);
        flourishCascade(step.target, 1);
        flourishScreenFlash(1);
        // Hint only — full celebrateHit runs in cueStageEntry when the stage actually opens
        {
          const opensStage = result.steps.some((st) =>
            st.trigger && st.trigger.target === step.target
            && (st.type === 'slot' || (E.STAGE_KEYS || []).includes(st.type)));
          if (opensStage) {
            setMsg('ONCE MORE・觸發舞台！', 'hot');
            Sound.lucky();
            await sleep(350);
          }
        }
        if (step.remaining <= 0) {
          setMsg(step.capped ? '再跑已達上限' : `${label}`, 'hot');
          await sleep(700);
          tileEls[step.target].classList.remove('win');
          hideOnceBanner();
          // don't break — later steps may still be slot/bingo after a capped once
          continue;
        }
        setMsg(`${label}！再跑 ${step.remaining} 次`, 'hot');
        await sleep(850);
        tileEls[step.target].classList.remove('win');
        onceVariant = step.variant || 'single';
        inOnceRun = true;
        continue;
      }

      if (step.type === 'land') {
        const modeTag = lightModeLabel(step.fx);
        setMsg(modeTag || (inOnceRun ? '連跑中…' : '轉動中…'), (modeTag || inOnceRun) ? 'hot' : '');
        if (inOnceRun) showOnceBanner(onceVariant, step.runsLeft + 1);
        const dur = estimateLightMs(step.target, step.fx);
        const landId = TRACK[step.target].s;
        const willPay = step.gained > 0 || (step.double && step.double.gained > 0);
        FX.spin();
        await Promise.all([runLight(step.target, { expect: willPay, fx: step.fx }), spinReels(landId, Math.max(900, dur - 400))]);
        await playLandPay(step);
        if (step.double) {
          setMsg('雙燈！', 'hot');
          Sound.lucky();
          hapticVibrate(2);
          flourishScreenFlash(2);
          await sleep(280);
          // quick hop to second lamp (no full re-spin)
          state.pos = step.double.target;
          setLight(state.pos, 0);
          tileEls[step.double.target].classList.add('win', 'lit2');
          await playLandPay({ ...step.double, target: step.double.target });
          await sleep(350);
        }
        if (step.runsLeft > 0) {
          showOnceBanner(onceVariant, step.runsLeft);
          setMsg(`再跑 ${step.runsLeft} 次`, 'hot');
          await sleep(550);
          inOnceRun = true;
        } else {
          hideOnceBanner();
          inOnceRun = false;
        }
        continue;
      }

      if (step.type === 'super') {
        Sound.super();
        Music.duck(900, 0.2);
        hapticVibrate(3);
        flourishFeverSplash('ready');
        FX.flashFever('ready', 1000);
        setMsg(`超跑 ${step.count} 連停！`, 'hot');
        showOnceBanner('multi', step.count);
        for (let i = 0; i < step.stops.length; i++) {
          const st = step.stops[i];
          showOnceBanner('multi', step.stops.length - i);
          const dur = estimateLightMs(st.target);
          FX.spin();
          await Promise.all([runLight(st.target, { expect: st.gained > 0 }), spinReels(TRACK[st.target].s, Math.max(700, dur - 500))]);
          await playLandPay(st, { fromSuper: true });
          await sleep(220);
        }
        hideOnceBanner();
        if (step.gained > 0) {
          flourishCoins(10);
          flourishScreenFlash(3);
          hapticVibrate(3);
        }
        await sleep(300);
        continue;
      }

      if (step.type === 'slot') {
        await playSlotBonus(step);
        roundWin += Math.max(0, step.gained);
        continue;
      }

      if ((E.STAGE_KEYS || []).includes(step.type)) {
        await playCabinetStage(step);
        roundWin += Math.max(0, step.gained || 0);
        if (step.gained > 0) await animateWin(state.win, state.win + step.gained);
        continue;
      }

      if (step.type === 'fever') {
        celebrateHit({ amount: 200, mult: 40, kind: 'fever', originEl: $('center'), splash: true });
        FX.showFever('fever');
        setMsg(`FEVER ×${step.count}`, 'hot');
        for (let i = 0; i < step.runs.length; i++) {
          const fr = step.runs[i];
          setMsg(`FEVER ${i + 1}/${step.count}`, 'hot');
          const dur = estimateLightMs(fr.target, fr.fx);
          FX.spin();
          cabinetEl?.classList.add('fx-fever');
          await Promise.all([runLight(fr.target, { expect: fr.gained > 0, fx: fr.fx }), spinReels(TRACK[fr.target].s, Math.max(800, dur - 450))]);
          await playLandPay(fr, { fromSuper: true });
          await sleep(200);
        }
        FX.hideFever();
        if (step.gained > 0) {
          flourishCoins(12);
          flourishScreenFlash(4);
          hapticVibrate(4);
        }
        await sleep(300);
        continue;
      }

      if (step.type === 'bingo') {
        // Show the freshly marked cell on the live board first (step.board is post-clear).
        if (step.cell >= 0 && state.bingo.length === 9) {
          state.bingo[step.cell] = true;
          renderBingo();
          flashBingoCell(step.cell);
        }
        if (step.lines && step.lines.length) {
          celebrateHit({
            amount: step.gained || 30,
            mult: 15 * step.lines.length,
            kind: 'win',
            originEl: $('bingoBoard'),
          });
          for (const line of step.lines) flashBingoLine(line);
          setMsg(`賓果連線 ×${step.lines.length}`, 'hot');
          if (step.gained > 0) {
            roundWin += step.gained;
            await animateWin(state.win, state.win + step.gained);
            setMsg(`賓果 +${step.gained}`, 'hot');
          }
          await sleep(500);
        } else {
          await sleep(180);
        }
        if (Array.isArray(step.board)) state.bingo = step.board.map(Boolean);
        renderBingo();
        continue;
      }

      if (step.type === 'bonus') {
        celebrateHit({
          amount: step.gained || 40,
          mult: 25,
          kind: 'win',
          originEl: $('center'),
        });
        setMsg(`中彩・${step.name}`, 'hot');
        for (const bt of step.tiles) {
          tileEls[bt.i].classList.add('win', 'lit2');
          if (bt.si >= 0 && bt.gained > 0) setKeyHit(betKeys[bt.si], true);
          flourishCascade(bt.i, 1);
          await sleep(220);
        }
        if (step.gained > 0) {
          roundWin += step.gained;
          await animateWin(state.win, state.win + step.gained);
          setMsg(`${step.name} +${step.gained}`, 'hot');
        } else {
          setMsg(`${step.name}・沒押中`, 'hot');
        }
        await sleep(500);
        continue;
      }

      if (step.type === 'jp') {
        $('jpRow')?.classList.add('jp-hit');
        $('jpMini')?.classList.add('is-hit');
        celebrateHit({
          amount: step.amount,
          mult: 100,
          kind: 'jp',
          originEl: $('jpRow') || $('center'),
        });
        FX.holdsSet(4);
        setMsg(`JP！+${step.amount}`, 'hot');
        roundWin += step.amount;
        await animateWin(state.win, state.win + step.amount);
        await sleep(600);
      }
    }
    hideOnceBanner();
    if (Array.isArray(result.bingoBoard)) state.bingo = result.bingoBoard.map(Boolean);
    renderBingo();

    // Only accumulate / reset JP when the mode is on — otherwise the pot
    // kept growing invisibly and shocked players who re-enabled JP later.
    if (settings.modes.jp) {
      state.jp = E.nextJpPot(state.jp, total, result.jpWin, settings);
    }

    if (roundWin > 0) setMsg(`本局 +${roundWin}・得分或比大小`, 'hot');
    else if (!msgEl.textContent.includes('沒中') && !msgEl.textContent.includes('上限')) {
      /* keep prior lose message */
    }

    state.betsPaid = false;
    if (roundWin > 0) {
      const endTier = winTierFrom(roundWin, 0);
      FX.win(endTier);
      hapticVibrate(Math.min(endTier, 3));
      if (roundWin >= 100) {
        flourishFeverSplash('fever');
        FX.flashFever('fever', 1200);
        flourishScreenFlash(endTier);
      }
      FX.holdsSet(Math.min(4, holdCount + 1));
      // Stop hold-lamp flash so it doesn't stick until the next spin.
      setTimeout(() => { try { FX.holdsFlash(false); } catch (_) {} }, 1600);
    } else {
      FX.idle();
      if (holdCount > 0 && randomFloat() < 0.35) FX.holdsSet(holdCount - 1);
    }
    if (state.credit === 0 && state.win === 0) {
      setMsg('CREDIT 用完・請開分', 'bad');
      toast('CREDIT 用完', 'bad');
      stopAuto('CREDIT 不足・自動已停');
    } else if (state.auto && state.credit + state.win < sum(state.lastPlayedBets)) {
      // auto-off as soon as the next round can't be afforded
      stopAuto(`需 ${sum(state.lastPlayedBets)}・自動停`);
    }
    if (state.auto) queueAuto();
    roundOk = true;
    } finally {
      hideOnceBanner();
      closeStageOverlay();
      FX.hideFever();
      // Soft-lock guards: never leave reels/deck/FX stuck if a stage/light await threw.
      try {
        reelStrips.forEach((r) => r.parent.classList.remove('landed', 'spinning'));
      } catch (_) { /* boot race */ }
      if (!roundOk && roundPersist) {
        // Aborted mid-round: roll back animated WIN / bingo before persist.
        state.win = roundPersist.win;
        state.bingo = roundPersist.bingo.slice();
        state.jp = roundPersist.jp;
        try { FX.idle(); } catch (_) { /* */ }
      } else {
        // Success: drop stuck spin/expect/fever but keep end-of-round fx-win pulse
        // (FX.clear() here used to wipe FX.win() set just above).
        try {
          cabinetEl?.classList.remove('fx-spin', 'fx-reach', 'fx-expect', 'fx-fever');
        } catch (_) { /* */ }
      }
      roundPersist = null;
      state.busy = false;
      render();
      save();
    }
  }

  async function collect() {
    const reason = why.collect();
    if (reason) { if (!state.auto) deny(reason); return; }
    state.busy = true;
    clearHighlights();
    render();
    try {
      const amount = state.win;
      const room = Math.max(0, CREDIT_CAP - state.credit);
      const take = Math.min(amount, room);
      const steps = Math.max(1, Math.min(40, take));
      const startCredit = state.credit;
      for (let k = 1; k <= steps; k++) {
        const moved = Math.round((take * k) / steps);
        state.win = amount - moved;
        state.credit = startCredit + moved;
        winLed.set(state.win);
        creditLed.set(state.credit);
        if (k % 2) Sound.coin();
        await sleep(28);
      }
      state.credit = Math.min(CREDIT_CAP, startCredit + take);
      state.win = amount - take;
      if (state.win > 0) toast('CREDIT 已滿・WIN 未收', 'warn');
      else setMsg(`得分 +${take}`);
      // Only continue auto when WIN fully drained (cap leftovers stop in autoTick).
      if (state.auto && state.win <= 0) queueAuto();
    } finally {
      state.busy = false;
      render();
      save();
    }
  }

  async function gamble(choice) {
    const reason = why.gamble();
    if (reason) { deny(reason); return; }
    state.busy = true;
    clearHighlights();
    render();
    try {
      setMsg(choice === 'small' ? '小…' : '大…');
      const result = 1 + Math.floor(randomFloat() * 9);
      for (let k = 0; k < 16; k++) {
        diceLed.set(String(1 + Math.floor(randomFloat() * 9)));
        $('lblSmall').classList.toggle('on', k % 2 === 0);
        $('lblBig').classList.toggle('on', k % 2 === 1);
        Sound.beep(600 + k * 40, 0.03, 'square', 0.04);
        await sleep(40 + k * 9);
      }
      diceLed.set(String(result));
      const isSmall = result <= 4;
      const isBig = result >= 6;
      $('lblSmall').classList.toggle('on', isSmall);
      $('lblBig').classList.toggle('on', isBig);

      if (result === 5) {
        setMsg('開 5・和', '');
        Sound.beep(660, 0.15, 'triangle', 0.07);
      } else if ((choice === 'small' && isSmall) || (choice === 'big' && isBig)) {
        const before = state.win;
        if (before >= CREDIT_CAP) {
          setMsg(`開 ${result}・中！WIN 已滿`, 'hot');
          Sound.win();
          toast('WIN 已達上限', 'warn');
        } else {
          setMsg(`開 ${result}・中！×2`, 'hot');
          Sound.win();
          await animateWin(before, before * 2);
        }
      } else {
        setMsg(`開 ${result}・錯`, 'bad');
        Sound.lose();
        state.win = 0;
      }
    } finally {
      state.busy = false;
      render();
      save();
    }
  }

  let autoTimer = null;

  function stopAuto(reason, kind = 'bad') {
    clearTimeout(autoTimer);
    autoTimer = null;
    if (!state.auto) return;
    state.auto = false;
    if (reason) {
      setMsg(reason, kind === 'bad' ? 'bad' : '');
      toast(reason, kind);
      if (kind === 'bad') Sound.error();
    }
    render();
  }

  /** Single pending auto timer — prevents stacked ticks from rapid toggles. */
  function queueAuto() {
    if (!state.auto) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { autoTimer = null; if (state.auto) autoTick(); }, 420);
  }

  async function autoTick() {
    if (!state.auto || state.busy) return;
    if (state.win > 0) {
      if (state.credit >= CREDIT_CAP) {
        stopAuto('CREDIT 已達上限・自動已停', 'warn');
        return;
      }
      await collect();
      // Cap may leave residual WIN; collect() queues auto only on full drain.
      if (state.auto && state.win > 0 && state.credit >= CREDIT_CAP) {
        stopAuto('CREDIT 已達上限・自動已停', 'warn');
      }
      return;
    }
    const pattern = lastPattern();
    const need = sum(pattern);
    if (need <= 0) {
      stopAuto('無押注・自動停');
      return;
    }
    const ready = state.betsPaid && sum(state.bets) > 0;
    if (!ready) {
      if (avail() + paidRefund() < need) {
        stopAuto(`需 ${need}・自動停`);
        return;
      }
      if (!applyBetPattern(pattern, { quiet: true })) {
        stopAuto('無法續押・自動停');
        return;
      }
    }
    await start();
  }

  function toggleAuto() {
    if (state.auto) {
      stopAuto('已停自動', 'info');
      return;
    }
    const reason = why.auto();
    if (reason) { deny(reason); render(); return; }
    state.auto = true;
    Sound.seq([880, 1175], 0.06, 'square', 0.05);
    setMsg('自動中…', 'hot');
    render();
    queueAuto();
  }

  /** Apply a bet pattern as paid bets (refunds current paid bets first). */
  function applyBetPattern(pattern, { quiet = false } = {}) {
    if (state.busy) return false;
    collectInstant();
    clearHighlights();
    if (state.betsPaid) state.credit += sum(state.bets);
    state.bets.fill(0);
    state.betsPaid = true;
    const need = sum(pattern);
    if (need <= 0) {
      if (!quiet) deny('沒有上局押注');
      render();
      return false;
    }
    if (state.credit < need) {
      if (!quiet) deny(`需 ${need}`);
      render();
      return false;
    }
    for (let i = 0; i < SYMBOLS.length; i++) {
      const n = Math.min(MAX_BET_PER_SYMBOL, Math.max(0, pattern[i] | 0));
      state.bets[i] = n;
    }
    state.credit -= sum(state.bets);
    state.betsPaid = true;
    if (!quiet) {
      Sound.seq([700, 900, 1100], 0.05, 'triangle', 0.06);
      setMsg(`續押 ${sum(state.bets)}`);
    }
    render();
    save();
    return true;
  }

  function rebet() {
    const reason = why.rebet();
    if (reason) { deny(reason); render(); return; }
    applyBetPattern(lastPattern());
  }

  function doubleBets() {
    const reason = why.dbl();
    if (reason) { deny(reason); render(); return; }
    collectInstant();
    clearHighlights();
    let added = 0;
    // Unpaid (stale preview): double display amounts only; charge on 開始
    if (!state.betsPaid) {
      for (let i = 0; i < SYMBOLS.length; i++) {
        if (state.bets[i] <= 0) continue;
        const room = MAX_BET_PER_SYMBOL - state.bets[i];
        const add = Math.min(state.bets[i], room);
        if (add <= 0) continue;
        state.bets[i] += add;
        added += add;
      }
    } else {
      for (let i = 0; i < SYMBOLS.length; i++) {
        if (state.bets[i] <= 0) continue;
        const room = MAX_BET_PER_SYMBOL - state.bets[i];
        const add = Math.min(state.bets[i], room, state.credit);
        if (add <= 0) continue;
        state.bets[i] += add;
        state.credit -= add;
        added += add;
      }
    }
    if (added > 0) {
      Sound.seq([660, 880, 1100], 0.05, 'square', 0.055);
      setMsg(`加倍・押 ${sum(state.bets)}`);
    } else {
      deny(state.betsPaid && state.credit < 1 ? NO_CREDIT : '押注已達上限');
    }
    render();
    save();
  }

  const OPEN_CREDIT_TAP = 100;
  const OPEN_CREDIT_HOLD = 500;

  function openCredit(amount) {
    const reason = why.open();
    if (reason) { deny(reason); return; }
    const want = Math.max(0, amount | 0);
    if (!want) return;
    const add = Math.min(want, CREDIT_CAP - state.credit);
    state.credit += add;
    Sound.coin();
    setMsg(`開分 +${add}`);
    if (add < want) toast('CREDIT 已達上限', 'warn');
    render();
    save();
  }

  let washAsking = false;
  async function washCredit() {
    const reason = why.wash();
    if (reason) { deny(reason); return; }
    if (washAsking) return;
    stopAuto();
    const total = avail() + paidRefund();
    washAsking = true;
    const ok = await confirmBox('洗分', `CREDIT＋WIN 共 ${total} 將全部歸零，確定？`, '洗分');
    washAsking = false;
    if (!ok) { toast('已取消洗分', 'info'); return; }
    if (why.wash()) { deny(why.wash()); return; } // state changed while asking
    clearHighlights();
    // Transfer WIN → CREDIT, refund unpaid bets if any, then cash-out CREDIT to 0
    if (state.win > 0) {
      state.credit = Math.min(CREDIT_CAP, state.credit + state.win);
      state.win = 0;
    }
    if (state.betsPaid) state.credit = Math.min(CREDIT_CAP, state.credit + sum(state.bets));
    state.bets.fill(0);
    state.betsPaid = true;
    const cashed = state.credit;
    state.credit = 0;
    FX.holdsSet(0);
    stopAuto();
    Sound.seq([520, 400, 300], 0.07, 'triangle', 0.06);
    setMsg(cashed > 0 ? `洗分 ${cashed}` : '已洗分');
    toast(cashed > 0 ? `已洗分 ${cashed}` : '已洗分', 'ok');
    render();
    save();
  }

  function startCreditAmount() {
    return Math.max(100, Math.min(99999, Math.floor(settings.startCredit || START_CREDIT)));
  }

  function resetCredit() {
    const reason = why.reset();
    if (reason) { deny(reason); return; }
    stopAuto();
    const amt = startCreditAmount();
    state.credit = amt;
    state.win = 0;
    state.bets.fill(0);
    state.betsPaid = true;
    state.jp = JP.seed;
    state.bingo = new Array(9).fill(false);
    FX.holdsSet(0);
    renderBingo();
    clearHighlights();
    diceLed.set('-');
    setMsg(`已重設 ${amt}`);
    toast(`已重設 CREDIT ${amt}`, 'ok');
    render();
    save();
  }

  // ---------------------------------------------------------------------------
  // 7. Settings UI
  // ---------------------------------------------------------------------------

  const settingsDlg = settingsDlgEarly || $('settingsDialog');
  const helpDlg = helpDlgEarly || $('helpDialog');
  const modeList = $('modeList');
  const weightList = $('weightList');
  const musicRow = $('musicRow');
  const presetRow = $('presetRow');
  const oddsHint = $('oddsHint');
  const rangeEls = {
    bonusRate: [$('bonusRate'), $('bonusRateVal'), (v) => v.toFixed(1) + '×'],
    onceRate: [$('onceRate'), $('onceRateVal'), (v) => v.toFixed(1) + '×'],
    jpRate: [$('jpRate'), $('jpRateVal'), (v) => v.toFixed(1) + '×'],
    startCredit: [$('startCredit'), $('startCreditVal'), (v) => String(Math.round(v))],
    betUnit: [$('betUnit'), $('betUnitVal'), (v) => String(Math.round(v))],
    sfxVol: [$('sfxVol'), $('sfxVolVal'), (v) => Math.round(v * 100) + '%'],
    bgmVol: [$('bgmVol'), $('bgmVolVal'), (v) => Math.round(v * 100) + '%'],
  };

  MODE_KEYS.forEach((k) => {
    const lab = document.createElement('label');
    const hint = (MODE_HINTS && MODE_HINTS[k]) ? `<small class="mode-hint">${MODE_HINTS[k]}</small>` : '';
    lab.innerHTML = `<input type="checkbox" data-mode="${k}"> <span class="mode-text"><span class="mode-name">${MODE_LABELS[k]}</span>${hint}</span>`;
    modeList.appendChild(lab);
  });

  // --- 防呆: settings validation -------------------------------------------
  // Ranges come from the slider attributes (single source of truth), so values
  // from localStorage / console can never exceed what the UI allows.
  const RANGE_LABELS = {
    bonusRate: '中彩機率', onceRate: '連跑機率', jpRate: 'JP 累積',
    startCredit: '起始 CREDIT', betUnit: '單次押注', sfxVol: '音效', bgmVol: 'BGM',
  };
  const WEIGHT_RANGE = { min: 0, max: 3, step: 0.1 };
  const BONUS_MODES = ['song', 'train', 'sanyuan'];
  const STAGE_MODES = E.STAGE_KEYS || ['luckyWheel', 'gacha', 'sicbo', 'pachinko', 'ballDraw', 'roulette'];
  const DEFAULTS = E.normalizeSettings(null);
  function rangeOf(el, fb) {
    const n = (a, d) => (el && Number.isFinite(parseFloat(el.getAttribute(a))) ? parseFloat(el.getAttribute(a)) : d);
    return { min: n('min', fb.min), max: n('max', fb.max), step: n('step', fb.step) };
  }
  const RANGES = Object.fromEntries(Object.entries(rangeEls).map(([k, [el]]) => [k, rangeOf(el, { min: 0, max: 1, step: 0.01 })]));
  /** Clamp to [min,max] and snap to step. Returns NaN for non-numbers. */
  function snap(v, { min, max, step }) {
    const x = Number(v);
    if (!Number.isFinite(x)) return NaN;
    const c = Math.min(max, Math.max(min, x));
    const k = Math.round((c - min) / step);
    return Math.min(max, +(min + k * step).toFixed(4));
  }
  /** Sum of light-stop weight on paying (non-ONCE MORE) tiles. 0 ⇒ invalid. */
  function fruitWeight(s) {
    return TRACK.reduce((a, t) => {
      if (t.s === 'once') return a;
      const small3 = t.small && t.pay === 3 ? (s.weights.small ?? 1) : 1;
      return a + t.w * (s.weights[t.s] ?? 1) * small3;
    }, 0);
  }
  /**
   * Validate + repair settings. Returns { s, fixed[], errors[], warnings[] }.
   * fixed   – fields clamped/reset to valid range
   * errors  – invalid combos that were repaired
   * warnings– legal but ineffective combos (shown in settings sheet)
   */
  function validateSettings(raw) {
    const s = E.normalizeSettings(raw);
    const fixed = [];
    const errors = [];
    const src = raw && typeof raw === 'object' ? raw : {};
    for (const [k, r] of Object.entries(RANGES)) {
      const v = snap(s[k], r);
      const orig = src[k] !== undefined ? Number(src[k]) : s[k];
      if (!Number.isFinite(v)) { s[k] = DEFAULTS[k]; fixed.push(RANGE_LABELS[k]); continue; }
      if (!Number.isFinite(orig) || Math.abs(v - orig) > 1e-6) fixed.push(RANGE_LABELS[k]);
      s[k] = v;
    }
    const sw = src.weights && typeof src.weights === 'object' ? src.weights : {};
    for (const k of WEIGHT_KEYS) {
      const v = snap(s.weights[k], WEIGHT_RANGE);
      const orig = sw[k] !== undefined ? Number(sw[k]) : s.weights[k];
      if (!Number.isFinite(v)) { s.weights[k] = DEFAULTS.weights[k]; fixed.push(WEIGHT_LABELS[k] || k); continue; }
      if (!Number.isFinite(orig) || Math.abs(v - orig) > 1e-6) fixed.push(WEIGHT_LABELS[k] || k);
      s.weights[k] = v;
    }
    if (fruitWeight(s) <= 0) {
      errors.push('水果權重不可全 0（已還原）');
      s.weights = { ...DEFAULTS.weights };
      s.preset = 'custom';
    }
    return { s, fixed, errors, warnings: settingsWarnings(s) };
  }
  function settingsWarnings(s) {
    const w = [];
    const m = s.modes;
    const usesBonusRate = BONUS_MODES.some((k) => m[k]) || m.slotBonus || m.fever || STAGE_MODES.some((k) => m[k]);
    if (!m.once && (m.onceMulti || m.onceBig)) w.push('ONCE MORE 已關：連跑／大 ONCE MORE 不會觸發');
    if (m.once && s.weights.once <= 0) w.push('ONCE MORE 權重 0：不會停到再跑');
    if (m.once && (m.onceMulti || m.onceBig) && s.onceRate <= 0) w.push('連跑機率 0：只會單次再跑');
    if (usesBonusRate && s.bonusRate <= 0) w.push('中彩機率 0：中彩／三輪／FEVER／額外舞台不會觸發');
    if (!usesBonusRate && s.bonusRate > 0) w.push('中彩／舞台玩法全關：中彩機率無效');
    if (m.jp && s.weights.bar <= 0) w.push('BAR 權重 0：JP 無法觸發');
    if (m.jp && s.jpRate <= 0) w.push('JP 累積 0：彩池不會增加');
    if (m.superRun && s.onceRate <= 0) w.push('連跑機率 0：超跑／連跑／大 ONCE 難觸發');
    if (s.betUnit * SYMBOLS.length > s.startCredit) w.push('單次押注 × 8 超過起始 CREDIT');
    return w;
  }
  const setAlertEl = $('setAlert');
  function updateSettingsAlert(errors = []) {
    if (!setAlertEl) return;
    const warns = settingsWarnings(settings);
    const items = [
      ...errors.map((t) => `<li class="err">${t}</li>`),
      ...warns.map((t) => `<li>${t}</li>`),
    ];
    setAlertEl.hidden = items.length === 0;
    setAlertEl.classList.toggle('has-err', errors.length > 0);
    setAlertEl.innerHTML = items.length ? `<ul>${items.join('')}</ul>` : '';
  }
  /** Grey out controls that have no effect under the current mode toggles. */
  function applySettingsDependencies() {
    const m = settings.modes;
    const dep = {
      onceMulti: !m.once, onceBig: !m.once,
    };
    modeList.querySelectorAll('input[data-mode]').forEach((inp) => {
      const off = !!dep[inp.dataset.mode];
      inp.disabled = off;
      inp.closest('label')?.classList.toggle('dim', off);
    });
    const dim = (key, off) => {
      const el = rangeEls[key]?.[0];
      if (!el) return;
      el.disabled = off;
      el.closest('label')?.classList.toggle('dim', off);
    };
    // onceRate also scales 超跑 — keep the slider live when superRun is on.
    dim('onceRate', !((m.once && (m.onceMulti || m.onceBig)) || m.superRun));
    dim('bonusRate', !(BONUS_MODES.some((k) => m[k]) || m.slotBonus || m.fever || STAGE_MODES.some((k) => m[k])));
    dim('jpRate', !m.jp);
    const wOnce = weightList.querySelector('input[data-weight="once"]');
    if (wOnce) { wOnce.disabled = !m.once; wOnce.closest('label')?.classList.toggle('dim', !m.once); }
  }
  let settingsNotice = null;

  WEIGHT_KEYS.forEach((k) => {
    const lab = document.createElement('label');
    lab.className = 'range-label';
    lab.innerHTML = `${WEIGHT_LABELS[k] || k}
      <input type="range" data-weight="${k}" min="0" max="3" step="0.1" value="1">
      <span data-weight-val="${k}">1.0</span>`;
    weightList.appendChild(lab);
  });

  MUSIC_IDS.forEach((id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.music = id;
    b.textContent = MUSIC_TRACKS[id].name;
    musicRow.appendChild(b);
  });

  function markCustom() { settings.preset = 'custom'; }

  function refreshSettingsUI() {
    presetRow.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('on', c.dataset.preset === settings.preset);
    });
    modeList.querySelectorAll('input[data-mode]').forEach((inp) => {
      inp.checked = !!settings.modes[inp.dataset.mode];
    });
    weightList.querySelectorAll('input[data-weight]').forEach((inp) => {
      const k = inp.dataset.weight;
      const v = settings.weights[k] ?? 1;
      inp.value = String(v);
      const span = weightList.querySelector(`[data-weight-val="${k}"]`);
      if (span) span.textContent = Number(v).toFixed(1);
    });
    for (const [key, [el, valEl, fmt]] of Object.entries(rangeEls)) {
      if (!el) continue;
      el.value = String(settings[key]);
      valEl.textContent = fmt(Number(settings[key]));
    }
    musicRow.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('on', c.dataset.music === Music.track);
    });
    applySettingsDependencies();
    updateSettingsAlert();
    try {
      const sim = E.simulate(settings, 2500, Math.random);
      const pct = (sim.rtp * 100).toFixed(0);
      oddsHint.textContent = `RTP約 ${pct}%・中彩 ${(sim.bonusRate * 100).toFixed(1)}%・JP ${(sim.jpRate * 100).toFixed(2)}%`;
    } catch {
      oddsHint.textContent = '預估 RTP —';
    }
  }

  function openSettings() {
    if (state.busy) { deny(BUSY_MSG); return; }
    if (confirmDlg?.open) { deny('請先關閉視窗'); return; }
    refreshSettingsUI();
    if (typeof settingsDlg.showModal === 'function') settingsDlg.showModal();
    else settingsDlg.setAttribute('open', '');
  }

  const SEEN_HELP_KEY = 'xiaomali.seenHelp.v1';
  function markSeenHelp() {
    try { localStorage.setItem(SEEN_HELP_KEY, '1'); } catch (_) {}
    const tip = $('firstTip');
    if (tip) tip.hidden = true;
  }
  function openHelp() {
    if (state.busy) { deny(BUSY_MSG); return; }
    if (confirmDlg?.open) { deny('請先關閉視窗'); return; }
    markSeenHelp();
    if (typeof helpDlg.showModal === 'function') helpDlg.showModal();
    else helpDlg.setAttribute('open', '');
  }
  helpDlg?.addEventListener('close', markSeenHelp);
  function maybeFirstRunTip() {
    try { if (localStorage.getItem(SEEN_HELP_KEY)) return; } catch (_) { return; }
    const tip = $('firstTip');
    if (!tip) return;
    tip.hidden = false;
    const tipTap = (el, fn) => {
      if (!el) return;
      let armed = false;
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        armed = true;
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
        Sound.unlock();
      });
      el.addEventListener('pointerup', (e) => {
        if (!armed) return;
        armed = false;
        fn();
      });
      el.addEventListener('pointercancel', () => { armed = false; });
      el.addEventListener('click', (e) => { if (e.detail === 0) fn(); });
    };
    tipTap($('firstTipOk'), () => { markSeenHelp(); Sound.bet(); });
    tipTap($('firstTipHelp'), () => { openHelp(); Sound.bet(); markSeenHelp(); });
  }

  presetRow.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-preset]');
    if (!chip) return;
    settings = E.applyPreset(settings, chip.dataset.preset);
    saveSettings();
    refreshSettingsUI();
    Music.applyVolume();
    render();
    Sound.bet();
  });

  modeList.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-mode]');
    if (!inp) return;
    // Reject turning every paying path off at once is fine (base fruit still pays);
    // dependent toggles are greyed in applySettingsDependencies().
    settings.modes[inp.dataset.mode] = inp.checked;
    markCustom();
    saveSettings();
    refreshSettingsUI();
    render();
  });

  /** Validate one weight edit; reverts the slider and returns false if invalid. */
  function tryWeight(inp) {
    const k = inp.dataset.weight;
    const v = snap(inp.value, WEIGHT_RANGE);
    const span = weightList.querySelector(`[data-weight-val="${k}"]`);
    const prev = settings.weights[k];
    if (!Number.isFinite(v)) {
      inp.value = String(prev);
      deny(`${WEIGHT_LABELS[k] || k}：數值無效`, { vfd: false });
      return false;
    }
    const cand = { ...settings, weights: { ...settings.weights, [k]: v } };
    if (fruitWeight(cand) <= 0) {
      inp.value = String(prev);
      if (span) span.textContent = Number(prev).toFixed(1);
      deny('水果權重不可全 0', { vfd: false });
      updateSettingsAlert(['至少保留一種水果權重 > 0']);
      return false;
    }
    settings.weights[k] = v;
    inp.value = String(v);
    markCustom();
    if (span) span.textContent = v.toFixed(1);
    return true;
  }
  weightList.addEventListener('input', (e) => {
    const inp = e.target.closest('input[data-weight]');
    if (inp) tryWeight(inp);
  });
  weightList.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-weight]');
    if (!inp) return;
    if (tryWeight(inp)) {
      saveSettings();
      refreshSettingsUI();
    }
  });

  for (const [key, [el, valEl, fmt]] of Object.entries(rangeEls)) {
    if (!el) continue;
    const accept = () => {
      const v = snap(el.value, RANGES[key]);
      if (!Number.isFinite(v)) {
        el.value = String(settings[key]);
        deny(`${RANGE_LABELS[key]}：數值無效`, { vfd: false });
        return false;
      }
      settings[key] = v;
      if (String(v) !== el.value) el.value = String(v);
      valEl.textContent = fmt(v);
      return true;
    };
    el.addEventListener('input', () => {
      if (!accept()) return;
      if (key === 'bonusRate' || key === 'onceRate' || key === 'jpRate') markCustom();
      if (key === 'sfxVol' || key === 'bgmVol') Music.applyVolume();
    });
    el.addEventListener('change', () => {
      if (!accept()) return;
      if (key === 'bonusRate' || key === 'onceRate' || key === 'jpRate') markCustom();
      saveSettings();
      refreshSettingsUI();
      Music.applyVolume();
    });
  }

  musicRow.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-music]');
    if (!chip) return;
    Sound.unlock();
    Music.setTrack(chip.dataset.music);
    saveSettings();
    refreshSettingsUI();
    if (Sound.on && Music.track !== 'off') Sound.bet();
  });

  settingsDlg.addEventListener('close', () => {
    const v = settingsDlg.returnValue;
    // final gate: never persist an invalid combo
    const chk = validateSettings({ ...settings });
    settings = chk.s;
    if (chk.errors.length) toast(chk.errors[0], 'bad');
    if (v === 'reset') {
      setTimeout(async () => {
        const reason = why.reset();
        if (reason) { deny(reason); return; }
        const amt = startCreditAmount();
        const lost = avail() + paidRefund();
        const ok = await confirmBox('重設分數',
          `CREDIT 改為 ${amt}，WIN／押注／JP 歸零${lost ? `（目前 ${lost}）` : ''}。確定？`, '重設');
        if (ok) resetCredit(); else toast('已取消重設', 'info');
      }, 0);
    }
    if (v === 'help') {
      // reopen help after settings closes
      setTimeout(openHelp, 0);
    }
    saveSettings();
    render();
  });

  // ---------------------------------------------------------------------------
  // 8. Input
  // ---------------------------------------------------------------------------

  const unlock = () => Sound.unlock();
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);

  // 防呆: per-action cooldown swallows double-taps / ghost clicks / key+click
  // duplicates (e.g. Space on a focused 開始 button fires both).
  const lastTap = new Map();
  function guarded(key, fn, cooldown = 280) {
    return (...args) => {
      const now = performance.now();
      if (now - (lastTap.get(key) || 0) < cooldown) return;
      lastTap.set(key, now);
      return fn(...args);
    };
  }

  /**
   * Reliable deck control binding for iOS Safari:
   * - pointerdown: pressed + setPointerCapture (hitbox stays with finger)
   * - pointerup: fire action (preventDefault suppresses synthetic click)
   * - pointercancel / lost capture: cancel, do NOT fire
   * - click detail===0: keyboard / accessibility activation
   * Greyed (.off) controls still fire so why.* can toast the reason.
   */
  function bindTap(el, action, { key = null, cooldown = 280 } = {}) {
    if (!el) return;
    const run = key ? guarded(key, action, cooldown) : guarded(`tap:${el.id || Math.random()}`, action, cooldown);
    let armed = false;
    let pointerId = null;
    const disarm = () => {
      armed = false;
      pointerId = null;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      // Ignore secondary pointers while one is armed (multi-touch ghost).
      if (armed) return;
      armed = true;
      pointerId = e.pointerId;
      el.classList.add('pressed');
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* older WebKit */ }
      // Kill 300ms ghost click / double-fire with the pointerup path.
      e.preventDefault();
      Sound.unlock();
    });
    el.addEventListener('pointerup', (e) => {
      if (!armed || (pointerId != null && e.pointerId !== pointerId)) return;
      disarm();
      run();
    });
    el.addEventListener('pointercancel', (e) => {
      if (pointerId != null && e.pointerId !== pointerId) return;
      disarm(); // OS cancel — do not fire
    });
    // Do not listen for lostpointercapture: on some WebKit builds it fires
    // before pointerup when capture is released and would swallow the tap.
    el.addEventListener('click', (e) => {
      // Keyboard / VoiceOver synthesize click with detail === 0.
      if (e.detail === 0) run();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const A = {
    start: guarded('start', () => { if (state.auto && !state.busy) stopAuto(); start(); }, 450),
    clear: guarded('clear', () => { stopAuto(); clearBets(); }),
    all: guarded('all', () => { stopAuto(); betAll(); }),
    collect: guarded('collect', () => collect(), 400),
    small: guarded('gamble', () => { stopAuto(); gamble('small'); }, 400),
    big: guarded('gamble', () => { stopAuto(); gamble('big'); }, 400),
    rebet: guarded('rebet', () => { stopAuto(); rebet(); }),
    dbl: guarded('dbl', () => { stopAuto(); doubleBets(); }),
    auto: guarded('auto', () => toggleAuto(), 400),
    wash: guarded('wash', () => washCredit(), 400),
    open: guarded('open', () => { stopAuto(); openCredit(OPEN_CREDIT_TAP); }, 120),
  };

  bindTap(btn.start, A.start);
  bindTap(btn.clear, A.clear);
  bindTap(btn.all, A.all);
  bindTap(btn.collect, A.collect);
  bindTap(btn.small, A.small);
  bindTap(btn.big, A.big);
  bindTap(btn.rebet, A.rebet);
  bindTap(btn.dbl, A.dbl);
  bindTap(btn.auto, A.auto);
  bindTap(btn.wash, A.wash);
  bindTap(btn.sound, () => {
    Sound.on = !Sound.on;
    Sound.unlock().then(() => {
      Music.update();
      if (Sound.on) Sound.bet();
    });
    render();
    save();
  }, { key: 'sound', cooldown: 220 });
  bindTap(btn.settings, () => openSettings(), { key: 'settings', cooldown: 300 });

  // Fruit bet keys: tap + hold-to-repeat (capture keeps repeat alive if finger slides)
  betKeys.forEach((k, i) => {
    let holdTimer = null;
    let repeatTimer = null;
    let pointerId = null;
    const stop = () => {
      clearTimeout(holdTimer);
      clearInterval(repeatTimer);
      holdTimer = repeatTimer = null;
      pointerId = null;
      k.el.classList.remove('pressed');
    };
    k.el.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (pointerId != null) return;
      e.preventDefault();
      Sound.unlock();
      pointerId = e.pointerId;
      k.el.classList.add('pressed');
      try { k.el.setPointerCapture(e.pointerId); } catch (_) { /* */ }
      if (!bet(i)) return stop();
      holdTimer = setTimeout(() => {
        repeatTimer = setInterval(() => { if (!bet(i)) stop(); }, 90);
      }, 380);
    });
    k.el.addEventListener('pointerup', (e) => {
      if (pointerId != null && e.pointerId !== pointerId) return;
      stop();
    });
    k.el.addEventListener('pointercancel', (e) => {
      if (pointerId != null && e.pointerId !== pointerId) return;
      stop();
    });
    // no lostpointercapture (WebKit may fire it before pointerup)
    // no pointerleave — pressed animation used to shift hitbox and cancel holds
    k.el.addEventListener('contextmenu', (e) => e.preventDefault());
    k.el.addEventListener('click', (e) => { if (e.detail === 0) { stopAuto(); bet(i); } });
  });

  // 開分: tap +100, hold +500. Commit only on pointerup (leave/cancel = abort).
  (() => {
    let holdTimer = null;
    let held = false;
    let armed = false;
    let pointerId = null;
    const clearHold = () => { clearTimeout(holdTimer); holdTimer = null; };
    const disarm = () => {
      clearHold();
      armed = false;
      pointerId = null;
      held = false;
      btn.open.classList.remove('pressed');
    };
    btn.open.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (armed) return;
      e.preventDefault();
      Sound.unlock();
      armed = true;
      held = false;
      pointerId = e.pointerId;
      btn.open.classList.add('pressed');
      try { btn.open.setPointerCapture(e.pointerId); } catch (_) { /* */ }
      const reason = why.open();
      if (reason) { deny(reason); disarm(); return; }
      stopAuto();
      holdTimer = setTimeout(() => {
        held = true;
        openCredit(OPEN_CREDIT_HOLD);
      }, 420);
    });
    btn.open.addEventListener('pointerup', (e) => {
      if (!armed || (pointerId != null && e.pointerId !== pointerId)) return;
      const wasHeld = held;
      const hadTimer = !!holdTimer;
      disarm();
      // Short tap: fire +100. Hold already credited +500 inside the timer.
      if (hadTimer && !wasHeld) openCredit(OPEN_CREDIT_TAP);
    });
    btn.open.addEventListener('pointercancel', (e) => {
      if (pointerId != null && e.pointerId !== pointerId) return;
      disarm(); // cancel — do not credit
    });
    btn.open.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.open.addEventListener('click', (e) => { if (e.detail === 0) A.open(); });
  })();

  window.addEventListener('keydown', (e) => {
    if (settingsDlg.open || helpDlg.open || confirmDlg?.open || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k >= '1' && k <= '8') { stopAuto(); bet(Number(k) - 1); e.preventDefault(); return; }
    // Focused <button> handles its own Space/Enter → avoid firing twice.
    if ((k === ' ' || k === 'Enter') && e.target instanceof HTMLButtonElement) return;
    if (e.repeat) { e.preventDefault(); return; } // held key ≠ repeated start/collect
    switch (k.toLowerCase()) {
      case ' ': case 'enter': A.start(); break;
      case 'a': A.all(); break;
      case 'c': case 'backspace': A.clear(); break;
      case 's': A.collect(); break;
      case 'arrowleft': case 'q': A.small(); break;
      case 'arrowright': case 'e': A.big(); break;
      case 'd': A.dbl(); break;
      case 'r': A.rebet(); break;
      case 't': A.auto(); break;
      case 'o': A.open(); break;
      case 'w': A.wash(); break;
      default: return;
    }
    e.preventDefault();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      save();
      Music.update();
    } else {
      // Tab/app resume often leaves AudioContext suspended — re-unlock then BGM.
      Sound.unlock();
    }
  });
  window.addEventListener('pagehide', save);
  // Fit the cabinet exactly into the safe viewport (iPhone 16 Pro Max first).
  // Resolves --pad-* / --safe-* via a probe (getPropertyValue returns unevaluated
  // max()/env() strings). Measures natural height @ Wmax, applies fit-* density,
  // then shrinks --W until the machine clears pad-t / pad-b with no clip/scroll.
  function readCssPx(prop) {
    const el = document.createElement('div');
    el.setAttribute('data-fit-probe', '1');
    el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;'
      + 'height:var(' + prop + ');width:0;margin:0;padding:0;border:0;';
    document.documentElement.appendChild(el);
    const h = el.getBoundingClientRect().height;
    el.remove();
    return h || 0;
  }
  function fitCabinet() {
    const root = document.documentElement;
    const cab = cabinetEl || $('cabinet');
    if (!cab) return;
    const padT = readCssPx('--pad-t');
    const padB = readCssPx('--pad-b');
    const safeL = readCssPx('--safe-l');
    const safeR = readCssPx('--safe-r');
    const gutter = readCssPx('--gutter') || 4;
    const vv = window.visualViewport;
    const vh = (vv && vv.height) ? vv.height : (window.innerHeight || root.clientHeight);
    const vw = (vv && vv.width) ? vv.width : (window.innerWidth || root.clientWidth);
    const Wmax = Math.min(vw - 2 * gutter - safeL - safeR, 480);
    const Hav = Math.max(240, vh - padT - padB);

    // Reset density so we measure the "full" layout first.
    root.classList.remove('fit-1', 'fit-2');
    root.style.setProperty('--Wmax', Wmax + 'px');
    root.style.setProperty('--Hav', Hav + 'px');
    root.style.setProperty('--fit-ratio', '1.0'); // force width = Wmax for measure
    root.style.setProperty('--W', Wmax + 'px');

    // Force layout, then decide density based on overflow vs safe content box.
    void cab.offsetHeight;
    let h = cab.getBoundingClientRect().height;
    let level = 0;
    if (h > Hav * 1.005) { root.classList.add('fit-1'); level = 1; void cab.offsetHeight; h = cab.getBoundingClientRect().height; }
    if (h > Hav * 1.005) { root.classList.add('fit-2'); level = 2; void cab.offsetHeight; h = cab.getBoundingClientRect().height; }

    const ratio = Math.max(1.25, (h / Math.max(1, Wmax)) * 1.01);
    // Keep width high enough that 8 bet keys can stay ≥44px after deck/cabinet pads
    // (≈ W/100 * ~12.3 chrome + 8*44). Floor softens on extremely short viewports.
    const Wtouch = Math.min(Wmax, 402);
    let W = Math.max(280, Math.min(Wmax, Hav / ratio));
    if (W < Wtouch && Hav >= 680) W = Math.min(Wmax, Wtouch);
    root.style.setProperty('--fit-ratio', ratio.toFixed(4));
    root.style.setProperty('--W', W + 'px');
    root.dataset.fit = String(level);

    // Iterative nudge for residual overflow (bingo topper / subpixel / density).
    for (let i = 0; i < 4; i++) {
      void cab.offsetHeight;
      h = cab.getBoundingClientRect().height;
      if (h <= Hav + 0.5) break;
      const floor = (Hav >= 680) ? 360 : 250;
      W = Math.max(floor, W * (Hav / h) * 0.992);
      root.style.setProperty('--W', W + 'px');
    }
  }
  let _fitRaf = 0;
  function scheduleFit() {
    cancelAnimationFrame(_fitRaf);
    _fitRaf = requestAnimationFrame(() => {
      fitCabinet();
      // Never reset reels mid-round — resize/orientation used to call idleReels
      // and wipe spinning/landed state while spinReels was still animating.
      if (!state.busy) idleReels();
    });
  }
  window.addEventListener('resize', scheduleFit);
  window.addEventListener('orientationchange', scheduleFit);
  if (window.visualViewport) {
    // resize only — scroll fires constantly with iOS chrome and shifts hitboxes mid-tap
    visualViewport.addEventListener('resize', scheduleFit);
  }

  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---------------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------------
  loadSettings();
  load();
  if (Number.isFinite(state._pendingHold)) {
    FX.holdsSet(state._pendingHold);
    delete state._pendingHold;
  }
  diceLed.set('-');
  setLight(state.pos);
  if (!state.betsPaid && sum(state.bets) > 0) setMsg('按開始續玩');
  render();
  fitCabinet();
  requestAnimationFrame(() => { fitCabinet(); idleReels(); });
  if (settingsNotice) setTimeout(() => toast(settingsNotice, 'warn', 3200), 400);
  setTimeout(maybeFirstRunTip, 500);

  window.__xiaomali = {
    state, settings, TRACK, SYMBOLS, pickTarget, resetCredit, Music, Sound, E, fitCabinet,
    setSettings(s) {
      const v = validateSettings(s);
      settings = v.s;
      saveSettings();
      render();
      return { fixed: v.fixed, errors: v.errors, warnings: v.warnings };
    },
    validateSettings, toast,
  };
})();
