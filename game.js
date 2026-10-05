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
    MODE_KEYS, MODE_LABELS, PRESETS, WEIGHT_KEYS, WEIGHT_LABELS,
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
    tick()  { this.beep(1320, 0.025, 'square', 0.03); },
    bet()   { this.beep(880, 0.04, 'triangle', 0.08); },
    error() { this.seq([220, 165], 0.12, 'sawtooth', 0.04); },
    win()   { this.seq([523, 659, 784, 1047, 784, 1047], 0.08, 'square', 0.05); },
    big()   { this.seq([523, 659, 784, 1047, 1319, 1568, 1319, 1568, 2093], 0.07, 'square', 0.05); },
    lose()  { this.seq([392, 330, 262], 0.14, 'triangle', 0.06); },
    once()  { this.seq([784, 988, 1175, 1568, 0, 1568], 0.07, 'square', 0.05); },
    coin()  { this.beep(1568, 0.03, 'square', 0.03); },
    lucky() { this.seq([659, 784, 988, 1319, 988, 1319, 1568, 1976], 0.06, 'square', 0.05); },
    jp()    { this.seq([523, 784, 1047, 1568, 2093, 1568, 2093, 2637], 0.08, 'square', 0.055); },
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
  };

  let settings = E.normalizeSettings(null);

  function loadSettings() {
    try {
      const d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      settings = E.normalizeSettings(d);
      if (d && MUSIC_TRACKS[d.music]) Music.track = d.music;
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
        state.credit = Math.max(0, Math.floor(d.credit));
        state.win = Math.max(0, Math.floor(d.win || 0));
        state.pos = (d.pos | 0) % N;
        Sound.on = d.sound !== false;
        if (Number.isFinite(d.jp) && d.jp >= 0) state.jp = Math.min(JP.max, d.jp);
        if (Array.isArray(d.lastBets) && d.lastBets.length === SYMBOLS.length) {
          state.bets = d.lastBets.map((n) => Math.min(MAX_BET_PER_SYMBOL, Math.max(0, n | 0)));
          state.betsPaid = false;
        }
        if (Array.isArray(d.lastPlayedBets) && d.lastPlayedBets.length === SYMBOLS.length) {
          state.lastPlayedBets = d.lastPlayedBets.map((n) => Math.min(MAX_BET_PER_SYMBOL, Math.max(0, n | 0)));
        } else if (sum(state.bets) > 0) {
          state.lastPlayedBets = state.bets.slice();
        }
      }
    } catch { /* ignore */ }
  }

  function save() {
    try {
      const refund = state.betsPaid && !state.busy ? sum(state.bets) : 0;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        credit: state.credit + refund,
        win: state.win,
        pos: state.pos,
        sound: Sound.on,
        lastBets: state.bets,
        lastPlayedBets: state.lastPlayedBets,
        jp: state.jp,
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
      cabinetEl.classList.remove('fx-spin', 'fx-win', 'fx-reach', 'fx-expect', 'fx-fever');
    },
    set(...modes) {
      this.clear();
      for (const m of modes) cabinetEl?.classList.add('fx-' + m);
    },
    spin() { this.set('spin'); this.holdsSpin(); },
    expect() { this.set('expect', 'reach'); },
    reach() { this.set('reach'); },
    win() { this.set('win'); this.holdsFlash(true); },
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
      // light 1–3 lamps randomly during a spin (假保留)
      const n = 1 + Math.floor(randomFloat() * 3);
      this.holdsSet(n);
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
      feverTimer = setTimeout(() => this.hideFever(), ms);
    },
  };
  buildRails();
  FX.holdsSet(0);

  /** Glossy CSS/SVG fruit icons (no flat emoji). Unique gradient ids per instance. */
  let _icUid = 0;
  function iconHTML(symId) {
    if (symId === 'once') return '<span class="ic-once">ONCE<br>MORE</span>';
    if (symId === 'seven') return '<span class="ic-77">77</span>';
    if (symId === 'bar') return '<span class="ic-bar"><i>BAR</i><i>BAR</i><i>BAR</i></span>';
    const u = 'i' + (++_icUid);
    const SVGS = {
      apple: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${u}a" cx="35%" cy="30%"><stop offset="0%" stop-color="#ff8a8a"/><stop offset="45%" stop-color="#e01818"/><stop offset="100%" stop-color="#7a0000"/></radialGradient></defs><ellipse cx="32" cy="36" rx="20" ry="22" fill="url(#${u}a)" stroke="#4a0000" stroke-width="1.5"/><path d="M32 14c0 0 2-8 10-10" stroke="#3a6a18" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="38" cy="8" rx="7" ry="3.5" fill="#4caf30" stroke="#2a6a18" stroke-width="1" transform="rotate(25 38 8)"/><ellipse cx="24" cy="26" rx="7" ry="4" fill="#fff" opacity=".45" transform="rotate(-30 24 26)"/></svg>`,
      orange: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${u}o" cx="32%" cy="28%"><stop offset="0%" stop-color="#ffe0a0"/><stop offset="40%" stop-color="#ff9a1a"/><stop offset="100%" stop-color="#c45a00"/></radialGradient></defs><circle cx="32" cy="34" r="22" fill="url(#${u}o)" stroke="#8a3a00" stroke-width="1.5"/><circle cx="32" cy="34" r="22" fill="none" stroke="#ffcc66" stroke-width="0.6" stroke-dasharray="2 3" opacity=".45"/><path d="M32 12v6M28 14h8" stroke="#2a6a18" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="24" cy="26" rx="8" ry="4.5" fill="#fff" opacity=".45" transform="rotate(-35 24 26)"/></svg>`,
      mango: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${u}m" cx="35%" cy="30%"><stop offset="0%" stop-color="#ffe9a0"/><stop offset="40%" stop-color="#ffc020"/><stop offset="100%" stop-color="#d07800"/></radialGradient></defs><path d="M22 48c-8-10-6-26 6-34 10-7 22-4 26 8 4 12-2 28-14 34-8 4-14 2-18-8z" fill="url(#${u}m)" stroke="#8a5000" stroke-width="1.5"/><path d="M40 14c4-6 10-8 14-6" stroke="#3a7a20" stroke-width="2.5" fill="none" stroke-linecap="round"/><ellipse cx="30" cy="28" rx="7" ry="3.5" fill="#fff" opacity=".4" transform="rotate(-40 30 28)"/></svg>`,
      bell: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${u}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffe566"/><stop offset="45%" stop-color="#f0c000"/><stop offset="100%" stop-color="#a87800"/></linearGradient></defs><path d="M32 8c-2 0-4 2-4 5v2c-10 3-16 12-16 24h40c0-12-6-21-16-24v-2c0-3-2-5-4-5z" fill="url(#${u}b)" stroke="#6a4a00" stroke-width="1.4"/><ellipse cx="32" cy="40" rx="22" ry="5" fill="#c9a000" stroke="#6a4a00" stroke-width="1"/><circle cx="32" cy="48" r="4" fill="#8a6000" stroke="#4a3000" stroke-width="1"/><ellipse cx="24" cy="22" rx="6" ry="3" fill="#fff" opacity=".5" transform="rotate(-25 24 22)"/></svg>`,
      melon: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${u}w" cx="40%" cy="35%"><stop offset="0%" stop-color="#ff8a9a"/><stop offset="55%" stop-color="#e01840"/><stop offset="100%" stop-color="#7a0020"/></radialGradient></defs><path d="M10 40c0-16 12-28 28-28 4 0 8 1 12 3-2 18-14 32-30 36-6-2-10-6-10-11z" fill="url(#${u}w)" stroke="#5a0018" stroke-width="1.4"/><path d="M50 15c6 4 10 12 10 22 0 8-4 14-10 18" fill="#3cb84a" stroke="#1a6a20" stroke-width="1.3"/><path d="M50 15c-1 8-1 18 0 28" fill="none" stroke="#2a8a30" stroke-width="2"/><circle cx="22" cy="30" r="1.6" fill="#3a1800"/><circle cx="30" cy="38" r="1.4" fill="#3a1800"/><circle cx="26" cy="46" r="1.3" fill="#3a1800"/><circle cx="34" cy="28" r="1.2" fill="#3a1800"/><ellipse cx="22" cy="24" rx="6" ry="3" fill="#fff" opacity=".35" transform="rotate(-30 22 24)"/></svg>`,
      star: `<svg class="ic-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${u}s" cx="40%" cy="30%"><stop offset="0%" stop-color="#fff6a8"/><stop offset="40%" stop-color="#ffd200"/><stop offset="100%" stop-color="#c48800"/></radialGradient></defs><path d="M32 6l6.5 18.5H58l-15 11.5 5.5 19L32 43l-16.5 12 5.5-19L6 24.5h19.5z" fill="url(#${u}s)" stroke="#8a5a00" stroke-width="1.5" stroke-linejoin="round"/><path d="M32 14l3.5 10H46" fill="none" stroke="#fff" stroke-width="2" opacity=".45" stroke-linecap="round"/></svg>`,
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
    '<tr><td>★</td><td>送燈／火車／三元</td><td>中彩</td></tr>';

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

  const onceBanner = $('onceBanner');
  const onceBannerTag = $('onceBannerTag');
  const onceBannerCount = $('onceBannerCount');
  const ONCE_VARIANT_LABEL = { single: 'ONCE MORE', multi: '連跑', big: '大 ONCE MORE' };

  function showOnceBanner(variant, remaining) {
    if (!onceBanner) return;
    onceBannerTag.textContent = ONCE_VARIANT_LABEL[variant] || 'ONCE MORE';
    onceBannerCount.textContent = remaining > 0 ? `再跑 ${remaining} 次` : '結束';
    onceBanner.hidden = remaining <= 0;
    onceBanner.classList.toggle('pulse', remaining > 0);
  }
  function hideOnceBanner() {
    if (!onceBanner) return;
    onceBanner.hidden = true;
    onceBanner.classList.remove('pulse');
  }

  function setLight(pos, trail = 0) {
    for (const el of tileEls) el.classList.remove('lit', 'trail1', 'trail2');
    tileEls[pos].classList.add('lit');
    if (trail >= 1) tileEls[(pos - 1 + N) % N].classList.add('trail1');
    if (trail >= 2) tileEls[(pos - 2 + N) % N].classList.add('trail2');
  }

  function render() {
    const jpRow = $('jpRow');
    if (jpRow) {
      jpRow.hidden = !settings.modes.jp;
      $('jpVal').textContent = String(Math.floor(state.jp));
    }
    winLed.set(state.win);
    creditLed.set(state.credit);
    betKeys.forEach((k, i) => {
      k.led.set(state.bets[i] || 0, { pad: ' ' });
      k.cell.classList.toggle('stale', !state.betsPaid && state.bets[i] > 0);
    });
    const idle = !state.busy;
    const hasWin = state.win > 0;
    const hasBets = sum(state.bets) > 0;
    const hasLast = sum(state.lastPlayedBets) > 0 || hasBets;
    btn.start.disabled = !idle;
    btn.clear.disabled = !idle;
    btn.all.disabled = !idle;
    btn.collect.disabled = !idle || !hasWin;
    btn.small.disabled = !idle || !hasWin;
    btn.big.disabled = !idle || !hasWin;
    btn.open.disabled = !idle;
    btn.wash.disabled = !idle;
    btn.dbl.disabled = !idle || !hasBets;
    btn.rebet.disabled = !idle || !hasLast;
    btn.auto.disabled = false; // can always toggle off
    betKeys.forEach((k) => (k.el.disabled = !idle || state.auto));
    btn.collect.classList.toggle('flash', idle && hasWin && !state.auto);
    btn.start.classList.toggle('flash', idle && !hasWin && hasBets && !state.auto);
    btn.auto.classList.toggle('on', state.auto);
    btn.auto.classList.toggle('flash', state.auto);
    btn.auto.textContent = state.auto ? '自動中' : '自動';
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
    state.credit += state.win;
    state.win = 0;
    Sound.coin();
    clearHighlights();
  }

  function freshBets() {
    if (!state.betsPaid) {
      state.bets.fill(0);
      state.betsPaid = true;
    }
  }

  function betUnit() {
    return Math.max(1, Math.min(10, Math.floor(settings.betUnit || 1)));
  }

  function bet(i) {
    if (state.busy) return false;
    if (state.auto) stopAuto();
    collectInstant();
    clearHighlights();
    freshBets();
    const unit = betUnit();
    if (state.bets[i] >= MAX_BET_PER_SYMBOL) {
      setMsg(`${SYMBOLS[i].name} 上限 ${MAX_BET_PER_SYMBOL}`, 'bad');
      render();
      return false;
    }
    const room = MAX_BET_PER_SYMBOL - state.bets[i];
    const add = Math.min(unit, room, state.credit);
    if (add < 1) {
      setMsg('分數不足・⚙️ 可重設', 'bad');
      Sound.error();
      render();
      return false;
    }
    state.bets[i] += add;
    state.credit -= add;
    Sound.bet();
    setMsg(`已押 ${sum(state.bets)}・按開始`);
    render();
    save();
    return true;
  }

  function betAll() {
    if (state.busy) return;
    collectInstant();
    clearHighlights();
    freshBets();
    const unit = betUnit();
    let added = 0;
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
    if (added) { Sound.seq([784, 988, 1175], 0.05, 'triangle', 0.07); setMsg(`全押 ${sum(state.bets)}`); }
    else { Sound.error(); setMsg('無法加注', 'bad'); }
    render();
    save();
  }

  function clearBets() {
    if (state.busy) return;
    clearHighlights();
    if (state.betsPaid) state.credit += sum(state.bets);
    state.bets.fill(0);
    state.betsPaid = true;
    Sound.beep(440, 0.08, 'triangle', 0.07);
    setMsg('已清除');
    render();
    save();
  }

  async function runLight(target, { expect = false } = {}) {
    const dist = (target - state.pos + N) % N;
    const laps = 2 + (randomFloat() < 0.5 ? 1 : 0);
    const total = laps * N + dist;
    const FAST = 28;
    const DECEL = 15;
    let expectOn = false;
    for (let s = 1; s <= total; s++) {
      state.pos = (state.pos + 1) % N;
      const remaining = total - s;
      let delay;
      if (s <= 6) delay = FAST + (7 - s) * 16;
      else if (remaining >= DECEL) delay = FAST;
      else delay = FAST + Math.pow(DECEL - remaining, 2) * 2;
      // Red high-expectation flash during late decelerate when stop will pay
      if (expect && remaining < DECEL && !expectOn) {
        FX.expect();
        expectOn = true;
      } else if (!expect && remaining < 6 && remaining >= 0 && !expectOn) {
        FX.reach();
        expectOn = true;
      }
      setLight(state.pos, delay < 60 ? 2 : delay < 120 ? 1 : 0);
      Sound.tick();
      await sleep(delay);
    }
    setLight(state.pos, 0);
  }

  /** Estimate light-run duration so reels can finish roughly together. */
  function estimateLightMs(target) {
    const dist = (target - state.pos + N) % N;
    const laps = 2;
    const total = laps * N + dist;
    const FAST = 28;
    const DECEL = 15;
    let ms = 0;
    for (let s = 1; s <= total; s++) {
      const remaining = total - s;
      if (s <= 6) ms += FAST + (7 - s) * 16;
      else if (remaining >= DECEL) ms += FAST;
      else ms += FAST + Math.pow(DECEL - remaining, 2) * 2;
    }
    return ms;
  }

  async function animateWin(from, to) {
    const steps = Math.min(30, Math.max(1, to - from));
    for (let k = 1; k <= steps; k++) {
      state.win = Math.round(from + ((to - from) * k) / steps);
      winLed.set(state.win);
      if (k % 2) Sound.coin();
      await sleep(25);
    }
    state.win = to;
  }

  async function start() {
    if (state.busy) return;
    Sound.unlock();
    if (state.win > 0) collectInstant();
    clearHighlights();
    const total = sum(state.bets);
    if (total === 0) {
      setMsg('請先押注', 'bad');
      Sound.error();
      render();
      return;
    }
    if (!state.betsPaid) {
      if (state.credit < total) {
        setMsg(`分數不足（需 ${total}）`, 'bad');
        Sound.error();
        render();
        return;
      }
      state.credit -= total;
      state.betsPaid = true;
    }
    state.lastPlayedBets = state.bets.slice();
    state.busy = true;
    FX.spin();
    render();
    save();

    const potBefore = settings.modes.jp ? state.jp : 0;
    const result = E.resolveRound(state.bets, settings, randomFloat, potBefore);
    let roundWin = 0;
    let inOnceRun = false;
    let onceVariant = 'single';

    for (const step of result.steps) {
      if (step.type === 'once') {
        const label = ONCE_VARIANT_LABEL[step.variant] || 'ONCE MORE';
        showOnceBanner(step.variant, step.remaining);
        setMsg(step.remaining > 0 ? `${label}…` : `${label}・上限`, 'hot');
        const dur = estimateLightMs(step.target);
        FX.spin();
        await Promise.all([runLight(step.target, { expect: false }), spinReels('once', Math.max(900, dur - 400))]);
        tileEls[step.target].classList.add('win');
        FX.win();
        Sound.once();
        if (step.remaining <= 0) {
          setMsg(step.capped ? '再跑已達上限' : `${label}`, 'hot');
          await sleep(700);
          tileEls[step.target].classList.remove('win');
          hideOnceBanner();
          break;
        }
        setMsg(`${label}！再跑 ${step.remaining} 次`, 'hot');
        await sleep(850);
        tileEls[step.target].classList.remove('win');
        onceVariant = step.variant || 'single';
        inOnceRun = true;
        continue;
      }

      if (step.type === 'land') {
        setMsg(inOnceRun ? '連跑中…' : '轉動中…', inOnceRun ? 'hot' : '');
        if (inOnceRun) showOnceBanner(onceVariant, step.runsLeft + 1);
        const dur = estimateLightMs(step.target);
        const landId = TRACK[step.target].s;
        const willPay = step.gained > 0;
        FX.spin();
        await Promise.all([runLight(step.target, { expect: willPay }), spinReels(landId, Math.max(900, dur - 400))]);
        const sym = step.si >= 0 ? SYMBOLS[step.si] : null;
        if (step.gained > 0 && sym) {
          roundWin += step.gained;
          tileEls[step.target].classList.add('win');
          setKeyHit(betKeys[step.si], true);
          FX.win();
          if (step.mult >= 40) {
            Sound.big();
            FX.flashFever('fever', 1400);
          } else {
            Sound.win();
            if (step.mult >= 20) FX.flashFever('ready', 900);
          }
          const small = TRACK[step.target].small ? '小' : '';
          setMsg(`${sym.name}${small} ${state.bets[step.si]}×${step.mult}=${step.gained}`, 'hot');
          await animateWin(state.win, state.win + step.gained);
        } else if (sym) {
          setMsg(`${sym.name}${TRACK[step.target].small ? '小' : ''}・沒中`, 'bad');
          Sound.lose();
          FX.idle();
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

      if (step.type === 'bonus') {
        Sound.lucky();
        FX.win();
        FX.flashFever('ready', 1000);
        setMsg(`中彩・${step.name}`, 'hot');
        for (const bt of step.tiles) {
          tileEls[bt.i].classList.add('win', 'lit2');
          if (bt.si >= 0 && bt.gained > 0) setKeyHit(betKeys[bt.si], true);
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
        Sound.jp();
        $('jpRow')?.classList.add('jp-hit');
        FX.win();
        FX.flashFever('fever', 2000);
        FX.holdsSet(4);
        setMsg(`JP！+${step.amount}`, 'hot');
        roundWin += step.amount;
        await animateWin(state.win, state.win + step.amount);
        await sleep(600);
      }
    }
    hideOnceBanner();

    state.jp = E.nextJpPot(state.jp, total, result.jpWin, settings);

    if (roundWin > 0) setMsg(`本局 +${roundWin}・得分或比大小`, 'hot');
    else if (!msgEl.textContent.includes('沒中') && !msgEl.textContent.includes('上限')) {
      /* keep prior lose message */
    }

    state.betsPaid = false;
    state.busy = false;
    if (roundWin > 0) {
      FX.win();
      if (roundWin >= 100) FX.flashFever('fever', 1200);
      // bump fake hold lamps on a paying round
      FX.holdsSet(Math.min(4, holdCount + 1));
    } else {
      FX.idle();
      if (holdCount > 0 && randomFloat() < 0.35) FX.holdsSet(holdCount - 1);
    }
    if (state.credit === 0 && state.win === 0) {
      setMsg('分數用完・開分或⚙️重設', 'bad');
      stopAuto('分數不足');
    }
    render();
    save();
    if (state.auto) queueAuto();
  }

  async function collect() {
    if (state.busy || state.win <= 0) return;
    state.busy = true;
    clearHighlights();
    render();
    const amount = state.win;
    const steps = Math.min(40, amount);
    const startCredit = state.credit;
    for (let k = 1; k <= steps; k++) {
      const moved = Math.round((amount * k) / steps);
      state.win = amount - moved;
      state.credit = startCredit + moved;
      winLed.set(state.win);
      creditLed.set(state.credit);
      if (k % 2) Sound.coin();
      await sleep(22);
    }
    state.win = 0;
    state.credit = startCredit + amount;
    state.busy = false;
    setMsg(`得分 ${amount}`);
    render();
    save();
    if (state.auto) queueAuto();
  }

  async function gamble(choice) {
    if (state.busy || state.win <= 0) return;
    state.busy = true;
    clearHighlights();
    render();
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
      setMsg(`開 ${result}・中！×2`, 'hot');
      Sound.win();
      await animateWin(before, before * 2);
    } else {
      setMsg(`開 ${result}・錯`, 'bad');
      Sound.lose();
      state.win = 0;
    }
    state.busy = false;
    render();
    save();
  }

  function stopAuto(reason) {
    if (!state.auto) return;
    state.auto = false;
    if (reason) setMsg(reason, 'bad');
    render();
  }

  function queueAuto() {
    if (!state.auto) return;
    setTimeout(() => { if (state.auto) autoTick(); }, 420);
  }

  async function autoTick() {
    if (!state.auto || state.busy) return;
    if (state.win > 0) {
      await collect();
      return;
    }
    const pattern = sum(state.lastPlayedBets) > 0 ? state.lastPlayedBets : state.bets;
    const need = sum(pattern);
    if (need <= 0) {
      stopAuto('無押注可自動');
      return;
    }
    // Ensure bets match last pattern and are ready to start
    if (!state.betsPaid || sum(state.bets) === 0) {
      if (!applyBetPattern(pattern, { quiet: true })) {
        stopAuto('分數不足・已停自動');
        return;
      }
    } else if (state.credit < 0) {
      stopAuto('分數不足・已停自動');
      return;
    }
    await start();
  }

  function toggleAuto() {
    if (state.auto) {
      stopAuto('已停自動');
      setMsg('已停自動');
      render();
      return;
    }
    if (state.busy) return;
    const pattern = sum(state.lastPlayedBets) > 0 ? state.lastPlayedBets : state.bets;
    if (sum(pattern) <= 0) {
      setMsg('請先押注再自動', 'bad');
      Sound.error();
      render();
      return;
    }
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
      if (!quiet) { setMsg('無上一局押注', 'bad'); Sound.error(); }
      render();
      return false;
    }
    if (state.credit < need) {
      if (!quiet) { setMsg(`分數不足（需 ${need}）`, 'bad'); Sound.error(); }
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
    if (state.busy) return;
    const pattern = sum(state.lastPlayedBets) > 0 ? state.lastPlayedBets : state.bets;
    applyBetPattern(pattern);
  }

  function doubleBets() {
    if (state.busy) return;
    collectInstant();
    clearHighlights();
    if (sum(state.bets) <= 0) {
      setMsg('請先押注', 'bad');
      Sound.error();
      render();
      return;
    }
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
      Sound.error();
      setMsg(state.betsPaid && state.credit < 1 ? '分數不足' : '已達上限', 'bad');
    }
    render();
    save();
  }

  const OPEN_CREDIT_TAP = 100;
  const OPEN_CREDIT_HOLD = 500;
  const CREDIT_CAP = 999999;

  function openCredit(amount) {
    if (state.busy) return;
    const add = Math.max(0, amount | 0);
    if (!add) return;
    state.credit = Math.min(CREDIT_CAP, state.credit + add);
    Sound.coin();
    setMsg(`開分 +${add}`);
    render();
    save();
  }

  function washCredit() {
    if (state.busy) return;
    clearHighlights();
    // Transfer WIN → CREDIT, refund unpaid bets if any, then cash-out CREDIT to 0
    if (state.win > 0) {
      state.credit += state.win;
      state.win = 0;
    }
    if (state.betsPaid) state.credit += sum(state.bets);
    state.bets.fill(0);
    state.betsPaid = true;
    const cashed = state.credit;
    state.credit = 0;
    stopAuto();
    Sound.seq([520, 400, 300], 0.07, 'triangle', 0.06);
    setMsg(cashed > 0 ? `洗分 ${cashed}` : '已洗分');
    render();
    save();
  }

  function startCreditAmount() {
    return Math.max(100, Math.min(99999, Math.floor(settings.startCredit || START_CREDIT)));
  }

  function resetCredit() {
    if (state.busy) return;
    stopAuto();
    const amt = startCreditAmount();
    state.credit = amt;
    state.win = 0;
    state.bets.fill(0);
    state.betsPaid = true;
    state.jp = JP.seed;
    clearHighlights();
    diceLed.set('-');
    setMsg(`已重設 ${amt}`);
    render();
    save();
  }

  // ---------------------------------------------------------------------------
  // 7. Settings UI
  // ---------------------------------------------------------------------------

  const settingsDlg = $('settingsDialog');
  const helpDlg = $('helpDialog');
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
    lab.innerHTML = `<input type="checkbox" data-mode="${k}"> <span>${MODE_LABELS[k]}</span>`;
    modeList.appendChild(lab);
  });

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
    try {
      const sim = E.simulate(settings, 2500, Math.random);
      const pct = (sim.rtp * 100).toFixed(0);
      oddsHint.textContent = `RTP約 ${pct}%・中彩 ${(sim.bonusRate * 100).toFixed(1)}%・JP ${(sim.jpRate * 100).toFixed(2)}%`;
    } catch {
      oddsHint.textContent = '預估 RTP —';
    }
  }

  function openSettings() {
    refreshSettingsUI();
    if (typeof settingsDlg.showModal === 'function') settingsDlg.showModal();
    else settingsDlg.setAttribute('open', '');
  }

  function openHelp() {
    if (typeof helpDlg.showModal === 'function') helpDlg.showModal();
    else helpDlg.setAttribute('open', '');
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
    settings.modes[inp.dataset.mode] = inp.checked;
    markCustom();
    saveSettings();
    refreshSettingsUI();
    render();
  });

  weightList.addEventListener('input', (e) => {
    const inp = e.target.closest('input[data-weight]');
    if (!inp) return;
    const k = inp.dataset.weight;
    settings.weights[k] = Number(inp.value);
    markCustom();
    const span = weightList.querySelector(`[data-weight-val="${k}"]`);
    if (span) span.textContent = Number(inp.value).toFixed(1);
  });
  weightList.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-weight]');
    if (!inp) return;
    settings.weights[inp.dataset.weight] = Number(inp.value);
    markCustom();
    saveSettings();
    refreshSettingsUI();
  });

  for (const [key, [el, valEl, fmt]] of Object.entries(rangeEls)) {
    if (!el) continue;
    el.addEventListener('input', () => {
      settings[key] = Number(el.value);
      if (key === 'bonusRate' || key === 'onceRate' || key === 'jpRate') markCustom();
      valEl.textContent = fmt(Number(el.value));
      if (key === 'sfxVol' || key === 'bgmVol') Music.applyVolume();
    });
    el.addEventListener('change', () => {
      settings[key] = Number(el.value);
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
    if (v === 'reset') resetCredit();
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

  betKeys.forEach((k, i) => {
    let holdTimer = null;
    let repeatTimer = null;
    const stop = () => {
      clearTimeout(holdTimer);
      clearInterval(repeatTimer);
      holdTimer = repeatTimer = null;
      k.el.classList.remove('pressed');
    };
    k.el.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      Sound.unlock();
      k.el.classList.add('pressed');
      if (!bet(i)) return stop();
      holdTimer = setTimeout(() => {
        repeatTimer = setInterval(() => { if (!bet(i)) stop(); }, 90);
      }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture'].forEach((ev) =>
      k.el.addEventListener(ev, stop));
    k.el.addEventListener('contextmenu', (e) => e.preventDefault());
    k.el.addEventListener('click', (e) => { if (e.detail === 0) bet(i); });
  });

  btn.start.addEventListener('click', () => { if (state.auto) stopAuto(); start(); });
  btn.clear.addEventListener('click', () => { stopAuto(); clearBets(); });
  btn.all.addEventListener('click', () => { stopAuto(); betAll(); });
  btn.collect.addEventListener('click', collect);
  btn.small.addEventListener('click', () => { stopAuto(); gamble('small'); });
  btn.big.addEventListener('click', () => { stopAuto(); gamble('big'); });
  btn.rebet.addEventListener('click', () => { stopAuto(); rebet(); });
  btn.dbl.addEventListener('click', () => { stopAuto(); doubleBets(); });
  btn.auto.addEventListener('click', toggleAuto);
  btn.wash.addEventListener('click', washCredit);

  // 開分: tap +100, hold +500
  (() => {
    let holdTimer = null;
    let held = false;
    const clear = () => { clearTimeout(holdTimer); holdTimer = null; };
    btn.open.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      held = false;
      stopAuto();
      holdTimer = setTimeout(() => {
        held = true;
        openCredit(OPEN_CREDIT_HOLD);
      }, 420);
    });
    const up = () => {
      if (holdTimer) {
        clear();
        if (!held) openCredit(OPEN_CREDIT_TAP);
      }
      held = false;
    };
    ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture'].forEach((ev) =>
      btn.open.addEventListener(ev, up));
    btn.open.addEventListener('contextmenu', (e) => e.preventDefault());
  })();

  btn.sound.addEventListener('click', () => {
    Sound.on = !Sound.on;
    Sound.unlock().then(() => {
      Music.update();
      if (Sound.on) Sound.bet();
    });
    render();
    save();
  });
  btn.settings.addEventListener('click', openSettings);

  window.addEventListener('keydown', (e) => {
    if (settingsDlg.open || helpDlg.open || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k >= '1' && k <= '8') { stopAuto(); bet(Number(k) - 1); e.preventDefault(); return; }
    switch (k.toLowerCase()) {
      case ' ': case 'enter': if (state.auto) stopAuto(); start(); break;
      case 'a': stopAuto(); betAll(); break;
      case 'c': case 'backspace': stopAuto(); clearBets(); break;
      case 's': collect(); break;
      case 'arrowleft': case 'q': stopAuto(); gamble('small'); break;
      case 'arrowright': case 'e': stopAuto(); gamble('big'); break;
      case 'd': stopAuto(); doubleBets(); break;
      case 'r': stopAuto(); rebet(); break;
      case 't': toggleAuto(); break;
      case 'o': stopAuto(); openCredit(OPEN_CREDIT_TAP); break;
      case 'w': washCredit(); break;
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
  window.addEventListener('resize', () => {
    // keep reel offsets correct after layout changes
    idleReels();
  });

  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---------------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------------
  loadSettings();
  load();
  diceLed.set('-');
  setLight(state.pos);
  requestAnimationFrame(() => idleReels());
  if (!state.betsPaid && sum(state.bets) > 0) setMsg('按開始續玩，或重押');
  render();

  window.__xiaomali = {
    state, settings, TRACK, SYMBOLS, pickTarget, resetCredit, Music, Sound, E,
    setSettings(s) { settings = E.normalizeSettings(s); saveSettings(); render(); },
  };
})();
