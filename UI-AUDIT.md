# UI 稽核 — 不明顯／模糊問題（2026-10-06，build 20261006c8）

範圍：`styles.css` / `game.js` / `index.html`，基準 `6cdb51a`（c7）。
方法：程式碼審閱 + headless Chrome 430×932 @3x（iPhone 16 Pro Max 尺寸）實拍
idle／已押／轉動中／中獎四狀態，並以腳本列出每個文字/SVG 節點的
祖先 `filter`、累積 `opacity`、非整數縮放、字級與觸控尺寸。
結果：含 brightness/saturate 濾鏡的文字/圖示節點 **318 → 0**；字級 <7px 的資訊標籤 22 → 只剩裝飾/賓果小格。

## 原則（之後改 UI 請遵守）
1. **不要在含文字或 SVG 的容器上用 `filter`**（會先栅格化成點陣 → 筆畫、中文變軟）。要暗化只能用 `::before` 鍵帽（裡面沒字）或純 `opacity`。
2. **不要讓按鍵／格子半透明疊在噪點紋理（felt/noise）上** — 紋理會透進圖示，看起來像「砂粒/糊」。
3. 資訊字（非裝飾）手機上至少 ~7–8px，有效不透明度 ≥ ~0.6。

## 發現 → 處理

| # | 位置（選擇器） | 問題 | 嚴重度 | 狀態 |
|---|---|---|---|---|
| 1 | `.center { filter: brightness(.86) }` | 中央窗整塊（3 轉軸 145 個 SVG、JP、VFD 訊息、小/大、WHEEL/BONUS）被濾鏡栅格化 → 轉軸圖示與訊息字變軟；配合 `.cab-toys scale(.88)` 更糊 | 高 | ✅ 已修（filter: none） |
| 2 | `.betkey:not(.is-bet) { opacity:.7; filter }` | 未押注的押注鍵 70% 透明疊在紫色 felt 噪點上 → 水果圖示布滿顆粒、像糊掉；又是主要輸入卻最暗 | 高 | ✅ 已修：鍵全不透明、無濾鏡；未押只在 `::before` 鍵帽略降飽和；已押改金框＋光暈 |
| 3 | `.betkey .bbet` 1.7u ≈ 7px | 押注數量角標太小 | 中 | ✅ 改 max(10px, 2.3u) |
| 4 | `.meter { filter: brightness(.95) }`、`.marquee { opacity:.96 }` | WIN / CREDIT 七段 LED 被濾鏡＋半透明 | 中 | ✅ 已修 |
| 5 | `.board:not(.is-chasing) .tile… { filter:.9; opacity:.92 }` | 外圈 24 格平時被濾鏡＋半透明（噪點透出） | 中 | ✅ 已修（平時 100%、無濾鏡） |
| 6 | 跑燈中 `.tile:not(.lit)… { filter: brightness(.52) }`、trail1/2 filter | 跑燈每格切換都在重算濾鏡點陣 | 低–中 | ✅ 改純 opacity（.6／.96／.82），主燈對比維持 |
| 7 | `.deck-main .btn:not(.btn-start) { opacity:.84 }` | 清除／全押／自動 半透明 → 底紋透進圖示與字 | 中 | ✅ opacity 1 |
| 8 | `.btn-start.off` | 未押注時開始鍵維持亮綠、字卻是 50% 灰 → 看起來像壞掉／字糊 | 高 | ✅ off：鍵帽暗綠（`::before` 濾鏡）、字 78% 白；押注後才亮綠＝CTA 明確「上膛」 |
| 9 | `.btn-yellow.off`（全押轉動中） | 暗化黃帽＋60% 深字 → 幾乎看不到 | 中 | ✅ 字 88% 深棕、帽 brightness .68 |
| 10 | `.msg.hot` 閃爍 `opacity 1→.55` | 倒跑／跳格／連跑訊息一半時間只剩 55%（截圖呈灰綠） | 中 | ✅ 改光暈閃爍，最低 .9 |
| 11 | `.hold-rail` filter＋.72；`.hold-plate` 5.3px | HOLD/KEEP 字太小太淡 | 低–中 | ✅ filter 拿掉、opacity .9、字 ≥7px |
| 12 | `.mini-meter`（JP/LINE）opacity .42 + brightness .72 | 頂部 JP/LINE 數值幾乎看不見 | 中 | ✅ 無濾鏡；待機 .66、啟用(JP) 1 |
| 13 | `.bingo-wrap` .7×濾鏡、未標記格 .55 → 有效 .39 | 賓果盤圖示太暗糊 | 中 | ✅ 無濾鏡；盤 .92、未標記格 .62（已標記仍全亮） |
| 14 | `.mission-bar` .52＋濾鏡；字 5.7/6.5px | MISSION 0/9 看不清 | 中 | ✅ .85、字 ≥7.5/8.5px |
| 15 | `.bonus-lamp` 待機 .48＋濾鏡；`.bl-sub` 5.7px、45% 白 | 「BONUS 待機」有效約 20% 不透明 | 中 | ✅ .82、字 ≥8px、72% 白 |
| 16 | `.mw-lab` / `.mini-lab` / `.plate` / 小大 `em` 6–7px | 標籤偏小 | 低 | ✅ 各加最小 px |
| 17 | 賓果格 ONCE MORE `#4aa3ff` 在深底 | 對比低 | 低 | ✅ 提亮 #8cc4ff + 黑邊 |

## 殘餘（本輪未改，原因）

| 位置 | 說明 | 建議 |
|---|---|---|
| `.wing-caption`（CHERRY/BELL）5.7px、.55 | 純裝飾字 | 可保留；或 fit-0 也隱藏 |
| 賓果格內 BAR 4.4px、`scale(.85)` | 3×3 小格空間不足；圖形仍辨識得出 | 之後可改 BAR 圖形化 SVG |
| 賓果格 `button` 43×28px | 觸控 <44px（但主要是顯示用） | 若要可點，需加高頂部區塊 |
| 中獎時 `.center` 展開 72% | 會蓋住左右兩欄內側的紅色圓燈（跑燈指示）一部分 | 改 68% 或燈移外側；需版面調整 |
| `.reel.spinning .reel-strip { blur(.6px) }` | 刻意動態模糊，只在轉動中 | 保留 |
| 外圈 `.tile .ic` 等 `drop-shadow` | 只在單一圖示上，不含容器文字；實拍銳利 | 保留 |
| 背景 `.side-lamp` / `.rail-dot` / `.paint-scroll` 濾鏡 | 不含文字/圖示的裝飾 | 保留 |

## 驗證
- `node --check game.js engine.js sim.js` ✅
- 實拍 idle／已押／轉動中／中獎：押注鍵顆粒消失、開始鍵 off/on 分明、VFD 閃爍不再變灰、頂部 HOLD/MISSION/JP/LINE 可讀；未觸發 fit-1/fit-2 版面重排（`--W` 仍 422px）。
