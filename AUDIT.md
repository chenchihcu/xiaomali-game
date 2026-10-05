# Audit — UI/UX · 機率／派彩 · 防呆（2026-10-05）

Scope: `/workspace/xiaomali` static game (`engine.js` / `game.js` / `index.html`).
Method: code review + `node sim.js` Monte-Carlo + targeted unit checks.

## Issues found → fixed

| # | Area | Issue | Fix |
|---|---|---|---|
| 1 | Math / RTP | All-on **標準** RTP ≈ **120%** (easy ≈176%); far above entertainment target ~90–100% | Raised `small` house-edge on presets; lowered stage chances (`SUPER_RUN` / `doubleRun` / `SLOT` / `FEVER` / classic `BONUS`); retuned easy/hard. Post-fix: easy≈122% · normal≈98% · hard≈81% · classic-no-bonus≈89% (`node sim.js 120000`) |
| 2 | Math | `resolveSlotBonus` paid using **max bet across symbols** when matched symbol had 0 bet (free ride) | Pay only `bets[si] * mult`; unmatched → show result, gained 0 |
| 3 | Math | `applyBingoMark` cleared cells **per line**, so shared-cell columns/diagonals were dropped on a full board (paid 3/8 instead of 8/8) | Detect all complete lines first, then clear union of cells |
| 4 | Math | `simulate()` grew JP pot **before** `resolveRound`; live play uses pot then `nextJpPot` | Simulate now mirrors live `nextJpPot` |
| 5 | 防呆 / UX | Settings dimmed / warned「中彩機率無效」when classic song/train/sanyuan off — but **三輪／FEVER still scale on `bonusRate`** | `usesBonusRate` includes `slotBonus` \|\| `fever`; hint text updated |
| 6 | 防呆 | `collect` / `collectInstant` / load could push CREDIT past `CREDIT_CAP` (999999); LED truncates | Cap credit on collect paths + load; leftover WIN kept with toast |
| 7 | 防呆 | Auto mode could **loop forever** collecting when CREDIT at cap and WIN residual | Stop auto with toast when cap blocks drain |

## Verified OK (no change)

- `why.*` guards + `.off` + toast deny for start/clear/all/bet/dbl/rebet/auto/collect/gamble/open/wash
- `validateSettings` / `snap` from slider min/max/step; fruit weights cannot all be 0
- `state.busy` set before any `await`; `guarded()` cooldowns
- JP: big BAR tile + BAR bet; pot growth `JP.rate × jpRate`; win fraction `bet/fullBet`
- ONCE MORE chain capped at `MAX_ONCE_MORE_CHAIN` (8)
- Bet unit 1–10, per-symbol cap 99, unpaid preview (`betsPaid`) charge on 開始
- Big/small: 1–4 / 6–9 / 5 push

## Remaining risks (not bugs, watch)

1. **Apple single-bet RTP** still low (~70% normal) vs mid fruits (~95%) — track has many apple tiles including ×3; intentional volume, uneven EV by symbol.
2. **Easy** still player-favored (~122%) by design; BAR/77 single-bet hotter than apple.
3. Slider UI max for rates is **2.0×** (`index.html`); `engine.normalizeSettings` allows **3** — console/`__xiaomali.setSettings` can exceed UI until `validateSettings` snaps to slider range.
4. `startCredit` slider max **5000** vs engine clamp **99999** — same pattern.
5. Bingo / stages / JP are entertainment features; RTP estimate in settings uses only **2500** rounds (noisy ± a few %).
6. No cryptographic RNG audit beyond `crypto.getRandomValues` float; fine for fake credit.
7. Gamble ×2 has no win ceiling other than later CREDIT_CAP on collect.

## How to re-check

```bash
node sim.js 120000
node --check engine.js && node --check game.js
```

DevTools: iPhone 16 Pro Max 430×932; exercise settings toggles (only 三輪/FEVER on → 中彩機率 still active); open CREDIT to cap then win + auto.
