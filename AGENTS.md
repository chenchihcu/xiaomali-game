# AGENTS.md — notes for Cursor / Codex / AI maintainers

## What this is
「小瑪莉」fruit-machine web game. **Pure static** (HTML/CSS/vanilla JS), no build,
no dependencies. Deployed as-is to GitHub Pages from repo root. Fake play credit only.

Live: https://chenchihcu.github.io/xiaomali-game/
Repo: https://github.com/chenchihcu/xiaomali-game

## Structure
| File | Role |
|---|---|
| `index.html` | Top bar (🔊 / ⚙️), `#board` 7×7 (24 tiles injected before `#center`), center = compact WIN/CREDIT + JP + **3 reels** + dice + msg, bet panel, controls, `#settingsDialog`, `#helpDialog`. Scripts: `engine.js` then `game.js` (both `defer`). |
| `styles.css` | Sized from `--u` = 1/100 of `--W`. Portrait-first. Reel / settings / JP styles appended after base cabinet rules. |
| `engine.js` | Pure logic IIFE → `window.XiaomaliEngine` / `module.exports`. `TRACK`, `SYMBOLS`, presets, `effectiveWeights`, `resolveRound` (ONCE MORE chain + bonus + JP), `nextJpPot`, `simulate`. |
| `game.js` | DOM/UI IIFE. Sound + procedural `Music` (Web Audio loops). Settings persistence. Light run + reel spin animation. Consumes `E.resolveRound` for payouts. |
| `sim.js` | `node sim.js [rounds]` balance check (not loaded in browser). |
| `icon*`, `manifest.webmanifest` | PWA-ish home screen (no service worker). |

## Settings (localStorage `xiaomali.settings.v1`)
- `preset`: `easy` \| `normal` \| `hard` \| `custom`
- `weights`: per-symbol (+ `once`, `small`) multipliers 0–3
- `bonusRate`: scales LUCKY chances (送燈／開火車／三元四喜)
- `modes`: `{ once, song, train, sanyuan, jp }` booleans
- `music`: `off` \| `arcade` \| `breezy` \| `festive` \| `retro` \| `neon`

Credit/win/sound/jp/lastBets: `xiaomali.v1`. Bump keys if schema breaks.

## Game rules in code
- Stop tile = weighted pick via `effectiveWeights(settings)` (ONCE MORE weight 0 if mode off).
- `resolveRound(bets, settings, rng, jpPot)` returns ordered `steps`: `once` \| `land` \| `bonus` \| `jp`. UI only animates; do not re-roll in `game.js`.
- Bonus kinds: `song` (extra lights), `train` (adjacent streak), `sanyuan` (set lights). JP: land on big BAR tile with BAR bet → fraction of pot.
- Big/small: 1–9; 1–4 small, 6–9 big, 5 push.
- Center reels are **cosmetic companions**: spin with the light run; middle settles to landed symbol (or ONCE MORE). Outer 24-tile track is still the real payboard.

## How to test
```bash
python3 -m http.server 8000
node sim.js 50000          # RTP / hit / LUCKY / JP rates per preset
```
- DevTools device: iPhone 14/15/16 Pro Max portrait.
- Console: `__xiaomali.state`, `.settings`, `.Music`, `.setSettings(...)`, `.pickTarget()`.
- iOS: tap once before audio; hardware mute silences Web Audio.

## Conventions
- Build-free: no bundler, framework, CDN, or external fonts.
- UI copy: Traditional Chinese. Code/comments: English.
- No copyrighted characters/logos/music samples — Emoji + CSS/SVG + procedural audio only.
- Keep 娛樂用／虛擬分數 disclaimer (footer, dialogs, README).
- Touch targets ≥ 44px; bet keys `pointerdown` + hold-repeat.

## Changing odds
1. Edit `engine.js` `TRACK[].w` / `PRESETS` / `BONUS.*.chance` / `JP`.
2. Run `node sim.js` and aim ~reasonable entertainment RTP (normal ≈ 90–100% all-bet is fine).
3. Settings UI already exposes presets + bonusRate + mode toggles — prefer those for player-facing knobs.
