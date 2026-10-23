// Regression: after a NICE / BIG / MEGA win the celebration overlay must not
// swallow the next tap on 得分 / 全押 / 自動 (fixed in 20261023a).
// Usage: node tests/e2e/tier-overlay.e2e.mjs <url> [iterations=30]   (needs `playwright`)
import { webkit } from 'playwright';
const URL = process.argv[2] || 'http://localhost:8765/';
const N = +process.argv[3] || 30;
const MULTS = [4, 12, 30]; // NICE (×3+), BIG (×10+), MEGA (×25+)
const CONTROLS = ['collect', 'all', 'auto'];
const b = await webkit.launch();
const ctx = await b.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, hasTouch: true });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.addInitScript(() => localStorage.setItem('xiaomali.seenHelp.v1', '1'));
await p.goto(URL + (URL.includes('?') ? '&' : '?') + 'debug=1&cb=' + Date.now(), { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const ids = { collect: '#btnCollect', all: '#btnAll', auto: '#btnAuto', start: '#btnStart' };
const tap = async (k) => { const bb = await p.locator(ids[k]).boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); };
const st = () => p.evaluate(() => { const s = __xiaomali.state; return { credit: s.credit, win: s.win, bet: s.bets.reduce((a, c) => a + c, 0), auto: s.auto, busy: s.busy }; });
const idle = () => p.waitForFunction(() => !__xiaomali.state.busy, null, { timeout: 120000, polling: 'raf' });
const force = (m) => p.evaluate((m) => {
  const E = __xiaomali.E; const o = E.resolveRound;
  E.resolveRound = function (...a) {
    E.resolveRound = o; const r = o.apply(this, a); const tot = a[0].reduce((x, y) => x + y, 0);
    const lb = { type: 'lockBonus', seed: [{ i: 0, value: tot * m }], spins: [], count: 1, full: false, coins: tot * m, jpAward: 0, grand: 0, gained: tot * m };
    return { ...r, steps: [lb], win: tot * m, jpWin: 0 };
  };
}, m);
let swallowed = 0, ok = 0; const log = [];
await p.evaluate(() => { __xiaomali.state.credit = 50000; });
for (let i = 0; i < N; i++) {
  const m = MULTS[i % 3], ctl = CONTROLS[Math.floor(i / 3) % 3], skipFirst = i % 2 === 1;
  let s = await st(); if (!s.bet) { await tap('all'); await p.waitForTimeout(450); }
  await force(m); await p.waitForTimeout(500); // past the per-action cooldown of the previous tap
  await tap('start');
  if (!(await p.waitForFunction(() => __xiaomali.state.busy, null, { timeout: 3000 }).then(() => true, () => false))) {
    log.push(`#${i} start tap ignored: ${JSON.stringify(await st())} msg=${await p.evaluate(() => document.getElementById('msg').textContent)}`);
    continue;
  }
  if (skipFirst) { // tap the celebration itself to skip it, then the control right after settle
    const seen = await p.waitForSelector('.tier-celebrate:not(.out)', { timeout: 60000 }).then(() => true, () => false);
    if (!seen) { log.push(`#${i} ×${m} no celebration: ${JSON.stringify(await st())} msg=${await p.evaluate(() => document.getElementById('msg').textContent)}`); await idle(); continue; }
    await p.touchscreen.tap(220, 300);
  }
  await idle();
  const before = await st();
  const top = await p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e?.closest('button')?.id || e?.className?.toString() || e?.tagName; }, ids[ctl]);
  await tap(ctl); await p.waitForTimeout(300);
  const autoNow = (await st()).auto;
  if (ctl !== 'auto') await idle();
  const after = { ...(await st()), auto: autoNow };
  const hit = ctl === 'collect' ? after.win === 0 && after.credit === before.credit + before.win
    : ctl === 'all' ? after.bet > before.bet || after.win === 0
    : after.auto === true;
  if (hit) ok++; else { swallowed++; log.push(`#${i} ×${m} ${ctl} skip=${skipFirst} top=${top} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`); }
  if (after.auto || (await st()).auto) { // 自動 has a 400 ms tap cooldown: wait it out, then switch off
    await p.waitForTimeout(500); await tap('auto');
    await p.waitForFunction(() => !__xiaomali.state.auto, null, { timeout: 5000 }).catch(() => log.push(`#${i} auto did not switch off`));
  }
  await idle(); await p.waitForTimeout(200);
  const s2 = await st(); if (s2.win) { await tap('collect'); await idle(); await p.waitForTimeout(450); }
  const left = await p.evaluate(() => document.querySelectorAll('.tier-celebrate').length);
  if (left && !(await st()).busy) { await p.waitForTimeout(400); if (await p.evaluate(() => document.querySelectorAll('.tier-celebrate').length)) log.push(`#${i} overlay left in DOM`); }
}
console.log(log.join('\n'));
console.log(`tier-overlay taps: ${N} iterations, ok=${ok}, swallowed=${swallowed}, pageErrors=${errs.length}`);
await b.close();
process.exitCode = swallowed || errs.length || log.length ? 1 : 0;
