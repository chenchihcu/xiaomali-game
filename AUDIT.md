# Audit — 第五輪（局中存檔／FX／假保留／文案）（2026-10-05）

Scope: `/workspace/xiaomali` after `1d32ab8`.
Method: code review + `node --check` + `node sim.js` + forceStage / win-sum / bingo consistency probes + mid-spin persist walkthrough.

## Issues found → fixed

| # | Area | Issue | Fix |
|---|---|---|---|
| 1 | Persistence | 局中 `visibilitychange`／`pagehide` 呼叫 `save()` 時：押金會折回 CREDIT，但**局中已動畫的 WIN／賓果進度／JP 也一併寫入** → 重新整理＝白嫖局中獎金 | `roundPersist` 凍結局開始時的 `win`／`bingo`／`jp`；`save()` 忙碌中只寫凍結值；例外路徑回滾後再存 |
| 2 | Soft-lock / FX | 第四輪在 `start()` `finally` 加了 `FX.clear()`，會**立刻清掉**局末剛設的 `FX.win()` 脈衝 | 成功結束只移除 `fx-spin`／`reach`／`expect`／`fever`；失敗才 `FX.idle()` |
| 3 | Cabinet FX | `FX.holdsSpin()` 經 `holdsSet(n)` **覆寫**持久 `holdCount` → 每轉一次假保留進度被隨機 1–3 蓋掉，局末 ±1 無意義 | `holdsSpin` 改純顯示；`FX.win` 先還原持久 hold 再閃 |

## Copy

- 玩法說明補上：倒跑／跳格／假停、雙燈、超跑（連跑機率加乘），對齊開關與引擎。

## All-modes-ON trigger census (re-checked)

| Mode | Notes |
|---|---|
| forceStage | **6/6 kinds × 40/40** |
| sicbo / roulette min-1 | **0** zero-pay on 全押1／單押1（mult>0） |
| once / song / train / sanyuan / stages | ~3%+0.6%+0.4% once variants; song/train/sanyuan ~1–2%; stages ~0.3% each; super ~1.4%; double ~2.8% |
| win vs steps | **0** mismatches / 3000 |
| bingo step.board | **0** mismatches / 5000 |

## RTP (`node sim.js 8000`)

| Preset | 全押 RTP |
|---|---|
| 輕鬆 | ≈128% |
| **標準** | **≈100–103%** |
| 困難 | ≈84% |
| 標準無彩蛋 | ≈79% |

## Verified OK

- `bindTap`／開分 commit-on-up／水果 hold-repeat／`visualViewport` resize-only
- 局後未付預覽加押不整排清空；`forceStage`；舞台 min-1（×0 除外）
- `onceRate` 在僅開超跑時仍可調；賓果逐步 `step.board`
- `MODE_LABELS`／`MODE_HINTS`／玩法說明與引擎一致

## Remaining risks (watch)

1. 蘋果單押 RTP 仍偏低（≈60–70%，小圖×3 權重堆疊）— 未為保全押≈100% 強行拉高。
2. 六種櫃舞台共用一個進場名額（全開時各約 0.3%）。
3. 比大小動畫中途重新整理仍可「取消」未開出的一局（WIN 未改）— 可接受；與局中白嫖不同。
4. 極矮視窗 fit-2 後 bet key 寬度仍依賴 `--W` 下限。

## How to re-check

```bash
node --check engine.js && node --check game.js
node sim.js 120000
node -e "const E=require('./engine.js'); let n=0; for(let i=0;i<50;i++){const r=E.resolveRound([1,1,1,1,1,1,1,1],E.DEFAULT_SETTINGS,Math.random,200,{forceStage:'roulette'}); if(r.steps.some(s=>s.type==='roulette'))n++;} console.log(n+'/50');"
```

DevTools：旋轉中途強制重新整理 → CREDIT 應退回當局押金且 **WIN 不應含局中獎金**；局末中獎時櫃體 `fx-win` 應短暫保留；假保留燈應跨局累積而非每轉重設。
