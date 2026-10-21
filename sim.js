// Balance check (Node only, not loaded by the game):  node sim.js [rounds]
const E = require('./engine.js');
const rounds = +process.argv[2] || 400000;
const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';
const row = (label, s) => {
  const all = E.simulate(s, rounds);
  const per = E.SYMBOLS.map((sym, i) => {
    const bets = E.SYMBOLS.map((_, j) => (j === i ? 1 : 0));
    return sym.name + ' ' + pct(E.simulate(s, rounds / 4, Math.random, bets).rtp).trim();
  });
  console.log(`${label.padEnd(10)} 全押RTP ${pct(all.rtp)}  贏面 ${pct(all.hitRate)}  LUCKY ${pct(all.bonusRate)}  JP ${(all.jpRate * 100).toFixed(2)}%`);
  console.log('           單押RTP: ' + per.join('  '));
};
for (const k of Object.keys(E.PRESETS)) row(E.PRESETS[k].label, E.applyPreset(E.normalizeSettings({}), k));
const off = E.normalizeSettings({ modes: { song: false, train: false, sanyuan: false, jp: false } });
row('標準無彩蛋', off);


// HOLD 鎖燈 Bonus: RTP impact (標準 on vs off) + trigger / fill stats.
{
  const on = E.applyPreset(E.normalizeSettings({}), 'normal');
  const offL = E.applyPreset(E.normalizeSettings({ modes: { lockBonus: false } }), 'normal');
  const a = E.simulate(on, rounds), b = E.simulate(offL, rounds);
  let trig = 0, full = 0, gain = 0, jp = 0, locks = 0;
  const bets = E.SYMBOLS.map(() => 1), total = bets.length;
  for (let n = 0; n < rounds; n++) {
    const st = E.resolveRound(bets, on, Math.random, E.JP.seed).steps.find((x) => x.type === 'lockBonus');
    if (!st) continue;
    trig++; locks += st.count; gain += st.gained; if (st.full) { full++; jp += st.jpAward; }
  }
  const lb = E.LOCK_BONUS;
  const n = Math.max(1, trig);
  console.log(`鎖燈Bonus  標準 開 ${pct(a.rtp)} / 關 ${pct(b.rtp)}（蒙地卡羅，含雜訊）  直接貢獻 +${((gain + jp) / (rounds * total) * 100).toFixed(2)}pt RTP`);
  console.log(`           觸發 ${(trig / rounds * 100).toFixed(3)}%（約 1/${Math.round(rounds / n)} 局）  平均鎖 ${(locks / n).toFixed(1)}/24  平均獎 ${(gain / n / total).toFixed(2)}×押  全亮 ${(full / n * 100).toFixed(2)}%`);
  // Isolated resolver sanity: respins reset rule + bounds
  let ok = true;
  for (let k = 0; k < 20000 && ok; k++) {
    const r = E.resolveLockBonus(8, Math.random, 300, true);
    let left = lb.respins;
    for (const sp of r.spins) { left = sp.newLocks.length ? lb.respins : left - 1; if (sp.respinsLeft !== left) ok = false; }
    if (r.count > 24 || r.count < lb.seed || (r.full && r.jpAward !== 300) || (!r.full && left !== 0)) ok = false;
  }
  console.log(ok ? 'lockBonus rules  OK' : 'lockBonus rules  FAIL');
}

// Sanity: JP pot must freeze when modes.jp is off (engine nextJpPot).
{
  const off = E.normalizeSettings({ modes: { jp: false } });
  let pot = E.JP.seed;
  for (let i = 0; i < 200; i++) pot = E.nextJpPot(pot, 8, 0, off);
  const ok = Math.abs(pot - E.JP.seed) < 1e-9;
  console.log(ok ? 'JP-off pot freeze  OK' : `JP-off pot freeze  FAIL pot=${pot}`);
}
