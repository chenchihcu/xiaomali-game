# AGENTS.md — notes for Cursor / Codex / AI maintainers

## What this is
「小瑪莉」fruit-machine web game. **Pure static** (HTML/CSS/vanilla JS), no build,
no dependencies. Deployed as-is to GitHub Pages from repo root. Fake play credit only.

Live: https://chenchihcu.github.io/xiaomali-game/
Repo: https://github.com/chenchihcu/xiaomali-game

## Structure
| File | Role |
|---|---|
| `index.html` | Real-cabinet layout: `.cabinet` (wood) → `.marquee` (🔊 knob, WIN/CREDIT meters, ⚙ knob) → `.glass` (`#board` 7×7 track; `#center` machine window = JP + **3 reels** + dice + `#onceBanner` + VFD `#msg`; `#betpanel` payout strip = mult + bet LED) → `.deck` (CREDIT/WIN/BET plate groups, `#betKeys` 8 fruit keycaps, 清除/全押/自動/開始) → disclaimer plate. Settings/help dialogs. Scripts: `engine.js` then `game.js` (`defer`). |
| `styles.css` | `--u` = 1/100 of `--W`; cabinet height ≈ 1.80×W. Portrait-first. Tiles get `side-*` class for inner-edge lamp bulbs. |
| `engine.js` | Pure logic → `XiaomaliEngine`. `resolveRound` queues free runs on ONCE MORE (`once` / `onceMulti` 連跑 / `onceBig`), then bonus + JP. Cap `MAX_ONCE_MORE_CHAIN`. |
| `game.js` | UI: light run, reels, sound/BGM, settings, **「再跑 N 次」** banner. Animates `E.resolveRound` steps only. |
| `sim.js` | `node sim.js [rounds]` balance check (not loaded in browser). |
| `icon*`, `manifest.webmanifest` | PWA-ish home screen (no service worker). |

## Settings (localStorage `xiaomali.settings.v1`)
- `preset`: `easy` \| `normal` \| `hard` \| `custom`
- `weights`: per-symbol (+ `once`, `small`) 0–3
- `bonusRate`: scales LUCKY + 連跑／大 ONCE MORE grant chances
- `modes`: `{ once, onceMulti, onceBig, song, train, sanyuan, jp }`
- `music`: `off` \| `arcade` \| `breezy` \| `festive` \| `retro` \| `neon`

Credit/win/sound/jp/lastBets: `xiaomali.v1`.

## Game rules in code
- Stop = `effectiveWeights` (ONCE MORE weight 0 if `modes.once` off).
- `resolveRound` steps: `once` `{grant,remaining,variant}` → `land` `{runsLeft}` → optional `bonus` / `jp`.
  - Landing on ONCE MORE queues free light-runs (`single` 1 / `multi` 2–4 / `big` 3–5). Each free stop may pay; another ONCE MORE adds more (cap `MAX_ONCE_MORE_CHAIN`). UI shows countdown banner — do not re-roll in `game.js`.
- Bonus: `song` / `train` / `sanyuan`. JP: big BAR + BAR bet.
- Big/small: 1–4 / 6–9 / 5 push. Center reels are cosmetic; outer track pays.
- Prefer short Traditional Chinese UI copy on portrait.
- Layout follows real 小瑪莉 cabinets (WIN/CREDIT on top marquee, payout strip under track, button deck at bottom). Don't reintroduce app-style top bars.
- Controls: `.btn` = illuminated arcade push-button (chrome bezel, lit cap via `::before`, unlit when disabled). Bet keys = white keycaps on the deck; LEDs live in the payout strip (`betKeys[i].cell`).
- Track / bet icons: CSS/SVG glossy fruit (unique gradient ids in `iconHTML`), not emoji.

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
