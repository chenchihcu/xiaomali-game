# Audit — 第二輪（觸控／Overlay／舞台／音效／Fit／數學＋全開機率）（2026-10-05）

Scope: `/workspace/xiaomali` after `e136cf0`.
Method: code review + `node sim.js` + all-modes trigger census + label/hint cross-check vs engine.

## Issues found → fixed

| # | Area | Issue | Fix |
|---|---|---|---|
| 1 | Busy / overlay | `start` / `collect` / `gamble` / cabinet stages lacked `try/finally` — a thrown await left `busy` stuck & stage overlay open | `try/finally` clears `busy`, `closeStageOverlay()`, `hideOnceBanner`, `FX.hideFever` |
| 2 | Tip / touch | `#firstTip` buttons used `click` only (same iOS lag as pre-audit deck) | Pointer capture + `pointerup` path (keyboard `detail===0`) |
| 3 | Fit | `visualViewport` `scroll` called `fitCabinet` constantly → hitboxes jumped mid-tap on iOS chrome | Listen to `resize` only |
| 4 | Rates | All modes ON: stages/slot/fever were near-zero (≈0.02–0.2%/round) | Raised `STAGE_ENTRY`/`SLOT_BONUS`/`FEVER`/`BONUS`/`SUPER_RUN`/`doubleRun`; broadened FEVER entry; stage pay `/4`→`/6`; gacha/wheel leaner; `small` house-edge 2.45 |
| 5 | Copy | Mode toggle labels/hints mismatched engine (FEVER「大獎」、三輪「特殊燈 only」、連跑次數、賓果給分、onceRate 未提超跑等) | `MODE_LABELS` / `MODE_HINTS` + help/settings hints aligned to actual triggers & pays |

## All-modes-ON trigger census (`node`, 70k rounds, normal)

| Mode | Round rate | Notes |
|---|---|---|
| once | ~3.7% | base ONCE MORE stops |
| song / train / sanyuan | ~1.9% / 1.2% / 1.0% | LUCKY after land |
| slotBonus | ~0.7% | special / ONCE |
| fever | ~0.9% | JP / mult≥20 / special / solid hit |
| superRun | ~1.4% | paying/special, × onceRate |
| jp | ~0.2% | rare by design (progressive) |
| doubleRun | ~3.0% | land FX |
| reverse / skip / fakeStop | ~10% / 8% / 12% of light FX rolls | already meaningful |
| cabinet stages (sum) | ~1.8% | ≤1/round; each kind ~0.3% when all six on |
| bingo | marks on paying lands; line clears ~0.3% | progression, not a rare drop |

## RTP (`node sim.js 100000`)

| Preset | 全押 RTP |
|---|---|
| 輕鬆 | ≈127% |
| **標準** | **≈100%** |
| 困難 | ≈82% |
| 標準無彩蛋 | ≈79% (higher `small` house edge; intentional tradeoff for all-on balance) |

## Verified OK

- Force stage entry still skips rate roll (capped by `maxPerRound`)
- Deck `bindTap` / 開分 commit-on-up / fruit hold-repeat unchanged
- First-tip sits over glass, not deck
- Labels/hints printed from `MODE_LABELS`/`MODE_HINTS` match engine code paths

## Remaining risks (watch)

1. Apple single-bet RTP still low vs mid fruits.
2. Sic Bo / roulette entertainment tickets usually pay once entered (edge = entry rate).
3. 標準無彩蛋 RTP dipped with higher `small` — raise fruit weights or lower `small` if classic-only players complain.
4. Individual cabinet kinds share one entry slot (~0.3% each when all six on); turn some off to concentrate rate.
5. No crypto RNG audit beyond `crypto.getRandomValues` float.

## How to re-check

```bash
node --check engine.js && node --check game.js
node sim.js 120000
```

DevTools iPhone 16 Pro Max: tip dismiss via touch; mid-round exception must not leave greyed deck; Settings → 玩法開關 hints match one spin of each mode.
