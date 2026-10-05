# Audit — 第四輪（賓果動畫／存檔／設定連動／文案）（2026-10-05）

Scope: `/workspace/xiaomali` after `a5ff15b`.
Method: code review + `node --check` + `node sim.js` + forceStage probe + bingo step-board progression + label/hint cross-check.

## Issues found → fixed

| # | Area | Issue | Fix |
|---|---|---|---|
| 1 | Bingo / UI | `start()` 一進局就把 `state.bingo` 設成**整局最終盤**，賓果步驟的 `step.board` 沒用上 → 標格／連線動畫跳過、任務條提前跳滿 | 改為逐步套用：先亮 `step.cell`、播連線，再寫入 `step.board`；局末再同步 `result.bingoBoard` |
| 2 | Persistence | `save()` 在 `busy` 時不把已扣押注折回 CREDIT；中途重新整理會**吃掉本局押金**，又把同一排押注載成未付預覽 | `betsPaid` 時一律 `credit += sum(bets)` 寫入 LS（記憶體內仍維持已付） |
| 3 | Settings | `onceRate` 在關「連跑／大 ONCE」時被 dim／disabled，但 **超跑仍吃 onceRate** → 玩家無法調超跑機率 | dim 條件改為：`(once∧(multi∨big)) ∨ superRun` 任一成立就保持可調 |
| 4 | Soft-lock | `start()` `finally` 清了轉輪／overlay／FEVER，但 **cabinet `fx-spin` 等 class 可能殘留** | `finally` 加 `FX.clear()` |
| 5 | Copy | `MODE_HINTS`／玩法說明寫 `floor(…)`，與引擎 `max(1, floor(…))`（轉輪 ×0 除外）不完全一致 | 提示與 help 改對齊 min-1 公式 |

## All-modes-ON trigger census (prior round still holds; re-checked forceStage)

| Mode | Notes |
|---|---|
| forceStage | **6/6 kinds × 30/30** |
| sicbo min-1 | **0** violations on 單押1（mult>0） |
| once / song / train / sanyuan / stages | rates unchanged from audit 3 (~4% / 1–2% / ~0.3% each stage) |

## RTP (`node sim.js 30000`)

| Preset | 全押 RTP |
|---|---|
| 輕鬆 | ≈128% |
| **標準** | **≈100–101%** |
| 困難 | ≈83% |
| 標準無彩蛋 | ≈81% |

## Verified OK

- `bindTap`／開分 commit-on-up／水果 hold-repeat／`visualViewport` resize-only
- `start` / `collect` / `gamble` / cabinet stages `try/finally` 清 `busy`
- `forceStage` 保證進場；舞台 `stagePayFromTotal` min 1（×0 除外）
- 局後未付預覽加押不整排清空；例外路徑清轉輪／overlay／FX
- `MODE_LABELS` / `MODE_HINTS` / 玩法說明與引擎公式一致

## Remaining risks (watch)

1. 蘋果單押 RTP 仍偏低（≈60–70%，小圖×3 權重堆疊）— 未為保全押≈100% 強行拉高。
2. 六種櫃舞台共用一個進場名額（全開時各約 0.3%）。
3. 無 crypto RNG 深度稽核（僅 `crypto.getRandomValues` float）。
4. 極矮視窗 fit-2 後 bet key 寬度仍依賴 `--W` 下限；現有 360／250 floor 已測過，極端橫向需再盯。

## How to re-check

```bash
node --check engine.js && node --check game.js
node sim.js 120000
node -e "const E=require('./engine.js'); let n=0; for(let i=0;i<50;i++){const r=E.resolveRound([1,1,1,1,1,1,1,1],E.DEFAULT_SETTINGS,Math.random,200,{forceStage:'roulette'}); if(r.steps.some(s=>s.type==='roulette'))n++;} console.log(n+'/50');"
```

DevTools iPhone 16 Pro Max：賓果標格應逐步亮起再清線；旋轉中強制重新整理後 CREDIT 不應少掉當局押金；僅開「超跑」時連跑機率滑桿仍可調。
