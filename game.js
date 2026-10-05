/* 小瑪莉 Little Mary — pure static fruit-machine game.
 * No build step, no dependencies. All money is fake play credit.
 *
 * Sections:
 *   1. Config (symbols, track layout, odds)
 *   2. Seven-segment LED renderer
 *   3. Sound (Web Audio beeps)
 *   4. Game state + persistence
 *   5. DOM build + render
 *   6. Actions (bet / clear / all / start / collect / big-small)
 *   7. Input wiring (touch, mouse, keyboard)
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Config
  // ---------------------------------------------------------------------------

  /** Bet symbols, left → right on the bet panel. `mult` = full-size payout. */
  const SYMBOLS = [
    { id: 'apple',  name: '蘋果',  mult: 5,   icon: '🍎' },
    { id: 'orange', name: '柳橙',  mult: 10,  icon: '🍊' },
    { id: 'mango',  name: '芒果',  mult: 10,  icon: '🥭' },
    { id: 'bell',   name: '鈴鐺',  mult: 20,  icon: '🔔' },
    { id: 'melon',  name: '西瓜',  mult: 20,  icon: '🍉' },
    { id: 'star',   name: '星星',  mult: 30,  icon: '⭐' },
    { id: 'seven',  name: '77',    mult: 40,  icon: null },
    { id: 'bar',    name: 'BAR',   mult: 100, icon: null },
  ];
  const SYM_INDEX = Object.fromEntries(SYMBOLS.map((s, i) => [s.id, i]));

  /**
   * 24 track tiles, clockwise starting from the top-left corner.
   *   s     symbol id, or 'once' for ONCE MORE
   *   small true → small icon that pays `pay` × bet instead of the full multiplier
   *   w     relative weight (probability the light stops here)
   * Weights are tuned so each symbol returns roughly 90% of what is bet on it,
   * and ONCE MORE (~8%) adds a free re-spin. Tweak here to change difficulty.
   */
  const TRACK = [
    // top row (left → right)
    { s: 'orange', w: 3 },
    { s: 'bell',   w: 3 },
    { s: 'bar',    small: true, pay: 50, w: 0.8 },
    { s: 'bar',    w: 0.5 },
    { s: 'apple',  w: 3 },
    { s: 'melon',  small: true, pay: 3, w: 10 },
    { s: 'mango',  w: 3 },
    // right column (top → bottom)
    { s: 'melon',  w: 3 },
    { s: 'apple',  w: 3 },
    { s: 'once',   w: 4.175 },
    { s: 'orange', small: true, pay: 3, w: 10 },
    { s: 'star',   w: 2.4 },
    { s: 'mango',  small: true, pay: 3, w: 10 },
    // bottom row (right → left)
    { s: 'seven',  w: 1.95 },
    { s: 'apple',  w: 3 },
    { s: 'bell',   small: true, pay: 3, w: 10 },
    { s: 'seven',  small: true, pay: 3, w: 4 },
    { s: 'apple',  w: 3 },
    { s: 'orange', w: 3 },
    // left column (bottom → top)
    { s: 'apple',  w: 3 },
    { s: 'star',   small: true, pay: 3, w: 6 },
    { s: 'once',   w: 4.175 },
    { s: 'mango',  w: 3 },
    { s: 'apple',  w: 3 },
  ];
  const N = TRACK.length; // 24

  /** grid [row, col] (1-based for CSS grid) for each track index */
  const TRACK_POS = (() => {
    const p = [];
    for (let c = 0; c < 7; c++) p.push([1, c + 1]);        // top
    for (let r = 1; r < 7; r++) p.push([r + 1, 7]);        // right
    for (let c = 5; c >= 0; c--) p.push([7, c + 1]);       // bottom
    for (let r = 5; r >= 1; r--) p.push([r + 1, 1]);       // left
    return p;
  })();

  const START_CREDIT = 1000;
  const MAX_BET_PER_SYMBOL = 99;
  const MAX_ONCE_MORE_CHAIN = 5;
  const STORAGE_KEY = 'xiaomali.v1';

  // ---------------------------------------------------------------------------
  // 2. Seven-segment LED renderer (inline SVG, no fonts needed)
  // ---------------------------------------------------------------------------

  const SEG_PATHS = (() => {
    const t = 1.7; // segment thickness
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
      /** show a number (right-aligned, no leading zeros) or a raw string */
      set(value, { pad = ' ' } = {}) {
        let str = typeof value === 'number' ? String(Math.max(0, Math.floor(value))) : String(value);
        if (str.length > digits) str = str.slice(-digits); // overflow: show last digits
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
  // 3. Sound — tiny Web Audio synth. iOS requires a user gesture to unlock.
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
  };

  // ---------------------------------------------------------------------------
  // 4. State + persistence
  // ---------------------------------------------------------------------------

  const state = {
    credit: START_CREDIT,
    win: 0,
    bets: new Array(SYMBOLS.length).fill(0),
    /** true = bets already deducted from credit for the upcoming spin.
     *  false = bets shown are last round's ("stale"); Start will re-buy them. */
    betsPaid: true,
    pos: 0,          // current light position
    busy: false,     // true while spinning / gambling / collecting
  };

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (d && Number.isFinite(d.credit)) {
        state.credit = Math.max(0, Math.floor(d.credit));
        state.win = Math.max(0, Math.floor(d.win || 0));
        state.pos = (d.pos | 0) % N;
        Sound.on = d.sound !== false;
        if (Array.isArray(d.lastBets) && d.lastBets.length === SYMBOLS.length) {
          state.bets = d.lastBets.map((n) => Math.min(MAX_BET_PER_SYMBOL, Math.max(0, n | 0)));
          state.betsPaid = false;
        }
      }
    } catch { /* ignore corrupt storage */ }
  }

  function save() {
    try {
      // Paid-but-unspun bets are refunded into credit when saved.
      const refund = state.betsPaid && !state.busy ? sum(state.bets) : 0;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        credit: state.credit + refund,
        win: state.win,
        pos: state.pos,
        sound: Sound.on,
        lastBets: state.bets,
      }));
    } catch { /* private mode etc. */ }
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
    sound: $('btnSound'), menu: $('btnMenu'), reset: $('btnReset'),
  };

  function iconHTML(symId) {
    if (symId === 'once') return '<span class="ic-once">ONCE<br>MORE</span>';
    if (symId === 'seven') return '<span class="ic-77">77</span>';
    if (symId === 'bar') return '<span class="ic-bar"><i>BAR</i><i>BAR</i><i>BAR</i></span>';
    return `<span>${SYMBOLS[SYM_INDEX[symId]].icon}</span>`;
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
  $('creditLed').classList.add('green');

  // pay table in help dialog
  $('paytable').innerHTML = SYMBOLS.map((s) =>
    `<tr><td>${iconHTML(s.id)}</td><td>${s.name}</td><td>× ${s.mult}</td></tr>`).join('') +
    '<tr><td>×3</td><td>小圖示（BAR 小圖示為 50）</td><td>× 3 / × 50</td></tr>' +
    '<tr><td><span class="ic-once" style="font-size:8px">ONCE<br>MORE</span></td><td>免費再跑一次</td><td>FREE</td></tr>';

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
    tileEls.forEach((el) => el.classList.remove('win'));
    betKeys.forEach((k) => k.el.classList.remove('hit'));
    $('lblSmall').classList.remove('on');
    $('lblBig').classList.remove('on');
  }

  // ---------------------------------------------------------------------------
  // 6. Actions
  // ---------------------------------------------------------------------------

  function pickTarget() {
    const total = TRACK.reduce((a, t) => a + t.w, 0);
    let r = randomFloat() * total;
    for (let i = 0; i < N; i++) {
      r -= TRACK[i].w;
      if (r < 0) return i;
    }
    return N - 1;
  }

  function randomFloat() {
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] / 4294967296;
    }
    return Math.random();
  }

  /** Move WIN into CREDIT immediately (used implicitly before betting/starting). */
  function collectInstant() {
    if (state.win <= 0) return;
    state.credit += state.win;
    state.win = 0;
    Sound.coin();
    clearHighlights();
  }

  /** If last round's bets are still on display, wipe them for a fresh bet. */
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
      setMsg('分數不足！可在 ☰ 重設分數', 'bad');
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

  /** One light run: race → decelerate → stop at target. */
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
      if (s <= 6) delay = FAST + (7 - s) * 16;                         // spin-up
      else if (remaining >= DECEL) delay = FAST;                        // full speed
      else delay = FAST + Math.pow(DECEL - remaining, 2) * 2;           // slow down
      setLight(state.pos, delay < 60 ? 2 : delay < 120 ? 1 : 0);
      Sound.tick();
      await sleep(delay);
    }
    setLight(state.pos, 0);
  }

  async function animateWin(from, to) {
    const steps = Math.min(30, to - from);
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
      state.credit -= total; // re-buy last round's bets
      state.betsPaid = true;
    }
    state.busy = true;
    render();
    save();

    let chain = 0;
    let roundWin = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      setMsg(chain ? `ONCE MORE 免費再跑！（${chain}）` : '轉動中…', chain ? 'hot' : '');
      const target = pickTarget();
      await runLight(target);
      const t = TRACK[target];

      if (t.s === 'once') {
        tileEls[target].classList.add('win');
        Sound.once();
        if (chain < MAX_ONCE_MORE_CHAIN) {
          setMsg('ONCE MORE！同押注免費再跑一次', 'hot');
          chain++;
          await sleep(1200);
          tileEls[target].classList.remove('win');
          continue;
        }
        setMsg('ONCE MORE 已達上限');
        break;
      }

      const si = SYM_INDEX[t.s];
      const sym = SYMBOLS[si];
      const b = state.bets[si];
      const mult = t.small ? t.pay : sym.mult;
      if (b > 0) {
        const gained = b * mult;
        roundWin += gained;
        tileEls[target].classList.add('win');
        betKeys[si].el.classList.add('hit');
        if (mult >= 40) Sound.big(); else Sound.win();
        setMsg(`${sym.name}${t.small ? '（小）' : ''} ${b} × ${mult} = ${gained}！`, 'hot');
        await animateWin(state.win, state.win + gained);
      } else {
        setMsg(`停在 ${sym.name}${t.small ? '（小）' : ''}，沒押中`, 'bad');
        Sound.lose();
      }
      break;
    }

    if (roundWin > 0 && chain > 0) setMsg(`本局共贏 ${roundWin}！可得分或比大小`, 'hot');
    else if (roundWin > 0) setMsg(msgEl.textContent + ' 得分或比大小？', 'hot');

    state.betsPaid = false; // bets stay on display; Start re-buys them
    state.busy = false;
    if (state.credit === 0 && state.win === 0) {
      setMsg('分數用完了，點右上 ☰ 重設分數', 'bad');
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

  /** 比大小: 1–4 small, 6–9 big, 5 = push. Correct guess doubles WIN, wrong loses it. */
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
    clearHighlights();
    diceLed.set('-');
    setMsg('分數已重設為 1000');
    render();
    save();
  }

  // ---------------------------------------------------------------------------
  // 7. Input
  // ---------------------------------------------------------------------------

  // Unlock audio on the first gesture (required by iOS Safari).
  const unlock = () => Sound.unlock();
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);

  // Bet keys: fire on pointerdown for arcade feel; hold to auto-repeat.
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
    // keyboard activation (Enter/Space on focused key) still works via click
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
    if (Sound.on) Sound.bet();
    render();
    save();
  });

  const dlg = $('helpDialog');
  btn.menu.addEventListener('click', () => {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'reset') resetCredit();
  });

  window.addEventListener('keydown', (e) => {
    if (dlg.open || e.metaKey || e.ctrlKey || e.altKey) return;
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

  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);

  // Block pinch/double-tap zoom gestures that iOS sometimes still allows.
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---------------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------------
  load();
  diceLed.set('-');
  setLight(state.pos);
  if (!state.betsPaid && sum(state.bets) > 0) setMsg('按「開始」以上局押注再玩，或重新押注');
  render();

  // Expose a tiny debug hook for maintainers (see AGENTS.md).
  window.__xiaomali = { state, TRACK, SYMBOLS, pickTarget, resetCredit };
})();
