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
  /** Max free light-runs (symbol stops) from ONCE MORE / 連跑 / 大 ONCE MORE in one round. */
  const MAX_ONCE_MORE_CHAIN = 8;

  /**
   * When the light lands on ONCE MORE, roll how many free re-runs to queue.
   * Chances scale with settings.onceRate. Toggled via modes.onceMulti / onceBig.
   *   single → 1 (classic)
   *   multi  → 2–5 sequential free stops that each pay if bet matches (連跑)
   *   big    → 3–5 guaranteed (大 ONCE MORE)
   */
  const ONCE_GRANT = {
    multiChance: 0.18,
    bigChance:   0.08,
    multiMin: 2, multiMax: 4,
    bigMin: 3, bigMax: 5,
  };

  /** Keys that have a weight multiplier in settings (8 symbols + ONCE MORE). */
  const WEIGHT_KEYS = [...SYMBOLS.map((s) => s.id), 'once', 'small'];

  // ---------------------------------------------------------------------------
  // Bonus modes ("LUCKY" events). Rolled once per round, after the light lands
  // on a symbol tile. Base chance × settings.bonusRate（中彩機率; only enabled modes).
  // ---------------------------------------------------------------------------
  const BONUS = {
    song:    { name: '送燈',     chance: 0.008 },  // 1–3 extra random lights
    train:   { name: '開火車',   chance: 0.004 },  // 2–5 consecutive lights after the stop
    sanyuan: { name: '三元四喜', chance: 0.0028 },  // 大三元 / 小三元 / 大四喜 sets
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
  const MODE_KEYS = [
    'once', 'onceMulti', 'onceBig', 'song', 'train', 'sanyuan', 'jp',
    'slotBonus', 'fever', 'bingo',
    'luckyWheel', 'gacha', 'sicbo', 'pachinko', 'ballDraw', 'roulette',
    'reverse', 'skip', 'doubleRun', 'fakeStop', 'superRun',
  ];
  const MODE_LABELS = {
    once: 'ONCE MORE',
    onceMulti: '連跑（再跑 2–4 次）',
    onceBig: '大 ONCE MORE（≥3 次）',
    song: '送燈',
    train: '開火車',
    sanyuan: '三元四喜',
    jp: 'JP 彩金',
    slotBonus: '三輪 Bonus',
    fever: 'FEVER 舞台',
    bingo: '賓果任務',
    luckyWheel: '幸運轉輪',
    gacha: '轉蛋',
    sicbo: '骰寶',
    pachinko: '彈珠台',
    ballDraw: '抽球機',
    roulette: '電子輪盤',
    reverse: '倒跑',
    skip: '跳格',
    doubleRun: '雙燈',
    fakeStop: '假停',
    superRun: '超跑（連停 3–8）',
  };

  /** Probabilities for optional light FX / stage entries (× bonusRate / onceRate where noted). */
  const LIGHT_FX = {
    reverse: 0.10,
    skip: 0.08,
    fakeStop: 0.12,
    doubleRun: 0.02,
  };
  const SUPER_RUN = { chance: 0.011, min: 3, max: 8 };
  const SLOT_BONUS = {
    chance: 0.020,
    freeSpinChance: 0.14,
    /** Full-size tiles that can open the 3-reel bonus stage. */
    special: ['seven', 'star', 'bar'],
  };
  const FEVER_STAGE = { chance: 0.012, minRuns: 2, maxRuns: 3 };

  /** Extra cabinet stages opened from special track hits (toggleable). Chances × bonusRate. */
  const STAGE_KEYS = ['luckyWheel', 'gacha', 'sicbo', 'pachinko', 'ballDraw', 'roulette'];
  const STAGE_ENTRY = {
    /** Shared roll chance when a special full tile (77/star/BAR) or ONCE MORE lands. */
    chance: 0.018,
    /** At most one of these mini-stages per round (keeps RTP in check). */
    maxPerRound: 1,
  };
  /** Lucky Wheel segments: relative weights + payout as floor(totalBet * mult / 4). */
  const WHEEL_SEGS = [
    { label: '×0',  mult: 0,  w: 10, tone: 'miss' },
    { label: '×1',  mult: 1,  w: 18, tone: 'low' },
    { label: '×2',  mult: 2,  w: 16, tone: 'low' },
    { label: '×3',  mult: 3,  w: 14, tone: 'mid' },
    { label: '×5',  mult: 5,  w: 12, tone: 'mid' },
    { label: '×8',  mult: 8,  w: 8,  tone: 'high' },
    { label: '×10', mult: 10, w: 6,  tone: 'high' },
    { label: '×15', mult: 15, w: 3,  tone: 'mega' },
    { label: '×20', mult: 20, w: 2,  tone: 'mega' },
    { label: 'JP!', mult: 30, w: 1,  tone: 'jp' },
  ];
  /** Gacha rarity table (weights). Pay = betOnSymbol × payMult. */
  const GACHA_TIERS = [
    { id: 'N',  name: 'N',  w: 48, payMult: 1,  glow: 'n' },
    { id: 'R',  name: 'R',  w: 28, payMult: 2,  glow: 'r' },
    { id: 'SR', name: 'SR', w: 16, payMult: 5,  glow: 'sr' },
    { id: 'SSR',name: 'SSR',w: 8,  payMult: 12, glow: 'ssr' },
  ];
  /** Sic Bo big/small/triple payouts vs totalBet (entertainment). */
  const SICBO_PAY = { small: 1, big: 1, triple: 8, point: 0 };
  /** Pachinko pockets left→right: multipliers for floor(totalBet * m / 4). */
  const PACHINKO_POCKETS = [
    { label: '×1', mult: 1, w: 14 },
    { label: '×2', mult: 2, w: 18 },
    { label: '×3', mult: 3, w: 16 },
    { label: '×5', mult: 5, w: 14 },
    { label: '×8', mult: 8, w: 10 },
    { label: 'JP', mult: 20, w: 4 },
    { label: '×3', mult: 3, w: 16 },
    { label: '×2', mult: 2, w: 18 },
    { label: '×1', mult: 1, w: 14 },
  ];
  /** Ball-draw cage: draw count + match pay as bet × mult. */
  const BALL_DRAW = { minBalls: 1, maxBalls: 3, matchMult: 2, tripleBonus: 5 };
  /** Compact electronic roulette 0–12 (0 green). Pay floor(totalBet * mult / 4). */
  const ROULETTE_N = 13;
  const ROULETTE_PAY = { number: 12, color: 2, evenOdd: 2, zero: 8 };
  /** 3×3 bingo cells → symbol id (once = wild filler cell). */
  const BINGO_CELLS = ['apple', 'orange', 'mango', 'bell', 'melon', 'star', 'seven', 'bar', 'once'];
  const BINGO_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  const BINGO_LINE_MULT = 1; // × ceil(totalBet/2) when a line completes

  const ones = () => Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 1]));
  /** Difficulty presets: per-symbol weight multipliers + bonus frequency. */
  // `small` scales the ×3 small-icon tiles — the main house-edge lever
  // (more ×3 stops = lower return). Run `node sim.js` after editing.
  const PRESETS = {
    easy: {
      label: '輕鬆',
      weights: { ...ones(), small: 0.95, once: 1.15, star: 1.05, seven: 1.05, bar: 1.05 },
      bonusRate: 1.25,
    },
    normal: {
      label: '標準',
      // small>1 = more ×3 stops = house edge (stages add RTP on top)
      weights: { ...ones(), small: 1.5 },
      bonusRate: 1,
    },
    hard: {
      label: '困難',
      weights: { ...ones(), small: 1.85, once: 0.65, bar: 0.75, seven: 0.85, star: 0.9 },
      bonusRate: 0.45,
    },
  };

  /** Traditional Chinese labels for weight keys (settings UI). */
  const WEIGHT_LABELS = {
    apple: '蘋果', orange: '柳橙', mango: '芒果', bell: '鈴鐺',
    melon: '西瓜', star: '星星', seven: '77', bar: 'BAR',
    once: 'ONCE MORE', small: '小圖 ×3',
  };

  const DEFAULT_SETTINGS = {
    preset: 'normal',
    weights: { ...PRESETS.normal.weights },
    bonusRate: 1,   // 中彩機率：送燈／開火車／三元四喜
    onceRate: 1,    // 連跑／大 ONCE MORE 觸發加乘
    jpRate: 1,      // JP 彩池累積倍率
    startCredit: 1000,
    betUnit: 1,
    sfxVol: 1,
    bgmVol: 1,
    modes: {
      once: true, onceMulti: true, onceBig: true, song: true, train: true, sanyuan: true, jp: true,
      slotBonus: true, fever: true, bingo: true,
      luckyWheel: true, gacha: true, sicbo: true, pachinko: true, ballDraw: true, roulette: true,
      reverse: true, skip: true, doubleRun: true, fakeStop: true, superRun: true,
    },
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
      onceRate: clamp(r.onceRate, 0, 3, d.onceRate),
      jpRate: clamp(r.jpRate, 0, 3, d.jpRate),
      startCredit: clamp(r.startCredit, 100, 99999, d.startCredit),
      betUnit: clamp(r.betUnit, 1, 10, d.betUnit),
      sfxVol: clamp(r.sfxVol, 0, 1, d.sfxVol),
      bgmVol: clamp(r.bgmVol, 0, 1, d.bgmVol),
      modes: Object.fromEntries(MODE_KEYS.map((k) => [k, typeof m[k] === 'boolean' ? m[k] : d.modes[k]])),
    };
  }

  function applyPreset(settings, key) {
    const p = PRESETS[key];
    if (!p) return settings;
    return {
      ...settings,
      preset: key,
      weights: { ...p.weights },
      bonusRate: p.bonusRate,
      onceRate: p.bonusRate,
      jpRate: key === 'easy' ? 1.2 : key === 'hard' ? 0.7 : 1,
    };
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

  /** Roll free-run grant when landing on an ONCE MORE tile. */
  function rollOnceGrant(settings, rng) {
    const or = settings.onceRate != null ? settings.onceRate : (settings.bonusRate || 1);
    const g = ONCE_GRANT;
    if (settings.modes.onceBig && rng() < g.bigChance * or) {
      const span = g.bigMax - g.bigMin + 1;
      return { grant: g.bigMin + Math.floor(rng() * span), variant: 'big' };
    }
    if (settings.modes.onceMulti && rng() < g.multiChance * or) {
      const span = g.multiMax - g.multiMin + 1;
      return { grant: g.multiMin + Math.floor(rng() * span), variant: 'multi' };
    }
    return { grant: 1, variant: 'single' };
  }

  /** Pick optional light FX for one light-run (animation hints for game.js). */
  function rollLightFx(settings, rng) {
    const m = settings.modes;
    const fx = { reverse: false, skip: false, fakeStop: false };
    if (m.reverse && rng() < LIGHT_FX.reverse) fx.reverse = true;
    if (m.skip && rng() < LIGHT_FX.skip) fx.skip = true;
    if (m.fakeStop && rng() < LIGHT_FX.fakeStop) fx.fakeStop = true;
    return fx;
  }

  /** Second stop for 雙燈 (avoids ONCE MORE / same tile). */
  function pickDoubleTarget(primary, weights, rng) {
    const alt = weights.map((w, i) => (i === primary || TRACK[i].s === 'once' ? 0 : w));
    if (alt.reduce((a, b) => a + b, 0) <= 0) return (primary + 1 + Math.floor(rng() * (N - 1))) % N;
    return pickWeighted(alt, rng);
  }

  function isSlotSpecial(tile) {
    return tile && !tile.small && SLOT_BONUS.special.includes(tile.s);
  }

  /**
   * Resolve a Pachislot-style 3-reel bonus. Pays from bets on matched symbols.
   * Returns { reels, match, mult, gained, freeSpin }.
   */
  function resolveSlotBonus(bets, rng) {
    const ids = SYMBOLS.map((s) => s.id);
    const reels = [ids[Math.floor(rng() * ids.length)], ids[Math.floor(rng() * ids.length)], ids[Math.floor(rng() * ids.length)]];
    // gentle nudge toward matches for entertainment feel
    if (rng() < 0.28) {
      reels[1] = reels[0];
      if (rng() < 0.45) reels[2] = reels[0];
    } else if (rng() < 0.2) {
      reels[2] = reels[1];
    }
    let match = 0;
    let payId = null;
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      match = 3;
      payId = reels[0];
    } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
      match = 2;
      payId = reels[0] === reels[1] ? reels[0] : (reels[1] === reels[2] ? reels[1] : reels[0]);
    }
    let mult = 0;
    let gained = 0;
    if (payId) {
      const si = SYM_INDEX[payId];
      const base = SYMBOLS[si].mult;
      mult = match === 3 ? Math.max(2, Math.floor(base / 10)) : 1;
      // Pay only when that symbol was bet — no free ride on another symbol's stake.
      const bet = bets[si] || 0;
      gained = bet * mult;
    }
    const freeSpin = match === 3 && rng() < SLOT_BONUS.freeSpinChance;
    return { reels, match, mult, gained, freeSpin, payId };
  }

  function pickWeightedItems(items, rng, wKey = 'w') {
    const weights = items.map((it) => Math.max(0, it[wKey] || 0));
    return items[pickWeighted(weights, rng)];
  }

  function stagePayFromTotal(totalBet, mult) {
    if (!mult || totalBet <= 0) return 0;
    return Math.max(0, Math.floor(totalBet * mult / 4));
  }

  /** Resolve Lucky Wheel: spin to a weighted segment. */
  function resolveLuckyWheel(totalBet, rng) {
    const seg = pickWeightedItems(WHEEL_SEGS, rng);
    const index = WHEEL_SEGS.indexOf(seg);
    const gained = stagePayFromTotal(totalBet, seg.mult);
    return {
      type: 'luckyWheel',
      index,
      label: seg.label,
      mult: seg.mult,
      tone: seg.tone,
      segments: WHEEL_SEGS.map((s) => ({ label: s.label, mult: s.mult, tone: s.tone })),
      gained,
    };
  }

  /** Resolve gacha capsule: tier + random symbol; pays only if that symbol was bet. */
  function resolveGacha(bets, rng) {
    const tier = pickWeightedItems(GACHA_TIERS, rng);
    const si = Math.floor(rng() * SYMBOLS.length);
    const sym = SYMBOLS[si];
    const bet = bets[si] || 0;
    const gained = bet * tier.payMult;
    return {
      type: 'gacha',
      tier: tier.id,
      tierName: tier.name,
      glow: tier.glow,
      payMult: tier.payMult,
      symbol: sym.id,
      symbolName: sym.name,
      icon: sym.icon,
      si,
      bet,
      gained,
    };
  }

  /** Resolve Sic Bo: 3 dice. Big 11–17 / Small 4–10 / Triple special. */
  function resolveSicbo(totalBet, rng) {
    const dice = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
    const sum = dice[0] + dice[1] + dice[2];
    const triple = dice[0] === dice[1] && dice[1] === dice[2];
    let outcome = 'point';
    let mult = SICBO_PAY.point;
    if (triple) {
      outcome = 'triple';
      mult = SICBO_PAY.triple;
    } else if (sum >= 11 && sum <= 17) {
      outcome = 'big';
      mult = SICBO_PAY.big;
    } else if (sum >= 4 && sum <= 10) {
      outcome = 'small';
      mult = SICBO_PAY.small;
    }
    // Entertainment: always pay small/big/triple vs totalBet (house edge via entry rate)
    const gained = stagePayFromTotal(totalBet, mult);
    return { type: 'sicbo', dice, sum, triple, outcome, mult, gained };
  }

  /** Light Pachinko: ball path through pegs into a pocket. */
  function resolvePachinko(totalBet, rng) {
    const pocket = pickWeightedItems(PACHINKO_POCKETS, rng);
    const index = PACHINKO_POCKETS.indexOf(pocket);
    // Fake peg path: sequence of column biases toward the pocket
    const cols = 9;
    const path = [];
    let col = 4;
    for (let row = 0; row < 8; row++) {
      const pull = index > col ? 0.62 : index < col ? 0.38 : 0.5;
      col += rng() < pull ? 1 : -1;
      col = Math.max(0, Math.min(cols - 1, col));
      path.push(col);
    }
    path.push(index);
    const gained = stagePayFromTotal(totalBet, pocket.mult);
    return {
      type: 'pachinko',
      index,
      label: pocket.label,
      mult: pocket.mult,
      path,
      pockets: PACHINKO_POCKETS.map((p) => ({ label: p.label, mult: p.mult })),
      gained,
    };
  }

  /** Ball-draw machine: pull 1–3 symbol balls; pay on bet matches. */
  function resolveBallDraw(bets, rng) {
    const n = BALL_DRAW.minBalls + Math.floor(rng() * (BALL_DRAW.maxBalls - BALL_DRAW.minBalls + 1));
    const balls = [];
    let gained = 0;
    const matched = [];
    for (let i = 0; i < n; i++) {
      const si = Math.floor(rng() * SYMBOLS.length);
      const sym = SYMBOLS[si];
      const bet = bets[si] || 0;
      const hit = bet > 0;
      const pay = hit ? bet * BALL_DRAW.matchMult : 0;
      gained += pay;
      if (hit) matched.push(sym.id);
      balls.push({ si, id: sym.id, name: sym.name, icon: sym.icon, hit, pay });
    }
    // Same-symbol triple bonus
    if (n === 3 && balls[0].id === balls[1].id && balls[1].id === balls[2].id) {
      const si = balls[0].si;
      const extra = (bets[si] || 0) * BALL_DRAW.tripleBonus;
      gained += extra;
      return { type: 'ballDraw', balls, matched, gained, triple: true, tripleBonus: extra };
    }
    return { type: 'ballDraw', balls, matched, gained, triple: false, tripleBonus: 0 };
  }

  /** Electronic roulette 0–12. Color / even-odd / number pays. */
  function resolveRoulette(totalBet, rng) {
    const n = Math.floor(rng() * ROULETTE_N); // 0..12
    const isZero = n === 0;
    const color = isZero ? 'green' : (n % 2 === 1 ? 'red' : 'black');
    const evenOdd = isZero ? 'zero' : (n % 2 === 0 ? 'even' : 'odd');
    // Entertainment auto-ticket: favor color hit (~50%), occasional number
    let kind = 'color';
    let mult = ROULETTE_PAY.color;
    const roll = rng();
    if (isZero) {
      kind = 'zero';
      mult = ROULETTE_PAY.zero;
    } else if (roll < 0.12) {
      kind = 'number';
      mult = ROULETTE_PAY.number;
    } else if (roll < 0.42) {
      kind = evenOdd;
      mult = ROULETTE_PAY.evenOdd;
    } else {
      kind = 'color';
      mult = ROULETTE_PAY.color;
    }
    const gained = stagePayFromTotal(totalBet, mult);
    return {
      type: 'roulette',
      number: n,
      color,
      evenOdd,
      kind,
      mult,
      gained,
      pockets: ROULETTE_N,
    };
  }

  /** Pick one enabled stage kind for a special-track entry (or null). */
  function pickStageKind(settings, rng) {
    const enabled = STAGE_KEYS.filter((k) => settings.modes[k]);
    if (!enabled.length) return null;
    return enabled[Math.floor(rng() * enabled.length)];
  }

  function resolveStage(kind, bets, totalBet, rng) {
    if (kind === 'luckyWheel') return resolveLuckyWheel(totalBet, rng);
    if (kind === 'gacha') return resolveGacha(bets, rng);
    if (kind === 'sicbo') return resolveSicbo(totalBet, rng);
    if (kind === 'pachinko') return resolvePachinko(totalBet, rng);
    if (kind === 'ballDraw') return resolveBallDraw(bets, rng);
    if (kind === 'roulette') return resolveRoulette(totalBet, rng);
    return null;
  }

    /** Mark bingo cell for a landed symbol; return completed lines (clears those cells). */
  function applyBingoMark(board, symId, totalBet, rng) {
    if (!board || board.length !== 9) board = new Array(9).fill(false);
    const next = board.slice();
    const cell = BINGO_CELLS.indexOf(symId);
    if (cell < 0) return { board: next, cell: -1, lines: [], gained: 0 };
    next[cell] = true;
    // Detect ALL completed lines on the post-mark board, then clear once
    // (sequential clear would drop shared-cell lines / columns / diagonals).
    const lines = [];
    for (const line of BINGO_LINES) {
      if (line.every((i) => next[i])) lines.push(line.slice());
    }
    let gained = 0;
    if (lines.length) {
      const pay = Math.max(1, Math.floor(totalBet / 4)) * BINGO_LINE_MULT;
      gained = pay * lines.length;
      const clear = new Set();
      for (const line of lines) for (const i of line) clear.add(i);
      for (const i of clear) next[i] = false;
    }
    return { board: next, cell, lines, gained };
  }

  /**
   * Resolve one full round without UI.
   * Returns { steps, win, jpWin, bingoBoard }.
   * Extra step types (all optional / mode-gated):
   *   land/once also carry `fx: { reverse, skip, fakeStop }`
   *   land may carry `double: { target, ...tilePay }` (雙燈)
   *   { type: 'super', stops:[{target,...pay}], gained } 超跑 3–8
   *   { type: 'slot', reels, match, mult, gained, freeSpin }
   *   { type: 'fever', runs:[{target,...pay}], gained }
   *   { type: 'bingo', cell, lines, gained, board }
   *   { type: 'luckyWheel'|'gacha'|'sicbo'|'pachinko'|'ballDraw'|'roulette' }
   *   { type: 'bonus' | 'jp' } — existing LUCKY / JP
   *
   * `bingoBoard` (bool[9]) is the board AFTER this round (pass previous via opts.bingoBoard).
   */
  function resolveRound(bets, settings, rng, jpPot = 0, opts = {}) {
    const s = settings || DEFAULT_SETTINGS;
    const weights = effectiveWeights(s);
    const steps = [];
    let win = 0;
    let jpWin = 0;
    let queue = 0;
    let freesDone = 0;
    let paidDone = false;
    let feverDone = false;
    let slotOpens = 0;
    let stageOpens = 0;
    const totalBet = bets.reduce((a, b) => a + b, 0);
    let bingoBoard = Array.isArray(opts.bingoBoard) && opts.bingoBoard.length === 9
      ? opts.bingoBoard.map(Boolean)
      : new Array(9).fill(false);

    const pushSlotChain = () => {
      if (!s.modes.slotBonus || slotOpens >= 3) return;
      slotOpens++;
      let spins = 0;
      do {
        const slot = resolveSlotBonus(bets, rng);
        steps.push({ type: 'slot', ...slot });
        win += slot.gained;
        spins++;
        if (!slot.freeSpin || spins >= 3) break;
      } while (true);
    };

    const tryPushCabinetStage = (force = false) => {
      if (stageOpens >= STAGE_ENTRY.maxPerRound) return false;
      const anyOn = STAGE_KEYS.some((k) => s.modes[k]);
      if (!anyOn) return false;
      const rate = STAGE_ENTRY.chance * (s.bonusRate || 1) * (force ? 1.35 : 1);
      if (!force && rng() >= rate) return false;
      if (force && rng() >= rate) return false;
      const kind = pickStageKind(s, rng);
      if (!kind) return false;
      const stage = resolveStage(kind, bets, totalBet, rng);
      if (!stage) return false;
      stageOpens++;
      steps.push(stage);
      win += stage.gained || 0;
      return true;
    };

    for (;;) {
      const fx = rollLightFx(s, rng);
      const target = pickWeighted(weights, rng);

      if (TRACK[target].s === 'once') {
        if (!s.modes.once) {
          if (paidDone && queue > 0) { queue--; freesDone++; }
          paidDone = true;
          steps.push({ type: 'land', target, si: -1, mult: 0, gained: 0, runsLeft: queue, fx });
          if (queue > 0) continue;
          break;
        }
        const rolled = rollOnceGrant(s, rng);
        const room = Math.max(0, MAX_ONCE_MORE_CHAIN - freesDone - queue);
        const grant = Math.min(rolled.grant, room);
        queue += grant;
        let variant = rolled.variant;
        if (grant <= 1 && variant !== 'big') variant = 'single';
        else if (grant >= 3 && variant === 'big') variant = 'big';
        else if (grant >= 2) variant = variant === 'big' ? 'big' : 'multi';
        steps.push({
          type: 'once',
          target,
          grant,
          remaining: queue,
          variant,
          capped: grant < rolled.grant,
          fx,
        });
        paidDone = true;
        // Bingo wild cell: occasional ONCE MORE mark
        if (s.modes.bingo && rng() < 0.35) {
          const bm = applyBingoMark(bingoBoard, 'once', totalBet, rng);
          bingoBoard = bm.board;
          if (bm.cell >= 0) {
            steps.push({ type: 'bingo', cell: bm.cell, lines: bm.lines, gained: bm.gained, board: bingoBoard.slice() });
            win += bm.gained;
          }
        }
        // Special track hit: ONCE MORE can open 三輪 Bonus when chain ends or mid-chain
        if (s.modes.slotBonus && rng() < SLOT_BONUS.chance * (s.bonusRate || 1)) {
          pushSlotChain();
        }
        // ONCE MORE also eligible for cabinet mini-stages (wheel / gacha / …)
        tryPushCabinetStage(false);
        if (queue <= 0) break;
        continue;
      }

      if (paidDone && queue > 0) {
        queue--;
        freesDone++;
      }
      paidDone = true;

      const p = tilePay(target, bets);
      const landStep = { type: 'land', target, ...p, runsLeft: queue, fx };

      // 雙燈: second independent stop that also pays
      if (s.modes.doubleRun && rng() < LIGHT_FX.doubleRun) {
        const t2 = pickDoubleTarget(target, weights, rng);
        const p2 = tilePay(t2, bets);
        landStep.double = { target: t2, ...p2 };
        win += p2.gained;
      }
      steps.push(landStep);
      win += p.gained;

      // Bingo mark only when the land paid (mission progress, not free fills)
      if (s.modes.bingo && p.gained > 0 && TRACK[target].s !== 'once') {
        const bm = applyBingoMark(bingoBoard, TRACK[target].s, totalBet, rng);
        bingoBoard = bm.board;
        if (bm.cell >= 0) {
          steps.push({ type: 'bingo', cell: bm.cell, lines: bm.lines, gained: bm.gained, board: bingoBoard.slice() });
          win += bm.gained;
        }
      }

      const bonus = rollBonus(target, s, rng);
      if (bonus) {
        const tiles = bonus.tiles.map((i) => ({ i, ...tilePay(i, bets) }));
        const gained = tiles.reduce((a, t) => a + t.gained, 0);
        steps.push({ type: 'bonus', kind: bonus.kind, name: bonus.name, target, tiles, gained });
        win += gained;
      }

      if (s.modes.jp && target === BIG_BAR_TILE && bets[SYM_INDEX.bar] > 0 && jpPot > 0 && jpWin === 0) {
        jpWin = Math.floor(jpPot * Math.min(1, bets[SYM_INDEX.bar] / JP.fullBet));
        if (jpWin > 0) steps.push({ type: 'jp', amount: jpWin });
      }

      // 超跑: 3–8 chained extra stops (special / paying lands)
      if (
        s.modes.superRun
        && queue === 0
        && (p.gained > 0 || isSlotSpecial(TRACK[target]))
        && rng() < SUPER_RUN.chance * (s.onceRate != null ? s.onceRate : 1)
      ) {
        const n = SUPER_RUN.min + Math.floor(rng() * (SUPER_RUN.max - SUPER_RUN.min + 1));
        const stops = [];
        let superGain = 0;
        for (let k = 0; k < n; k++) {
          const ti = pickWeighted(weights, rng);
          if (TRACK[ti].s === 'once') {
            stops.push({ target: ti, si: -1, mult: 0, gained: 0 });
            continue;
          }
          const tp = tilePay(ti, bets);
          stops.push({ target: ti, ...tp });
          superGain += tp.gained;
        }
        steps.push({ type: 'super', stops, gained: superGain, count: n });
        win += superGain;
      }

      // Special tile → 三輪 Bonus stage
      if (s.modes.slotBonus && isSlotSpecial(TRACK[target]) && rng() < SLOT_BONUS.chance * (s.bonusRate || 1)) {
        pushSlotChain();
      }

      // Special full tiles (77 / star / BAR) → cabinet mini-stages
      if (isSlotSpecial(TRACK[target])) {
        tryPushCabinetStage(false);
      }

      // FEVER stage after JP or big multiplier land
      if (
        s.modes.fever
        && !feverDone
        && (jpWin > 0 || p.mult >= 30)
        && rng() < FEVER_STAGE.chance * (s.bonusRate || 1) * (jpWin > 0 ? 2 : 1)
      ) {
        feverDone = true;
        const n = FEVER_STAGE.minRuns + Math.floor(rng() * (FEVER_STAGE.maxRuns - FEVER_STAGE.minRuns + 1));
        const runs = [];
        let feverGain = 0;
        for (let k = 0; k < n; k++) {
          const ti = pickWeighted(weights, rng);
          if (TRACK[ti].s === 'once') {
            runs.push({ target: ti, si: -1, mult: 0, gained: 0, fx: rollLightFx(s, rng) });
            continue;
          }
          const tp = tilePay(ti, bets);
          runs.push({ target: ti, ...tp, fx: rollLightFx(s, rng) });
          feverGain += tp.gained;
        }
        steps.push({ type: 'fever', runs, gained: feverGain, count: n });
        win += feverGain;
      }

      if (queue > 0) continue;
      break;
    }
    return { steps, win: win + jpWin, jpWin, bingoBoard };
  }

  /** Pot after a round: grows by JP.rate × jpRate × bet; a JP win resets it to the seed. */
  function nextJpPot(pot, totalBet, jpWin, settings) {
    const rate = JP.rate * (settings && settings.jpRate != null ? settings.jpRate : 1);
    const grown = Math.min(JP.max, pot + totalBet * rate);
    return jpWin > 0 ? JP.seed : grown;
  }

  /**
   * Monte-Carlo estimate for the settings UI / balance checks.
   * `bets` default = 全押 1 each. Returns { rtp, hitRate (round won more than bet), bonusRate, jpRate }.
   */
  function simulate(settings, rounds = 20000, rng = Math.random, bets = SYMBOLS.map(() => 1)) {
    const s = settings || DEFAULT_SETTINGS;
    const total = bets.reduce((a, b) => a + b, 0);
    let paid = 0, won = 0, hits = 0, bonuses = 0, jps = 0, pot = JP.seed;
    let bingoBoard = new Array(9).fill(false);
    for (let n = 0; n < rounds; n++) {
      // Match live play: resolve against current pot, then nextJpPot grows / resets.
      const r = resolveRound(bets, s, rng, s.modes.jp ? pot : 0, { bingoBoard });
      bingoBoard = r.bingoBoard || bingoBoard;
      paid += total;
      won += r.win;
      if (r.win > total) hits++;
      if (r.steps.some((st) => st.type === 'bonus' || st.type === 'slot' || st.type === 'fever' || st.type === 'super'
        || STAGE_KEYS.includes(st.type))) bonuses++;
      if (r.jpWin > 0) jps++;
      pot = nextJpPot(pot, total, r.jpWin, s);
    }
    return { rtp: won / paid, hitRate: hits / rounds, bonusRate: bonuses / rounds, jpRate: jps / rounds };
  }

  const api = {
    SYMBOLS, SYM_INDEX, TRACK, N, MAX_ONCE_MORE_CHAIN, ONCE_GRANT, WEIGHT_KEYS, WEIGHT_LABELS,
    BONUS, JP, BIG_BAR_TILE, MODE_KEYS, MODE_LABELS, PRESETS, DEFAULT_SETTINGS,
    LIGHT_FX, SUPER_RUN, SLOT_BONUS, FEVER_STAGE, BINGO_CELLS, BINGO_LINES, BINGO_LINE_MULT,
    STAGE_KEYS, STAGE_ENTRY, WHEEL_SEGS, GACHA_TIERS, SICBO_PAY, PACHINKO_POCKETS, BALL_DRAW, ROULETTE_N, ROULETTE_PAY,
    normalizeSettings, applyPreset, effectiveWeights, landingOdds, pickWeighted,
    tilePay, rollOnceGrant, rollLightFx, resolveSlotBonus,
    resolveLuckyWheel, resolveGacha, resolveSicbo, resolvePachinko, resolveBallDraw, resolveRoulette,
    pickStageKind, resolveStage, applyBingoMark, resolveRound, nextJpPot, simulate,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XiaomaliEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
