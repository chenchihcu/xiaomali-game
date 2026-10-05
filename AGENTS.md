# AGENTS.md — notes for Cursor / Codex / AI maintainers

## What this is
「小瑪莉」fruit-machine web game. **Pure static** (HTML/CSS/vanilla JS), no build step,
no dependencies. Deployed as-is to GitHub Pages from the repo root. Fake play credit only.

## Structure
| File | Role |
|---|---|
| `index.html` | Markup: top bar, `#board` (7×7 grid; 24 tiles are injected before `#center`), `#betpanel` (8 keys injected), `.controls`, help `<dialog>`. |
| `styles.css` | Everything sized from `--u` = 1/100 of cabinet width `--W`. `--W` = min(viewport width, 470px, available height / 1.86). Safe-area insets via `env()`. |
| `game.js` | Single IIFE, sections numbered 1–7: config (`SYMBOLS`, `TRACK`, weights), seven-segment SVG LED, Web Audio `Sound`, `state` + localStorage, DOM build/render, actions, input. |
| `icon*.png`, `icon.svg`, `manifest.webmanifest` | Home-screen icon / PWA metadata (no service worker). |

## Game rules in code
- `TRACK[i]` = tile i, clockwise from top-left. `{ s, small?, pay?, w }`. Stop target is weighted-random by `w`; the light animation is cosmetic (`runLight`).
- Payout = `bets[symbol] × (small ? pay : SYMBOLS[].mult)`. `s: 'once'` → free re-spin with same bets (max chain 5).
- Current weights give ~98% return per symbol incl. ONCE MORE. If you change weights or multipliers, recheck RTP (sum of `w/total × payout`, divided by `1 − P(once)`).
- `state.betsPaid`: `true` = bets already deducted for next spin (Clear refunds). `false` = last round's bets on display; Start re-deducts them, tapping a key starts a fresh bet.
- Big/small: random 1–9; 1–4 small, 6–9 big, 5 push. Correct → WIN×2, wrong → WIN=0.
- Storage key `xiaomali.v1` (credit, win, pos, sound, lastBets). Bump the key if the schema changes.

## How to test
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
- Chrome DevTools → device toolbar → **iPhone 14/15 Pro Max (430×932)**; also check 375×667.
- Keyboard: `1`–`8` bet, `A` all, `C` clear, `Space` start, `S` collect, `←/→` small/big.
- Console debug hook: `__xiaomali.state`, `__xiaomali.resetCredit()`, `__xiaomali.pickTarget()`.
- Real-device checks: iOS Safari needs a tap before audio plays; the hardware mute switch silences Web Audio.

## Conventions
- Keep it build-free: no bundler, no frameworks, no external CDNs/fonts (works offline & on Pages).
- UI text is Traditional Chinese (zh-Hant). Code/comments in English.
- No copyrighted characters/logos (no Nintendo/Mario art). Emoji + CSS/SVG only.
- Keep the 娛樂用／虛擬分數 disclaimer visible (footer, help dialog, README).
- Touch targets ≥ 44px; bet keys use `pointerdown` (with hold-to-repeat), other buttons use `click`.
