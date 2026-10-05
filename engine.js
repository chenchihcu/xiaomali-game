/* 小瑪莉 game engine — pure logic, no DOM.
 * Loaded by index.html before game.js (exposes `window.XiaomaliEngine`),
 * and usable from Node for balance checks:  `node sim.js`
 * All money is fake play credit.
 */
(function (root) {
  'use strict';

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
   *   w     base weight (relative chance the light stops here, before settings)
   * Effective weight = w × settings.weights[s]  (see effectiveWeights).
   */
  const TRACK = [
    // top row (left → right)
    { s: 'orange', w: 3 },
    { s: 'bell',   w: 3 },
    { s: 'bar',    small: true, pay: 50, w: 0.8 },
    { s: 'bar',    w: 0.5 },
    { s: 'apple',  w: 3 },
    { s: 'melon',  small: true, pay: 3, w: 14 },
    { s: 'mango',  w: 3 },
    // right column (top → bottom)
    { s: 'melon',  w: 3 },
    { s: 'apple',  w: 3 },
    { s: 'once',   w: 4.175 },
    { s: 'orange', small: true, pay: 3, w: 14 },
    { s: 'star',   w: 2.4 },
    { s: 'mango',  small: true, pay: 3, w: 14 },
    // bottom row (right → left)
    { s: 'seven',  w: 1.95 },
    { s: 'apple',  w: 3 },
    { s: 'bell',   small: true, pay: 3, w: 14 },
    { s: 'seven',  small: true, pay: 3, w: 5.6 },
    { s: 'apple',  w: 3 },
    { s: 'orange', w: 3 },
    // left column (bottom → top)
    { s: 'apple',  w: 3 },
    { s: 'star',   small: true, pay: 3, w: 8.4 },
    { s: 'once',   w: 4.175 },
    { s: 'mango',  w: 3 },
    { s: 'apple',  w: 3 },
  ];
  const N = TRACK.length; // 24
  const MAX_ONCE_MORE_CHAIN = 5;

  /** Keys that have a weight multiplier in settings (8 symbols + ONCE MORE). */
  const WEIGHT_KEYS = [...SYMBOLS.map((s) => s.id), 'once', 'small'];

  // ---------------------------------------------------------------------------
  // Bonus modes ("LUCKY" events). Rolled once per round, after the light lands
  // on a symbol tile. Base chance × settings.bonusRate (only enabled modes).
  // ---------------------------------------------------------------------------
  const BONUS = {
    song:    { name: '送燈',     chance: 0.010 },  // 1–3 extra random lights
    train:   { name: '開火車',   chance: 0.005 },  // 2–5 consecutive lights after the stop
    sanyuan: { name: '三元四喜', chance: 0.0035 },  // 大三元 / 小三元 / 大四喜 sets
  };
  /** JP: landing on the big BAR tile with a BAR bet wins the progressive pot. */
  const JP = {
    seed: 200,          // pot after a JP is won / on first play
    rate: 0.03,         // pot grows by 3% of every credit bet (fake credit, not deducted)
    fullBet: 10,        // BAR bet ≥ 10 wins 100% of the pot; less wins bet/10 of it
    max: 99999,
  };
  const BIG_BAR_TILE = TRACK.findIndex((t) => t.s === 'bar' && !t.small);

  // ---------------------------------------------------------------------------
  // Settings + presets
  // ---------------------------------------------------------------------------
  const MODE_KEYS = ['once', 'song', 'train', 'sanyuan', 'jp'];
  const MODE_LABELS = {
    once: 'ONCE MORE 再跑一次',
    song: '送燈（多燈）',
    train: '開火車（連燈）',
    sanyuan: '大三元／小三元／大四喜',
    jp: 'JP 累積彩金',
  };

  const ones = () => Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 1]));
  /** Difficulty presets: per-symbol weight multipliers + bonus frequency. */
  // `small` scales the ×3 small-icon tiles — the main house-edge lever
  // (more ×3 stops = lower return). Run `node sim.js` after editing.
  const PRESETS = {
    easy: {
      label: '輕鬆',
      weights: { ...ones(), small: 0.6, once: 1.3, star: 1.1, seven: 1.1, bar: 1.2 },
      bonusRate: 1.8,
    },
    normal: {
      label: '標準',
      weights: { ...ones() },
      bonusRate: 1,
    },
    hard: {
      label: '困難',
      weights: { ...ones(), small: 1.7, once: 0.7, bar: 0.8 },
      bonusRate: 0.5,
    },
  };

  const DEFAULT_SETTINGS = {
    preset: 'normal',
    weights: { ...PRESETS.normal.weights },
    bonusRate: 1,
    modes: { once: true, song: true, train: true, sanyuan: true, jp: true },
  };

  const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);

  function normalizeSettings(raw) {
    const d = DEFAULT_SETTINGS;
    const r = raw && typeof raw === 'object' ? raw : {};
    const w = r.weights && typeof r.weights === 'object' ? r.weights : {};
    const m = r.modes && typeof r.modes === 'object' ? r.modes : {};
    return {
      preset: ['easy', 'normal', 'hard', 'custom'].includes(r.preset) ? r.preset : d.preset,
      weights: Object.fromEntries(WEIGHT_KEYS.map((k) => [k, clamp(w[k], 0, 3, d.weights[k])])),
      bonusRate: clamp(r.bonusRate, 0, 3, d.bonusRate),
      modes: Object.fromEntries(MODE_KEYS.map((k) => [k, typeof m[k] === 'boolean' ? m[k] : d.modes[k]])),
    };
  }

  function applyPreset(settings, key) {
    const p = PRESETS[key];
    if (!p) return settings;
    return { ...settings, preset: key, weights: { ...p.weights }, bonusRate: p.bonusRate };
  }

  /** Per-tile weights after settings. Falls back to base weights if all are 0. */
  function effectiveWeights(settings) {
    const s = settings || DEFAULT_SETTINGS;
    const w = TRACK.map((t) => {
      if (t.s === 'once' && !s.modes.once) return 0;
      const small3 = t.small && t.pay === 3 ? (s.weights.small ?? 1) : 1;
      return t.w * (s.weights[t.s] ?? 1) * small3;
    });
    if (w.reduce((a, b) => a + b, 0) <= 0) return TRACK.map((t) => (t.s === 'once' ? 0 : t.w));
    return w;
  }

  /** Probability the light stops on each weight key (for the settings UI). */
  function landingOdds(settings) {
    const w = effectiveWeights(settings);
    const total = w.reduce((a, b) => a + b, 0);
    const out = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 0]));
    TRACK.forEach((t, i) => {
      out[t.s] += w[i] / total;
      if (t.small && t.pay === 3) out.small += w[i] / total;
    });
    return out;
  }

  function pickWeighted(weights, rng) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
    return 0;
  }

  /** Payout of a single lit tile for the given bets. */
  function tilePay(i, bets) {
    const t = TRACK[i];
    if (t.s === 'once') return { si: -1, mult: 0, gained: 0 };
    const si = SYM_INDEX[t.s];
    const mult = t.small ? t.pay : SYMBOLS[si].mult;
    return { si, mult, gained: (bets[si] || 0) * mult };
  }

  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const fullTiles = (ids) => TRACK.map((t, i) => (ids.includes(t.s) && !t.small ? i : -1)).filter((i) => i >= 0);

  /** Roll a LUCKY bonus after landing on `target`. Returns null or { kind, name, tiles }. */
  function rollBonus(target, settings, rng) {
    const r = rng();
    let acc = 0;
    for (const kind of ['song', 'train', 'sanyuan']) {
      if (!settings.modes[kind]) continue;
      acc += BONUS[kind].chance * settings.bonusRate;
      if (r < acc) return buildBonus(kind, target, rng);
    }
    return null;
  }

  function buildBonus(kind, target, rng) {
    if (kind === 'song') {
      const n = 1 + Math.floor(rng() * 3);
      const pool = TRACK.map((t, i) => i).filter((i) => i !== target && TRACK[i].s !== 'once');
      return { kind, name: `送燈 ×${n}`, tiles: shuffled(pool, rng).slice(0, n) };
    }
    if (kind === 'train') {
      const n = 2 + Math.floor(rng() * 4); // 2–5 cars after the stop tile
      const tiles = [];
      for (let k = 1; k <= n; k++) tiles.push((target + k) % N);
      return { kind, name: `開火車 ${n + 1} 連燈`, tiles };
    }
    // sanyuan family
    const pick = Math.floor(rng() * 3);
    if (pick === 0) return { kind, name: '大三元', tiles: fullTiles(['seven', 'star', 'melon']).filter((i) => i !== target) };
    if (pick === 1) return { kind, name: '小三元', tiles: fullTiles(['orange', 'mango', 'bell']).filter((i) => i !== target) };
    const apples = fullTiles(['apple']).filter((i) => i !== target);
    return { kind, name: '大四喜', tiles: shuffled(apples, rng).slice(0, 4) };
  }

  /**
   * Resolve one full round (incl. ONCE MORE chain + bonus + JP) without any UI.
   * Returns { steps, win, jpWin }. Steps (in order) drive the animation:
   *   { type: 'once', target, chain }
   *   { type: 'land', target, si, mult, gained }
   *   { type: 'bonus', kind, name, target, tiles: [{ i, si, mult, gained }], gained }
   *   { type: 'jp', amount }
   */
  function resolveRound(bets, settings, rng, jpPot = 0) {
    const s = settings || DEFAULT_SETTINGS;
    const weights = effectiveWeights(s);
    const steps = [];
    let win = 0;
    let jpWin = 0;
    let chain = 0;
    for (;;) {
      const target = pickWeighted(weights, rng);
      if (TRACK[target].s === 'once') {
        steps.push({ type: 'once', target, chain });
        if (chain < MAX_ONCE_MORE_CHAIN) { chain++; continue; }
        break; // chain cap reached: round ends with no payout
      }
      const p = tilePay(target, bets);
      steps.push({ type: 'land', target, ...p });
      win += p.gained;

      const bonus = rollBonus(target, s, rng);
      if (bonus) {
        const tiles = bonus.tiles.map((i) => ({ i, ...tilePay(i, bets) }));
        const gained = tiles.reduce((a, t) => a + t.gained, 0);
        steps.push({ type: 'bonus', kind: bonus.kind, name: bonus.name, target, tiles, gained });
        win += gained;
      }
      if (s.modes.jp && target === BIG_BAR_TILE && bets[SYM_INDEX.bar] > 0 && jpPot > 0) {
        jpWin = Math.floor(jpPot * Math.min(1, bets[SYM_INDEX.bar] / JP.fullBet));
        if (jpWin > 0) steps.push({ type: 'jp', amount: jpWin });
      }
      break;
    }
    return { steps, win: win + jpWin, jpWin };
  }

  /** Pot after a round: grows by JP.rate × bet; a JP win resets it to the seed. */
  function nextJpPot(pot, totalBet, jpWin) {
    const grown = Math.min(JP.max, pot + totalBet * JP.rate);
    return jpWin > 0 ? JP.seed : grown;
  }

  /**
   * Monte-Carlo estimate for the settings UI / balance checks.
   * `bets` default = 全押 1 each. Returns { rtp, hitRate (round won more than bet), bonusRate, jpRate }.
   */
  function simulate(settings, rounds = 20000, rng = Math.random, bets = SYMBOLS.map(() => 1)) {
    const total = bets.reduce((a, b) => a + b, 0);
    let paid = 0, won = 0, hits = 0, bonuses = 0, jps = 0, pot = JP.seed;
    for (let n = 0; n < rounds; n++) {
      pot = Math.min(JP.max, pot + total * JP.rate);
      const r = resolveRound(bets, settings, rng, settings.modes.jp ? pot : 0);
      paid += total;
      won += r.win;
      if (r.win > total) hits++; // net profit this round
      if (r.steps.some((s) => s.type === 'bonus')) bonuses++;
      if (r.jpWin > 0) { jps++; pot = JP.seed; }
    }
    return { rtp: won / paid, hitRate: hits / rounds, bonusRate: bonuses / rounds, jpRate: jps / rounds };
  }

  const api = {
    SYMBOLS, SYM_INDEX, TRACK, N, MAX_ONCE_MORE_CHAIN, WEIGHT_KEYS,
    BONUS, JP, BIG_BAR_TILE, MODE_KEYS, MODE_LABELS, PRESETS, DEFAULT_SETTINGS,
    normalizeSettings, applyPreset, effectiveWeights, landingOdds, pickWeighted,
    tilePay, resolveRound, nextJpPot, simulate,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XiaomaliEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
