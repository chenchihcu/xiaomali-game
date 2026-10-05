# 小瑪莉 Little Mary 🍎🍊🔔

經典「小瑪莉」水果機的網頁版小遊戲。純 HTML／CSS／JavaScript，**不需要安裝、不需要編譯**，直接用瀏覽器打開就能玩。畫面以 **iPhone 16 Pro Max 直式（Safari）** 為主設計，其他手機與電腦也能玩。

> ⚠️ **免責聲明：本遊戲僅供娛樂。所有分數（CREDIT）皆為虛擬點數，不能儲值、不能兌換任何金錢或獎品，非真實賭博。**

---

## 快速開始（本機）

**方法 A：直接打開**
雙擊 `index.html`，用 Chrome／Safari／Edge 打開即可。

**方法 B：開個本機伺服器（建議，比較接近上線環境）**

```bash
cd xiaomali
python3 -m http.server 8000
# 瀏覽器打開 http://localhost:8000
```

或 `npx serve .`。

**用手機測試：** 手機和電腦連同一個 Wi‑Fi，手機 Safari 打開 `http://<電腦的區網 IP>:8000`。

---

## 發布到 GitHub Pages

1. 在 GitHub 建立新的 repository（例如 `xiaomali`），把本資料夾所有檔案推上去：
   ```bash
   cd xiaomali
   git init
   git add .
   git commit -m "小瑪莉 first version"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/xiaomali.git
   git push -u origin main
   ```
2. 到 repo 的 **Settings → Pages**。
3. **Source** 選 **Deploy from a branch**，Branch 選 **main**、資料夾選 **/ (root)**，按 **Save**。
4. 等 1～2 分鐘，網址會是：`https://<你的帳號>.github.io/xiaomali/`
5. iPhone 用 Safari 打開該網址 → 分享 → **加入主畫面**，就能像 App 一樣全螢幕玩。

---

## 怎麼玩

| 操作 | 說明 |
|---|---|
| **水果鍵（下方 8 個）** | 點一下押 1 分（從 CREDIT 扣），**按住可連續加注**，每種最多 99。 |
| **全押** | 8 種圖案各加押 1 分。 |
| **清除** | 取消這局押注，分數退回 CREDIT。 |
| **開始** | 燈號繞 24 格跑動、減速後停下。 |
| **得分** | 把 WIN 轉入 CREDIT。 |
| **小 / 大** | 比大小：中間數字亮 1–4 為「小」、6–9 為「大」。猜中 WIN 加倍、猜錯 WIN 歸零，亮 5 為和局（WIN 不變）。可以連續比。 |
| **🔊** | 音效開關（iPhone 靜音鍵開著時不會有聲音）。 |
| **☰** | 玩法說明、賠率表、重設分數為 1000。 |

- 起始分數 **CREDIT 1000**，會自動存在瀏覽器（localStorage），重新整理不會不見。
- 上一局的押注會保留（數字變暗），直接按「開始」就用相同押注再玩一局；點任何水果鍵則重新押注。
- 有 WIN 時直接押注或按開始，WIN 會自動先轉入 CREDIT。

### 賠率表

| 圖案 | 倍率 |
|---|---|
| 🍎 蘋果 | × 5 |
| 🍊 柳橙 | × 10 |
| 🥭 芒果 | × 10 |
| 🔔 鈴鐺 | × 20 |
| 🍉 西瓜 | × 20 |
| ⭐ 星星 | × 30 |
| 77 | × 40 |
| BAR | × 100 |
| 小圖示（右下角標 ×3） | × 3 |
| BAR 小圖示（標 50） | × 50 |
| **ONCE MORE** | 用同樣押注**免費再跑一次** |

### 電腦鍵盤快捷鍵

`1`–`8` 押注、`A` 全押、`C` 清除、`Space`／`Enter` 開始、`S` 得分、`←` 小、`→` 大

---

## 檔案結構

```
index.html            頁面骨架
styles.css            版面與街機風格（直式、Safe Area）
game.js               遊戲邏輯（盤面、機率、跑燈、押注、比大小、音效）
icon.svg              網站圖示
icon-180.png / icon-512.png   iPhone 主畫面圖示
manifest.webmanifest  加入主畫面設定
AGENTS.md             給 Cursor / Codex 等 AI 維護者的說明
```

想調整難度：修改 `game.js` 裡 `TRACK` 每格的 `w`（停在該格的機率權重）。

---

## 版權說明

美術全部以 Emoji、CSS 與 SVG 原創繪製，**未使用任何任天堂或其他公司的角色與商標**。「小瑪莉」為台灣對此類水果機的通稱。
