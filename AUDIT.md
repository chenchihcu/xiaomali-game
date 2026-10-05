# Audit — 第三輪（按鍵／押注／舞台／給分／soft-lock）（2026-10-05）

Scope: `/workspace/xiaomali` after `a334d3d`.
Method: code review + `node --check` + `node sim.js` + all-modes census + `forceStage` probe + label/hint cross-check.

## Issues found → fixed

| # | Area | Issue | Fix |
|---|---|---|---|
| 1 | Buttons / bets | 局後 `betsPaid=false` 時點任一水果會經 `freshBets()` **清掉整排押注**（只留當下那顆）— 像按鍵壞掉／誤觸全滅 | 移除 `freshBets`；未付預覽改為只加該格（與加倍相同邏輯），`開始` 再扣 `sum(bets)` |
| 2 | Stages wiring | `opts.forceStage` 寫在稽核說明但 **resolveRound 從未讀取**（實際命中≈隨機） | 接上 `forcedKind`：跳過 `STAGE_ENTRY` 機率、仍受 `maxPerRound`；若整局無特殊／ONCE 也會在結尾強制開一次 |
| 3 | Math / labels | 舞台 `floor(押×倍/6)` 在 **單押／低總押** 常為 0，與「進場給分」文案不符（輪盤色／骰寶小大尤明顯） | `stagePayFromTotal`：`mult>0` 時至少給 1（`×0` 轉輪仍為 0） |
| 4 | Copy | `MODE_HINTS`／註解仍寫 `/4` 或未提特殊燈／ONCE 入口；賓果註解誤寫 `ceil(押/2)` | 提示與註解改對齊 `/6`、特殊燈／ONCE、賓果 `floor(押/4)`；玩法說明補舞台公式 |
| 5 | Soft-lock | `start()` 若在轉輪／舞台 await 中拋錯，可能留下 `.spinning` 轉輪＋busy 已清 | `finally` 額外清 reel `spinning`/`landed`、overlay、FEVER、once banner |
| 6 | UI | 自動鍵 SVG 中心圓點易被看成字母「b」 | 改為循環箭頭＋時鐘指針圖示 |

## All-modes-ON trigger census (`node`, 40k rounds, normal)

| Mode | Round rate | Notes |
|---|---|---|
| once | ~4.0% | base ONCE MORE stops |
| song / train / sanyuan | ~1.9% / 1.2% / 1.0% | LUCKY after land |
| slotBonus | ~0.8% | special / ONCE |
| fever | ~0.9% | JP / mult≥20 / special / solid hit |
| superRun | ~1.5% | paying/special × onceRate |
| jp | ~0.2% | rare by design |
| doubleRun | ~3.0% | land FX |
| cabinet stages (sum) | ~1.8% | ≤1/round；各約 0.3% |
| forceStage | **100/100** | 修後保證進場 |

## RTP (`node sim.js 80000`)

| Preset | 全押 RTP |
|---|---|
| 輕鬆 | ≈126% |
| **標準** | **≈101%** |
| 困難 | ≈83% |
| 標準無彩蛋 | ≈79% |

## Verified OK

- `bindTap`／開分 commit-on-up／水果 hold-repeat／`visualViewport` resize-only
- `start` / `collect` / `gamble` / cabinet stages 皆有 `try/finally` 清 `busy`
- 全開玩法時各模式仍有可感觸發率（同上表）
- `MODE_LABELS` / `MODE_HINTS` 與引擎路徑一致（舞台＝特殊燈／ONCE；FEVER 入口；賓果連線公式）

## Remaining risks (watch)

1. 蘋果單押 RTP 仍偏低（≈65%，小圖×3 權重堆疊）— 未為保全押≈100% 強行拉高。
2. 骰寶／輪盤進場後娛樂給分（edge 主要在進場率）；低總押現為至少 1。
3. 六種櫃舞台共用一個進場名額（全開時各約 0.3%）。
4. 無 crypto RNG 深度稽核（僅 `crypto.getRandomValues` float）。

## How to re-check

```bash
node --check engine.js && node --check game.js
node sim.js 120000
node -e "const E=require('./engine.js'); let n=0; for(let i=0;i<50;i++){const r=E.resolveRound([1,1,1,1,1,1,1,1],E.DEFAULT_SETTINGS,Math.random,200,{forceStage:'roulette'}); if(r.steps.some(s=>s.type==='roulette'))n++;} console.log(n+'/50');"
```

DevTools iPhone 16 Pro Max：局後點單一水果應保留其他押注；中途例外不得留下灰掉操作台或空轉輪。
