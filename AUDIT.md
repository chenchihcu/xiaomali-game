# Audit — 十輪連續全面稽核（2026-10-05）

Scope: `/workspace/xiaomali` from `039f674` → `725e80c`.
Method: code review + `node --check` + `node sim.js` + forceStage / win-sum / bingo / train / 雙燈 probes each pass.

## Pass summary (newest first)

| Pass | SHA | Fixes |
|---|---|---|
| **10** | `725e80c` | Mid-spin/exception **freeze `holdCount`** (JP’s `holdsSet(4)` no longer sticks after refresh/abort); JP hint「僅開啟時累積」; AGENTS notes |
| **9** | `1cdfbdc` | LINE title→累計賓果連線; `estimateLightMs` +40ms skip-align; `applyBingoMark` `_rng` |
| **8** | `24cfbff` | **LINE meter** was always ~0 (board clears on hit) → lifetime `bingoLineWins` + persist + roundPersist freeze |
| **7** | `a41f549` | Mini-stage **`cabinet.stage-open`** disables deck taps; bingo hint/help cover 雙燈 marks |
| **6** | `7798c57` | **`animGen`** aborts orphan `spinReels` / 三輪 RAF after round `finally` (exception soft-lock) |
| **5** | `8fbb9b6` | **`nextJpPot` only while `modes.jp`**; 洗分/重設 clear hold lamps |
| **4** | `d62556a` | **雙燈 paying second lamp marks bingo**; hold flash timeout 1.6s |
| **3** | `5a06852` | Block settings/help while busy/confirm; reel estimate ~2.5 laps; 比大小 at WIN cap toast |
| **2** | `e16912c` | ONCE banner shows「結束」; **resize skips `idleReels` while busy**; dialog lock in `why.*`; 全押 unpaid afford=`betUnit` |
| **1** | `900bd8b` | **開火車 skips ONCE MORE**; 三元/四喜 full set lamps (land pay 0); `why.bet` uses betUnit; WIN/`animateWin` cap; holdCount persist; Super/FEVER ONCE cue |

## Issues found → fixed (by area)

| Area | Issue | Pass |
|---|---|---|
| Engine / train | 開火車 lit ONCE MORE (0-pay blank) | 1 |
| Engine / sanyuan | 大三元 could show 2 lamps when land∈set | 1 |
| Engine / bingo | 雙燈 second pay never marked bingo | 4 |
| Engine / JP | Pot grew while JP mode off | 5 |
| UI / bet | `why.bet` unpaid checked +1 not +betUnit | 1 |
| UI / all | `why.all` unpaid ignored betUnit affordability | 2 |
| UI / once banner | `remaining≤0` hid banner so「結束」never showed | 2 |
| UI / resize | `scheduleFit`→`idleReels` reset reels mid-spin | 2 |
| UI / dialogs | Deck actions during confirm/settings (fallback / race) | 2–3 |
| UI / settings | Could open settings mid-round | 3 |
| UI / stages | Deck z-index above glass → taps through stage | 7 |
| UI / LINE | Meter always 0 after line clear | 8–9 |
| UI / FX | Hold flash stuck after wins; JP hold leaked on abort/refresh | 4, 10 |
| UI / reels | Orphan RAF after thrown await | 6 |
| Math / WIN | `animateWin` / 比大小 uncapped vs CREDIT_CAP | 1, 3 |
| Persist | holdCount / bingoLineWins not saved; mid-spin hold freeze | 1, 8, 10 |

## All-modes-ON trigger census (re-checked after pass 10)

| Mode | Notes |
|---|---|
| forceStage | **6/6 × 30/30** |
| train ONCE tiles | **0** |
| 大三元 short (<3 tiles) | **0** |
| stage mult>0 zero-pay | **0** |
| win vs steps | **0** mismatches / 4000 |
| 雙燈→bingo both | **330/330** samples |

## RTP (`node sim.js 8000`)

| Preset | 全押 RTP |
|---|---|
| 輕鬆 | ≈125% |
| **標準** | **≈100–104%** |
| 困難 | ≈82% |
| 標準無彩蛋 | ≈77–78% |

## Verified OK

- `bindTap` / 開分 commit-on-up / fruit hold-repeat / `visualViewport` resize-only
- Mid-spin `save()` refunds stake + freezes win/bingo/jp/hold/lineWins
- `forceStage`; stage min-1 (×0除外); `onceRate` live with superRun
- `MODE_LABELS` / `MODE_HINTS` / 玩法 copy aligned (雙燈 bingo, JP accumulate, stages)

## Remaining risks (watch)

1. 蘋果單押 RTP still soft (≈60–70% on some runs) — house edge via ×3 weights; not forced up.
2. Six cabinet stages share one entry slot (~0.3% each when all on).
3. 比大小 mid-refresh can cancel an unrevealed gamble (WIN unchanged) — acceptable.
4. Stage overlay RAF on detached nodes after abort is harmless but not cancelled per-frame.

## How to re-check

```bash
node --check engine.js && node --check game.js
node sim.js 120000
node -e "const E=require('./engine.js'); let n=0; for(let i=0;i<50;i++){const r=E.resolveRound([1,1,1,1,1,1,1,1],E.DEFAULT_SETTINGS,Math.random,200,{forceStage:'roulette'}); if(r.steps.some(s=>s.type==='roulette'))n++;} console.log(n+'/50');"
```

DevTools: mid-spin refresh → stake refunded, WIN/bingo/hold/LINE not partially kept; open a mini-stage → deck not tappable; 雙燈 pay → two bingo flashes when symbols differ.
