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
- `bonusRate`: 中彩機率 — scales 送燈／開火車／三元四喜
- `onceRate`: scales 連跑／大 ONCE MORE grant chances
- `jpRate`: scales JP pot growth (`JP.rate × jpRate`)
- `startCredit`: 100–99999 (reset button)
- `betUnit`: 1–10 credit per bet tap
- `sfxVol` / `bgmVol`: 0–1
- `modes`: `{ once, onceMulti, onceBig, song, train, sanyuan, jp }`
- `music`: `off` \| `arcade` \| `breezy` \| `festive` \| `retro` \| `neon`

Credit/win/sound/jp/lastBets: `xiaomali.v1`.

## Cabinet FX (visual only)
Frame LED rails, side lamps, 假保留燈 strip, FEVER/READY banner. Classes on `#cabinet`:
`fx-spin` / `fx-reach` / `fx-expect` / `fx-win` / `fx-fever`. No gameplay effect.

## UI 防呆 (guards)
- `why.*()` in `game.js` returns a reason string (blocked) or `null` for every action
  (`start/clear/all/bet(i)/dbl/rebet/auto/collect/gamble/open/wash/reset`). `render()` greys
  controls via `.off` + `aria-disabled` (not native `disabled`) so a tap still explains why via `toast()`.
- Action functions re-check `why.*` themselves (keyboard/console paths too). `state.busy` is set
  synchronously before any `await`; `guarded()` adds a per-action cooldown (double-tap, Space on a
  focused button, key repeat ignored). One pending `autoTimer` only.
- Auto stops with a toast as soon as CREDIT+WIN can't cover the next pattern.
- 洗分 and 重設分數 go through `confirmBox()` (`#confirmDialog`).
- Settings: `validateSettings()` clamps/snaps every value to the slider `min/max/step` in `index.html`
  (single source of truth), repairs all-zero fruit weights, and `settingsWarnings()` lists ineffective
  combos in `#setAlert`. Dependent controls (連跑/大 ONCE MORE, rate sliders) grey out when their mode is off.
  Loaded/console settings are validated too (`__xiaomali.setSettings` returns `{fixed, errors, warnings}`).

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
- iOS/WebKit: tap once to unlock; `Sound.unlock` awaits `resume` + silent buffer before BGM/SFX. Hardware mute still silences Web Audio. Tab-visible resumes suspended AudioContext.

## Conventions
- Build-free: no bundler, framework, CDN, or external fonts.
- UI copy: Traditional Chinese. Code/comments: English.
- No copyrighted characters/logos/music samples — Emoji + CSS/SVG + procedural audio only.
- Keep 娛樂用／虛擬分數 disclaimer (footer, dialogs, README).
- Touch targets ≥ 44px; bet keys `pointerdown` + hold-repeat.

## Changing odds
1. Edit `engine.js` `TRACK[].w` / `PRESETS` / `BONUS.*.chance` / `JP`.
2. Run `node sim.js` and aim ~reasonable entertainment RTP (normal ≈ 90–100% all-bet is fine).
3. Settings UI exposes presets + 中彩／連跑／JP rates + weight sliders + volumes — prefer those for player-facing knobs.
