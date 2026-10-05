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

## 2026-10-05 — save / settings UX / fidelity / bingo icons
- Progress: `savedAt` payload; settings 進度 card (save / export / import / clear).
- Settings sheet: section chips + search + sticky head/foot (Pro Max width ≤540px).
- Bingo cells: fruit-reel SVG icons (same `iconHTML` as track).
- Cabinet: mini wheel + BONUS lamp always visible.
- Visual ~2×: denser textures, DPR hairlines, refined button SVGs.

## 20261005c — bingo icons + cache bust
- Confirmed Pages already had iconHTML bingo, save/settings, mini-wheel, fidelity; user still saw 蘋橙芒 from cached game.js.
- Hardened buildBingo/renderBingo to rebuild any text-glyph cells; asset URLs `?v=20261005c`.

---

# Audit — 第二批十輪（Pass 11–20 / Batch-2 Pass 1–10）（2026-10-05→06）

Scope: `/workspace/xiaomali` from `3485ba5` → (this push). Cloud agent quota exhausted; local executor.
Method: code review + `node --check` + `node sim.js` + forceStage / win-sum / bingo / JP-freeze / mode census probes.

## Pass summary (newest first)

| Pass | Focus | Fixes |
|---|---|---|
| **20 / B2-10** | RTP / sim | 蘋果軌道權重↑後單押 RTP；`sim.js` JP-off pot freeze 斷言 |
| **19 / B2-9** | MODE 文案 | `MODE_HINTS.bingo` + 玩法說明對齊超跑／FEVER 標格 |
| **18 / B2-8** | 自動／中途刷新 | `autoTick` 遇 dialog 改 `queueAuto` 等待（不再 `stopAuto`）；設定開啟 toast |
| **17 / B2-7** | fitCabinet | viewport／賓果狀態簽名，略過重複 refit 風暴 |
| **16 / B2-6** | AudioContext | `visibilitychange` 回來後 `unlock().then(Music.update)` |
| **15 / B2-5** | bingo | 超跑／FEVER 有中標格；同格略過重複 step；`pushBingoPay` |
| **14 / B2-4** | bonus 舞台 | `stageGen` 中止轉輪／骰寶／輪盤 orphan RAF |
| **13 / B2-3** | persist | 比大小 `roundPersist` 凍結未開獎 WIN；匯入／清除 confirm 後再檢查 `busy` |
| **12 / B2-2** | UI 閘門 | 忙碌中忽略遊戲快捷鍵；設定開啟時自動暫停提示 |
| **11 / B2-1** | engine 機率 | `nextJpPot` 在 `modes.jp===false` 凍結彩池；蘋果格 `w:3→5` |

## Issues found → fixed (by area)

| Area | Issue | Pass |
|---|---|---|
| Engine / JP | `nextJpPot` 在 JP 關閉時仍成長（simulate／重開 JP 驚嚇） | 11 |
| Engine / RTP | 蘋果單押 ≈65%（無小圖、權重偏弱） | 11 / 20 |
| Engine / bingo | 超跑／FEVER 有中不標格（與「有中標格」不符） | 15 |
| Engine / bingo | 超跑同圖多次 → 無意義重複 bingo step | 15 |
| UI / stage RAF | abort 後轉輪／輪盤 RAF 仍寫已 detach 節點 | 14 |
| UI / keyboard | 忙碌中快捷鍵仍進 `why.*` deny 洗版 | 12 |
| UI / settings | 自動中開設定 → 下一 tick `start` deny 直接 `stopAuto` | 18 |
| Persist / gamble | 比大小無 `roundPersist`，未開獎中途刷新語意不清 | 13 |
| Persist / import | 選檔／confirm 競態可在 `busy` 後仍套用備份 | 13 |
| Audio | 回前景只 `unlock()`，BGM 可能不重掛 | 16 |
| fitCabinet | visualViewport 重複 resize 反覆量測／改 `--W` | 17 |
| Copy | 賓果說明未提超跑／FEVER | 19 |
| sim | 缺 JP-off pot 凍結回歸檢查 | 20 |

## All-modes-ON trigger census (N=10000, 全押1, after B2)

| Mode / event | ≈ per-round |
|---|---|
| land | 100% |
| bingo (any mark) | ≈60% |
| fakeStop / reverse / skip (fx hits) | ≈12% / 11% / 9% |
| once | ≈3.1% |
| doubleRun | ≈2.9% |
| song / train / sanyuan | ≈1.9% / 1.3% / 1.1% |
| super / fever / slot | ≈1.3% / 0.8% / 0.7% |
| cabinet stages (each) | ≈0.15–0.37%（共用入口） |
| jp | ≈0.2% |
| forceStage 6/6 | **30/30** each |
| train ONCE tiles / 大三元 short / stage mult>0 zero-pay / win≠steps | **0** |

## RTP (`node sim.js 12000`)

| Preset | 全押 RTP | 蘋果單押 |
|---|---|---|
| 輕鬆 | ≈124% | ≈130% |
| **標準** | **≈103%** | **≈88%**（原 ≈65%） |
| 困難 | ≈84% | ≈74% |
| 標準無彩蛋 | ≈79% | ≈73% |
| JP-off pot freeze | **OK** |

## Remaining risks (watch)

1. 六閣舞台仍共用 `STAGE_ENTRY`（全開時各 ≈0.2–0.4%/局）— 設計取捨，非 bug。
2. 星星／77 單押仍偏軟（高倍權重低）— 未強制拉高。
3. 比大小開獎後、`finally` 前殺進程仍可能留下已提交結果（預期）。
4. iOS 無手勢時 `AudioContext.resume` 仍可能失敗 — 需下次點擊解鎖。
5. `fitCabinet` 簽名略過時，若僅 CSS 字體／橫幅高度變、viewport 不變，可能少一次 refit（賓果開關已纳入簽名）。

## How to re-check

```bash
node --check engine.js && node --check game.js
node sim.js 12000
# DevTools: __xiaomali.build === '20261006b2'
# 比大小骰動中刷新 → WIN 維持（未開獎）；開設定時自動不離線停止
# 舞台中途丟例外 → 轉輪 RAF 停止；JP 關閉打 100 局後重開 → 彩池未默默膨脹
```

Build / cache: `__xiaomali.build = '20261006b2'`, assets `?v=20261006b2`.
