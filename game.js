/* 小瑪莉 Little Mary — pure static fruit-machine game.
 * No build step, no dependencies. All money is fake play credit.
 *
 * Sections:
 *   1. Config (data/odds from engine.js)
 *   2. Seven-segment LED renderer
 *   3. Sound (Web Audio beeps) + Music (procedural BGM loops)
 *   4. Game state + settings + persistence
 *   5. DOM build + render (+ center 3-reel panel)
 *   6. Actions (bet / clear / all / start / collect / big-small)
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
    MODE_KEYS, MODE_LABELS, PRESETS,
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
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { this.ctx = new AC(); } catch { return; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      Music.update();
    },
    beep(freq, dur = 0.05, type = 'square', vol = 0.04, when = 0) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    seq(notes, step = 0.09, type = 'square', vol = 0.05) {
      notes.forEach((f, i) => f && this.beep(f, step * 0.9, type, vol, i * step));
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
      name: '經典街機', bpm: 138, leadWave: 'square', bassWave: 'triangle', leadVol: 0.022, bassVol: 0.05,
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
      const want = Sound.on && Sound.ctx && this.track !== 'off' && !document.hidden;
      if (want) this.start(); else this.stop();
    },
    start() {
      if (this.timer || !Sound.ctx) return;
      const ctx = Sound.ctx;
      this.gain = ctx.createGain();
      this.gain.gain.value = 1;
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
    pos: 0,
    busy: false,
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
  const betpanel = $('betpanel');
  const msgEl = $('msg');
  const btn = {
    start: $('btnStart'), clear: $('btnClear'), all: $('btnAll'),
    collect: $('btnCollect'), small: $('btnSmall'), big: $('btnBig'),
    sound: $('btnSound'), settings: $('btnSettings'), reset: $('btnReset'),
    openHelp: $('btnOpenHelp'),
  };

  function iconHTML(symId) {
    if (symId === 'once') return '<span class="ic-once">ONCE<br>MORE</span>';
    if (symId === 'seven') return '<span class="ic-77">77</span>';
    if (symId === 'bar') return '<span class="ic-bar"><i>BAR</i><i>BAR</i><i>BAR</i></span>';
    const s = SYMBOLS[SYM_INDEX[symId]];
    return s ? `<span>${s.icon}</span>` : '';
  }

  const tileEls = TRACK.map((t, i) => {
    const el = document.createElement('div');
    el.className = 'tile' + (t.small ? ' small' : '') + (t.s === 'once' ? ' once' : '');
    const [r, c] = TRACK_POS[i];
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
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'betkey';
    b.setAttribute('aria-label', `押 ${s.name}（${s.mult} 倍）`);
    b.innerHTML = `<span class="mult">${s.mult}</span><span class="bicon">${iconHTML(s.id)}</span><span class="led"></span>`;
    betpanel.appendChild(b);
    return { el: b, led: makeLed(b.querySelector('.led'), 2) };
  });

  const winLed = makeLed($('winLed'), 6);
  const creditLed = makeLed($('creditLed'), 6);
  const diceLed = makeLed($('diceLed'), 1);

  $('paytable').innerHTML = SYMBOLS.map((s) =>
    `<tr><td>${iconHTML(s.id)}</td><td>${s.name}</td><td>× ${s.mult}</td></tr>`).join('') +
    '<tr><td>×3</td><td>小圖示（BAR 小圖示為 50）</td><td>× 3 / × 50</td></tr>' +
    '<tr><td><span class="ic-once" style="font-size:8px">ONCE<br>MORE</span></td><td>免費再跑一次</td><td>FREE</td></tr>' +
    `<tr><td>JP</td><td>停大 BAR 且押 BAR（滿 ${JP.fullBet} 拿全額）</td><td>彩金</td></tr>` +
    '<tr><td>★</td><td>送燈／開火車／三元四喜</td><td>中彩</td></tr>';

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
      k.el.classList.toggle('stale', !state.betsPaid && state.bets[i] > 0);
    });
    const idle = !state.busy;
    const hasWin = state.win > 0;
    btn.start.disabled = !idle;
    btn.clear.disabled = !idle;
    btn.all.disabled = !idle;
    btn.collect.disabled = !idle || !hasWin;
    btn.small.disabled = !idle || !hasWin;
    btn.big.disabled = !idle || !hasWin;
    betKeys.forEach((k) => (k.el.disabled = !idle));
    btn.collect.classList.toggle('flash', idle && hasWin);
    btn.start.classList.toggle('flash', idle && !hasWin && sum(state.bets) > 0);
    btn.sound.textContent = Sound.on ? '🔊' : '🔇';
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function clearHighlights() {
    tileEls.forEach((el) => el.classList.remove('win', 'lit2'));
    betKeys.forEach((k) => k.el.classList.remove('hit'));
    $('lblSmall').classList.remove('on');
    $('lblBig').classList.remove('on');
    $('jpRow')?.classList.remove('jp-hit');
    reelStrips.forEach((r) => r.parent.classList.remove('landed', 'spinning'));
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

  function bet(i) {
    if (state.busy) return false;
    collectInstant();
    clearHighlights();
    freshBets();
    if (state.bets[i] >= MAX_BET_PER_SYMBOL) {
      setMsg(`${SYMBOLS[i].name} 最多押 ${MAX_BET_PER_SYMBOL}`, 'bad');
      render();
      return false;
    }
    if (state.credit < 1) {
      setMsg('分數不足！可在 ⚙️ 重設分數', 'bad');
      Sound.error();
      render();
      return false;
    }
    state.bets[i]++;
    state.credit--;
    Sound.bet();
    setMsg(`已押 ${sum(state.bets)} 分，按「開始」`);
    render();
    save();
    return true;
  }

  function betAll() {
    if (state.busy) return;
    collectInstant();
    clearHighlights();
    freshBets();
    let added = 0;
    for (let i = 0; i < SYMBOLS.length; i++) {
      if (state.credit < 1) break;
      if (state.bets[i] >= MAX_BET_PER_SYMBOL) continue;
      state.bets[i]++;
      state.credit--;
      added++;
    }
    if (added) { Sound.seq([784, 988, 1175], 0.05, 'triangle', 0.07); setMsg(`全押！共押 ${sum(state.bets)} 分`); }
    else { Sound.error(); setMsg('無法再加注', 'bad'); }
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
    setMsg('已清除押注');
    render();
    save();
  }

  async function runLight(target) {
    const dist = (target - state.pos + N) % N;
    const laps = 2 + (randomFloat() < 0.5 ? 1 : 0);
    const total = laps * N + dist;
    const FAST = 28;
    const DECEL = 15;
    for (let s = 1; s <= total; s++) {
      state.pos = (state.pos + 1) % N;
      const remaining = total - s;
      let delay;
      if (s <= 6) delay = FAST + (7 - s) * 16;
      else if (remaining >= DECEL) delay = FAST;
      else delay = FAST + Math.pow(DECEL - remaining, 2) * 2;
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
    if (state.win > 0) collectInstant();
    clearHighlights();
    const total = sum(state.bets);
    if (total === 0) {
      setMsg('請先點水果押注', 'bad');
      Sound.error();
      render();
      return;
    }
    if (!state.betsPaid) {
      if (state.credit < total) {
        setMsg(`分數不足（需 ${total}），請清除後重押`, 'bad');
        Sound.error();
        render();
        return;
      }
      state.credit -= total;
      state.betsPaid = true;
    }
    state.busy = true;
    render();
    save();

    const potBefore = settings.modes.jp ? state.jp : 0;
    const result = E.resolveRound(state.bets, settings, randomFloat, potBefore);
    let roundWin = 0;
    let chain = 0;

    for (const step of result.steps) {
      if (step.type === 'once') {
        setMsg(chain ? `ONCE MORE 免費再跑！（${chain}）` : 'ONCE MORE…', 'hot');
        const dur = estimateLightMs(step.target);
        await Promise.all([runLight(step.target), spinReels('once', Math.max(900, dur - 400))]);
        tileEls[step.target].classList.add('win');
        Sound.once();
        chain++;
        if (chain > MAX_ONCE_MORE_CHAIN) {
          setMsg('ONCE MORE 已達上限');
          break;
        }
        setMsg('ONCE MORE！同押注免費再跑一次', 'hot');
        await sleep(900);
        tileEls[step.target].classList.remove('win');
        continue;
      }

      if (step.type === 'land') {
        setMsg(chain ? `ONCE MORE 後轉動中…` : '轉動中…', chain ? 'hot' : '');
        const dur = estimateLightMs(step.target);
        const landId = TRACK[step.target].s;
        await Promise.all([runLight(step.target), spinReels(landId, Math.max(900, dur - 400))]);
        const sym = step.si >= 0 ? SYMBOLS[step.si] : null;
        if (step.gained > 0 && sym) {
          roundWin += step.gained;
          tileEls[step.target].classList.add('win');
          betKeys[step.si].el.classList.add('hit');
          if (step.mult >= 40) Sound.big(); else Sound.win();
          setMsg(`${sym.name}${TRACK[step.target].small ? '（小）' : ''} ${state.bets[step.si]} × ${step.mult} = ${step.gained}！`, 'hot');
          await animateWin(state.win, state.win + step.gained);
        } else if (sym) {
          setMsg(`停在 ${sym.name}${TRACK[step.target].small ? '（小）' : ''}，沒押中`, 'bad');
          Sound.lose();
        }
        continue;
      }

      if (step.type === 'bonus') {
        Sound.lucky();
        setMsg(`中彩！${step.name}`, 'hot');
        for (const t of step.tiles) {
          tileEls[t.i].classList.add('win', 'lit2');
          if (t.si >= 0 && t.gained > 0) betKeys[t.si].el.classList.add('hit');
          await sleep(220);
        }
        if (step.gained > 0) {
          roundWin += step.gained;
          await animateWin(state.win, state.win + step.gained);
          setMsg(`${step.name} 再得 ${step.gained}！`, 'hot');
        } else {
          setMsg(`${step.name}（未押中額外燈）`, 'hot');
        }
        await sleep(500);
        continue;
      }

      if (step.type === 'jp') {
        Sound.jp();
        $('jpRow')?.classList.add('jp-hit');
        setMsg(`JP 彩金！+${step.amount}`, 'hot');
        roundWin += step.amount;
        await animateWin(state.win, state.win + step.amount);
        await sleep(600);
      }
    }

    state.jp = E.nextJpPot(state.jp, total, result.jpWin);

    if (roundWin > 0) setMsg(`本局共贏 ${roundWin}！可得分或比大小`, 'hot');
    else if (!msgEl.textContent.includes('沒押中') && !msgEl.textContent.includes('上限')) {
      /* keep prior lose message */
    }

    state.betsPaid = false;
    state.busy = false;
    if (state.credit === 0 && state.win === 0) {
      setMsg('分數用完了，點右上 ⚙️ 重設分數', 'bad');
    }
    render();
    save();
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
    setMsg(`得分 ${amount}！繼續押注或直接「開始」`);
    render();
    save();
  }

  async function gamble(choice) {
    if (state.busy || state.win <= 0) return;
    state.busy = true;
    clearHighlights();
    render();
    setMsg(choice === 'small' ? '押「小」…' : '押「大」…');
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
      setMsg('開 5，和局！WIN 不變', '');
      Sound.beep(660, 0.15, 'triangle', 0.07);
    } else if ((choice === 'small' && isSmall) || (choice === 'big' && isBig)) {
      const before = state.win;
      setMsg(`開 ${result}，猜中！WIN 加倍`, 'hot');
      Sound.win();
      await animateWin(before, before * 2);
    } else {
      setMsg(`開 ${result}，猜錯… WIN 歸零`, 'bad');
      Sound.lose();
      state.win = 0;
    }
    state.busy = false;
    render();
    save();
  }

  function resetCredit() {
    if (state.busy) return;
    state.credit = START_CREDIT;
    state.win = 0;
    state.bets.fill(0);
    state.betsPaid = true;
    state.jp = JP.seed;
    clearHighlights();
    diceLed.set('-');
    setMsg('分數已重設為 1000');
    render();
    save();
  }

  // ---------------------------------------------------------------------------
  // 7. Settings UI
  // ---------------------------------------------------------------------------

  const settingsDlg = $('settingsDialog');
  const helpDlg = $('helpDialog');
  const modeList = $('modeList');
  const musicRow = $('musicRow');
  const presetRow = $('presetRow');
  const bonusRateEl = $('bonusRate');
  const bonusRateVal = $('bonusRateVal');
  const oddsHint = $('oddsHint');

  MODE_KEYS.forEach((k) => {
    const lab = document.createElement('label');
    lab.innerHTML = `<input type="checkbox" data-mode="${k}"> <span>${MODE_LABELS[k]}</span>`;
    modeList.appendChild(lab);
  });

  MUSIC_IDS.forEach((id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.music = id;
    b.textContent = MUSIC_TRACKS[id].name;
    musicRow.appendChild(b);
  });

  function refreshSettingsUI() {
    presetRow.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('on', c.dataset.preset === settings.preset);
    });
    modeList.querySelectorAll('input[data-mode]').forEach((inp) => {
      inp.checked = !!settings.modes[inp.dataset.mode];
    });
    bonusRateEl.value = String(settings.bonusRate);
    bonusRateVal.textContent = Number(settings.bonusRate).toFixed(1) + '×';
    musicRow.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('on', c.dataset.music === Music.track);
    });
    // Lightweight RTP hint (2k rounds — fast enough for UI)
    try {
      const sim = E.simulate(settings, 2500, Math.random);
      const pct = (sim.rtp * 100).toFixed(0);
      oddsHint.textContent = `預估 RTP（全押）約 ${pct}%・中彩 ${(sim.bonusRate * 100).toFixed(1)}%・JP ${(sim.jpRate * 100).toFixed(2)}%（模擬值，娛樂用）`;
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
    render();
    Sound.bet();
  });

  modeList.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-mode]');
    if (!inp) return;
    settings.modes[inp.dataset.mode] = inp.checked;
    settings.preset = 'custom';
    saveSettings();
    refreshSettingsUI();
    render();
  });

  bonusRateEl.addEventListener('input', () => {
    settings.bonusRate = Number(bonusRateEl.value);
    settings.preset = 'custom';
    bonusRateVal.textContent = settings.bonusRate.toFixed(1) + '×';
  });
  bonusRateEl.addEventListener('change', () => {
    settings.bonusRate = Number(bonusRateEl.value);
    settings.preset = 'custom';
    saveSettings();
    refreshSettingsUI();
  });

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

  btn.start.addEventListener('click', start);
  btn.clear.addEventListener('click', clearBets);
  btn.all.addEventListener('click', betAll);
  btn.collect.addEventListener('click', collect);
  btn.small.addEventListener('click', () => gamble('small'));
  btn.big.addEventListener('click', () => gamble('big'));
  btn.sound.addEventListener('click', () => {
    Sound.on = !Sound.on;
    Sound.unlock();
    Music.update();
    if (Sound.on) Sound.bet();
    render();
    save();
  });
  btn.settings.addEventListener('click', openSettings);

  window.addEventListener('keydown', (e) => {
    if (settingsDlg.open || helpDlg.open || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k >= '1' && k <= '8') { bet(Number(k) - 1); e.preventDefault(); return; }
    switch (k.toLowerCase()) {
      case ' ': case 'enter': start(); break;
      case 'a': betAll(); break;
      case 'c': case 'backspace': clearBets(); break;
      case 's': collect(); break;
      case 'arrowleft': case 'q': gamble('small'); break;
      case 'arrowright': case 'e': gamble('big'); break;
      default: return;
    }
    e.preventDefault();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
    Music.update();
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
  if (!state.betsPaid && sum(state.bets) > 0) setMsg('按「開始」以上局押注再玩，或重新押注');
  render();

  window.__xiaomali = {
    state, settings, TRACK, SYMBOLS, pickTarget, resetCredit, Music, Sound, E,
    setSettings(s) { settings = E.normalizeSettings(s); saveSettings(); render(); },
  };
})();
