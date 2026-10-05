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

// Sanity: JP pot must freeze when modes.jp is off (engine nextJpPot).
{
  const off = E.normalizeSettings({ modes: { jp: false } });
  let pot = E.JP.seed;
  for (let i = 0; i < 200; i++) pot = E.nextJpPot(pot, 8, 0, off);
  const ok = Math.abs(pot - E.JP.seed) < 1e-9;
  console.log(ok ? 'JP-off pot freeze  OK' : `JP-off pot freeze  FAIL pot=${pot}`);
}
