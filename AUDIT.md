# Audit — UI/UX · 按鍵／Hitbox · 機率／派彩 · Bonus · 音效 · 防呆 · 效能 · a11y（2026-10-05）

Scope: `/workspace/xiaomali` static game (`engine.js` / `game.js` / `index.html` / `styles.css`).
Method: code review + button-panel screenshot + `node sim.js` Monte-Carlo + targeted unit checks.
Target device: **iPhone 16 Pro Max** 430×932 portrait (Safari chrome ~746).

## Issues found → fixed (this pass)

| # | Area | Issue | Fix |
|---|---|---|---|
| 1 | Buttons / hitbox | Deck controls used `click` only; iOS often feels laggy / drops taps when finger slides on glossy caps | Added `bindTap()`: `pointerdown` + `setPointerCapture` + fire on `pointerup`; keyboard still via `click` `detail===0` |
| 2 | Buttons / 開分 | `pointerleave` committed +100 credit (drag-off = accidental open) | Open commits **only** on `pointerup`; `pointercancel` aborts |
| 3 | Buttons / 押注鍵 | `pointerleave` cancelled hold-repeat when pressed animation shifted the hitbox | Removed leave handler; `setPointerCapture` keeps repeat with the finger |
| 4 | Overlay | `#firstTip` fixed at bottom (`z-index:80`) covered 開始／自動／水果鍵 → dead taps for first-run | Tip moved to **top ~12%** over glass/board, not the deck |
| 5 | Overlay / z-index | Flourish layer `z-index:8` sat above deck `z-index:2` (safe only while `pointer-events:none`) | Deck raised to `z-index:9`; coin FX also `pointer-events:none` |
| 6 | Touch targets | `fit-2` set button height to `calc(u*9.2)` which dips under 44px on narrow `--W` | `height: max(44px, calc(u*9.2))` + keep `min-width/min-height: 44px` |
| 7 | Icon hit area | Bet-key `.bicon` SVG could be the event target | `pointer-events: none` on `.bicon` (whole keycap is the target) |
| 8 | Auto label | Fallback `btn.auto.textContent = …` would wipe SVG icon children if `#autoLab` missing | Never set `textContent` on the button; only update `#autoLab` |
| 9 | Math / stages | `tryPushCabinetStage(force=true)` still rolled `rng() >= rate` (force was a no-op) | `force` now skips the rate roll (still capped by `maxPerRound`) |
| 10 | Copy | Help said 洗分「清 WIN」but wash zeros CREDIT＋WIN | Help line →「洗分歸零」 |
| 11 | a11y | No visible keyboard focus ring on deck controls | `:focus-visible` gold outline; suppress non-keyboard `:focus` |

## Verified OK (no change)

- RTP (`node sim.js 80000`): easy≈122% · **normal≈98%** · hard≈80% · classic-no-bonus≈89%
- Slot pays only bet-on-matched-symbol; bingo detects **all** lines then clears union
- `simulate()` mirrors live `nextJpPot` order
- Cabinet stages: ≤1 / round (0 multi-stage in 30k trials); special/ONCE MORE steps carry `step.trigger`; UI `cueStageEntry` → overlay → `celebrateHit`
- `why.*` + `.off` + toast deny; `state.busy` before `await`; `guarded()` cooldowns
- ONCE MORE chain ≤ `MAX_ONCE_MORE_CHAIN` (8); CREDIT_CAP on collect/load/auto
- Sound: gesture `unlock` + silent buffer; BGM duck under fanfare; `prefers-reduced-motion` skips heavy FX / tiny vibrate only
- `fitCabinet()` probe for `env(safe-area-*)`, fit-1/fit-2 density, iterative `--W` nudge
- Screenshot of deck: icon+label layout matches intended 開分／洗分／小／得分／大／加倍／續押／8 水果／清除／全押／自動／開始

## Remaining risks (not bugs, watch)

1. **Apple single-bet RTP** still low (~70% normal) vs mid fruits (~95%) — many apple tiles incl. ×3.
2. **Easy** still player-favored (~122%) by design.
3. Slider UI max for rates is **2.0×**; `normalizeSettings` allows **3** via console until `validateSettings` snaps.
4. `startCredit` slider max **5000** vs engine clamp **99999**.
5. Settings RTP estimate uses only **2500** rounds (noisy).
6. Cabinet mini-stages entry is intentionally rare (~0.3% rounds at normal) — wired correctly but may feel scarce; raising `STAGE_ENTRY.chance` will lift RTP.
7. Sic Bo / roulette entertainment tickets almost always pay a small `floor(totalBet×mult/4)` once entered (house edge is the entry rate).
8. Gamble ×2 has no ceiling other than CREDIT_CAP on collect.
9. No cryptographic RNG audit beyond `crypto.getRandomValues` float (fine for fake credit).
10. `bindTap` + `preventDefault` on `pointerdown` relies on Pointer Events; very old WebKit without PE falls back to `click detail===0` only (keyboard) — touch may need a one-off polyfill if ever reported.

## How to re-check

```bash
node sim.js 120000
node --check engine.js && node --check game.js
```

DevTools: iPhone 16 Pro Max 430×932; first-load tip must **not** cover deck; tap/hold 開分 & fruit keys; greyed 得分 still toasts; special lamp → Bonus entry cue; Settings → only 三輪/FEVER/stages on → 中彩機率 still active; CREDIT at cap + auto.
