// node --test tests/  — progress sanitizer (localStorage saves + imported backups).
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

const finite = (o) => {
  for (const k of ['credit', 'win', 'pos', 'bingoLineWins']) assert.ok(Number.isFinite(o[k]) && o[k] >= 0, `${k}=${o[k]}`);
  if (o.jp !== null) assert.ok(Number.isFinite(o.jp) && o.jp >= 0);
};

test('rejects saves without usable credit', () => {
  for (const d of [null, undefined, 'x', 42, {}, { credit: 'abc' }, { credit: null }, { credit: NaN }, { credit: true }, { credit: [] }]) {
    assert.equal(E.sanitizeProgress(d), null, JSON.stringify(d));
  }
});

test('NaN-safe defaults for every field', () => {
  const p = E.sanitizeProgress({ credit: 500, win: 'x', pos: 'y', jp: 'NaN', bingo: [1, 2], holdCount: -9, lastBets: 'abc', lastPlayedBets: [1, 2], bingoLineWins: {} });
  finite(p);
  assert.equal(p.credit, 500); assert.equal(p.win, 0); assert.equal(p.pos, 0);
  assert.equal(p.jp, null); assert.equal(p.bingo, null); assert.equal(p.holdCount, 0);
  assert.equal(p.bets, null); assert.equal(p.lastPlayedBets, null);
});

test('clamps huge / negative values', () => {
  const p = E.sanitizeProgress({ credit: 1e30, win: -5, pos: -5, jp: 1e12, holdCount: 99, lastBets: [1e9, -3, 'x', 2.7, null, 5, 5, 5] });
  assert.equal(p.credit, 999999); assert.equal(p.win, 0); assert.equal(p.pos, 19);
  assert.equal(p.jp, E.JP.max); assert.equal(p.holdCount, 4);
  assert.deepEqual(p.bets, [99, 0, 0, 2, 0, 5, 5, 5]);
});

test('numeric strings are accepted', () => {
  const p = E.sanitizeProgress({ credit: '700', win: '12', pos: '30' });
  assert.equal(p.credit, 700); assert.equal(p.win, 12); assert.equal(p.pos, 6);
});

test('pending round is settled (no refund, no loss)', () => {
  const p = E.sanitizeProgress({ credit: 992, win: 0, jp: 300, pending: { kind: 'round', win: 256, gained: 256, jp: 200, bingo: new Array(9).fill(true), bingoLineWins: 3 } });
  assert.equal(p.credit, 992);
  assert.deepEqual({ win: p.pending.win, jp: p.pending.jp, lines: p.pending.bingoLineWins, kind: p.pending.kind }, { win: 256, jp: 200, lines: 3, kind: 'round' });
  const bad = E.sanitizeProgress({ credit: 10, pending: { win: 'x' } });
  assert.equal(bad.pending, null);
  const g = E.sanitizeProgress({ credit: 10, win: 50, pending: { kind: 'gamble', win: 1e9, jp: -1 } });
  assert.equal(g.pending.win, 999999); assert.equal(g.pending.jp, null);
});

test('import backup wrapper shape', () => {
  const backup = { app: 'xiaomali', v: 1, progress: { credit: 1234, win: 'oops' } };
  const p = E.sanitizeProgress(backup.progress);
  finite(p); assert.equal(p.credit, 1234); assert.equal(p.win, 0);
});
