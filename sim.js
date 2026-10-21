// Balance + rules check (Node only, not loaded by the game):  node sim.js [rounds]
// Exits non-zero when any assertion fails (used by CI).
const E = require('./engine.js');
const rounds = +process.argv[2] || 400000;
const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';
// Deterministic RNG so CI bands are reproducible (mulberry32).
const seeded = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); if (!ok) failed++; };
const rtp = {};
const row = (key, label, s) => {
  const all = E.simulate(s, rounds, seeded(20261021));
  rtp[key] = all.rtp;
  const per = E.SYMBOLS.map((sym, i) => {
    const bets = E.SYMBOLS.map((_, j) => (j === i ? 1 : 0));
    return sym.name + ' ' + pct(E.simulate(s, rounds / 4, seeded(7 + i), bets).rtp).trim();
  });
  console.log(`${label.padEnd(10)} 全押RTP ${pct(all.rtp)}  贏面 ${pct(all.hitRate)}  LUCKY ${pct(all.bonusRate)}  JP ${(all.jpRate * 100).toFixed(2)}%`);
  console.log('           單押RTP: ' + per.join('  '));
};
for (const k of Object.keys(E.PRESETS)) row(k, E.PRESETS[k].label, E.applyPreset(E.normalizeSettings({}), k));
// 標準 preset with the egg modes off (same weights as 標準, only the modes differ).
row('normalNoEggs', '標準無彩蛋', E.applyPreset(E.normalizeSettings({ modes: { song: false, train: false, sanyuan: false, jp: false } }), 'normal'));

// RTP bands (deterministic seed; widen only with a reason).
const BANDS = { easy: [1.20, 1.32], normal: [0.985, 1.005], hard: [0.78, 0.88] };
for (const [k, [lo, hi]] of Object.entries(BANDS)) check(rtp[k] >= lo && rtp[k] <= hi, `RTP ${k} ${pct(rtp[k])} ∈ [${(lo * 100).toFixed(1)}%, ${(hi * 100).toFixed(1)}%]`);
check(rtp.hard < rtp.normal && rtp.normal < rtp.easy, '難度排序 hard < normal < easy');

// HOLD 鎖燈 Bonus stats + rules
{
  const on = E.applyPreset(E.normalizeSettings({}), 'normal');
  const rng = seeded(99);
  let trig = 0, full = 0, gain = 0, jp = 0, locks = 0;
  const bets = E.SYMBOLS.map(() => 1), total = bets.length;
  for (let n = 0; n < rounds; n++) {
    const st = E.resolveRound(bets, on, rng, E.JP.seed).steps.find((x) => x.type === 'lockBonus');
    if (!st) continue;
    trig++; locks += st.count; gain += st.gained; if (st.full) { full++; jp += st.jpAward; }
  }
  const n = Math.max(1, trig);
  console.log(`鎖燈Bonus  觸發 ${(trig / rounds * 100).toFixed(3)}%（約 1/${Math.round(rounds / n)} 局）  平均鎖 ${(locks / n).toFixed(1)}/24  平均獎 ${(gain / n / total).toFixed(2)}×押  全亮 ${(full / n * 100).toFixed(2)}%  直接貢獻 +${((gain + jp) / (rounds * total) * 100).toFixed(2)}pt`);
  check(trig > 0 && rounds / n > 300 && rounds / n < 800, '鎖燈觸發率約 1/500');

  const lb = E.LOCK_BONUS; const r2 = seeded(5);
  let ok = true, fulls = 0;
  for (let k = 0; k < 20000 && ok; k++) {
    const share = [0, 0.1, 0.5, 1][k % 4];
    const r = E.resolveLockBonus(8, r2, 300, true, share);
    let left = lb.respins;
    for (const sp of r.spins) { left = sp.newLocks.length ? lb.respins : left - 1; if (sp.respinsLeft !== left) ok = false; }
    if (r.count > 24 || r.count < lb.seed || (!r.full && left !== 0)) ok = false;
    if (r.full) {
      fulls++;
      const shareAward = Math.floor(300 * share), grand = lb.grandMult * 8;
      const expJp = shareAward > grand ? shareAward : 0;
      if (r.jpAward !== expJp || r.grand !== (expJp ? 0 : grand) || r.gained !== r.coins + r.grand) ok = false;
    } else if (r.jpAward || r.grand) ok = false;
  }
  check(ok, `鎖燈規則（重轉重置、上下限、全亮＝max(JP×押BAR比例, GRAND)）fulls=${fulls}`);
  // JP share mirrors the normal JP rule: BAR bet 10 → full pot, BAR 1 → 10%.
  const fullOf = (share) => { const r3 = seeded(1); for (;;) { const r = E.resolveLockBonus(1, r3, 5000, true, share); if (r.full) return r; } };
  check(fullOf(1).jpAward === 5000 && fullOf(0.1).jpAward === 500 && fullOf(0).jpAward === 0, '鎖燈 JP 依押 BAR 比例');
}

// JP pot must freeze when modes.jp is off.
{
  const off = E.normalizeSettings({ modes: { jp: false } });
  let pot = E.JP.seed;
  for (let i = 0; i < 200; i++) pot = E.nextJpPot(pot, 8, 0, off);
  check(Math.abs(pot - E.JP.seed) < 1e-9, 'JP 關閉時彩池凍結');
}

// Progress sanitizer smoke (full cases in tests/progress.test.js).
{
  const p = E.sanitizeProgress({ credit: 500, win: 'x', pos: -5 });
  check(p && p.win === 0 && p.pos === 19 && p.credit === 500, 'sanitizeProgress NaN-safe');
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exitCode = 1; } else console.log('\nall checks passed');
