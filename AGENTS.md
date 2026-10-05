# AGENTS.md — notes for Cursor / Codex / AI maintainers

## What this is
「小瑪莉」fruit-machine web game with Running-Light / Pachislot / Medal / Bingo
inspired layers. **Pure static** (HTML/CSS/vanilla JS), no build, no dependencies.
Deployed as-is to GitHub Pages from repo root. Fake play credit only. Keep cabinet UI.

Live: https://chenchihcu.github.io/xiaomali-game/
Repo: https://github.com/chenchihcu/xiaomali-game

## Structure
| File | Role |
|---|---|
| `index.html` | Real-cabinet layout: `.cabinet` → `.marquee` → `.topper` (L/R painted wings with cherry/bell art + JP/LINE mini meters + wing lamps; center HOLD strip + bingo + MISSION bar) → `#flourishLayer` → `.glass` (`#board` track; `#center` = JP + **3 reels** + dice + `#onceBanner` + VFD) → `#betpanel` → `.deck` → disclaimer. Settings/help. Scripts: `engine.js` then `game.js` (`defer`). |
| `styles.css` | `--u` = 1/100 of `--W`. `--W` fitted by `fitCabinet()` to safe viewport (iPhone 16 Pro Max 430×932 first). Textured wood/metal/felt + original painted art (SVG). Portrait-first; `fit-1`/`fit-2` density. |
| `engine.js` | Pure logic → `XiaomaliEngine`. `resolveRound(bets, settings, rng, jpPot, { bingoBoard })` → steps: `once` / `land` (+`fx`,`double`) / `bonus` / `jp` / `super` / `slot` / `fever` / `bingo`. Cap `MAX_ONCE_MORE_CHAIN`. |
| `game.js` | UI: light FX (reverse/skip/fake), reels + slot stop-feel, FEVER/bingo, flourishes, settings. Animates engine steps only. |
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
- `modes`: `{ once, onceMulti, onceBig, song, train, sanyuan, jp,
  slotBonus, fever, bingo, reverse, skip, doubleRun, fakeStop, superRun }`
- `music`: `off` \| `arcade` \| `breezy` \| `festive` \| `retro` \| `neon`

Credit/win/sound/jp/lastBets/bingo: `xiaomali.v1`.

## Stages & light modes (toggleable)
| Mode | Trigger | Effect |
|---|---|---|
| `slotBonus` | Special full tiles (77/star/bar) or ONCE MORE | 3-reel bonus; possible free spin |
| `fever` | After JP or land mult≥30 | 2–3 FEVER light runs |
| `bingo` | Paying land marks 3×3; line pays floor(bet/4) | Mission board under hold lamps |
| `reverse` / `skip` / `fakeStop` | Per light-run roll | Animation FX on `step.fx` |
| `doubleRun` | On land | Second paying lamp |
| `superRun` | After paying/special land | 3–8 chained stops |

## Cabinet FX (mostly visual)
Frame LED rails, side lamps, 假保留燈, FEVER/READY, coin cascade / horse dash flourishes.
Classes on `#cabinet`: `fx-spin` / `fx-reach` / `fx-expect` / `fx-win` / `fx-fever`.
Bingo marks and stage pays are real (fake credit); flourishes are not.

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
- `resolveRound` steps (order): `once` / `land` (+ optional `double`) / `bingo` / `bonus` / `jp` / `super` / `slot` / `fever`.
  - Landing on ONCE MORE queues free light-runs (`single` 1 / `multi` 2–4 / `big` 3–5). Cap `MAX_ONCE_MORE_CHAIN`. UI countdown only — do not re-roll in `game.js`.
  - `land.fx` / `once.fx` drive `runLight` (reverse/skip/fakeStop).
- Classic bonus: `song` / `train` / `sanyuan`. JP: big BAR + BAR bet.
- Stages: `slot` (reel ids + match/gained/freeSpin), `fever` (runs[]), `super` (stops[]), `bingo` (cell/lines/board).
- Big/small: 1–4 / 6–9 / 5 push. Center reels cosmetic in base play; **slot bonus** uses them with staggered stop-feel.
- Prefer short Traditional Chinese UI copy on portrait.
- Layout follows real 小瑪莉 cabinets — don't reintroduce app-style top bars.
- Controls: `.btn` arcade push-button; bet keys on deck; LEDs in payout strip.
- Track / bet icons: CSS/SVG glossy fruit (`iconHTML`), not copyrighted IP.

## Viewport / iPhone 16 Pro Max
- Target CSS: **430×932** portrait, `viewport-fit=cover`, safe-area insets for notch / home indicator.
- `html, body` are `overflow: hidden` + `body { position: fixed; inset: 0 }` (no page scroll).
- `fitCabinet()` (game.js) measures cabinet height, applies `fit-1` / `fit-2` density, then sets `--W` so the machine clears `--pad-t` / `--pad-b`. Re-runs on `resize` / `orientationchange` / `visualViewport`.
- Touch targets ≥ 44px (knobs, chips, buttons, bet keys). Settings/help sheets scroll inside the dialog only.
- FX: win sparkles, 3-step lamp trails, reel bounce, FEVER splash/ring — all original CSS/SVG, no IP.

## How to test
```bash
python3 -m http.server 8000
node sim.js 50000          # RTP / hit / LUCKY / JP rates per preset
```
- DevTools device: **iPhone 16 Pro Max** portrait (430×932); also try shorter heights (~746 Safari chrome, ~700).
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
