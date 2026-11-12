# Breezy Isle Sports

An original, motion-controlled sports game for the browser. Phase 2: the full game flow around the six-sport menu.
Three.js toon rendering, Rapier physics at a fixed 120 Hz, synthesised Web Audio (music too), and three controllers
that share one swing detector: **mouse**, **phone** (WebRTC) and **Joy-Con** (WebHID).

Flow: **Title → Profile select → Buddy creator → Main menu → Mode setup → Match → Results → back.**
Playable now: **Standard Bowling** and **100-Pin Bowling** (plus Practice). The other 12 modes are listed, greyed, with a "Coming soon" screen.

No Nintendo names, characters, music or assets are used. Buddies, icons, music and sound are all made in code.
## Install

```bash
npm install
```

Needs Node 18+ and a browser with WebGL + WebAssembly.

## Run

Two terminals:

```bash
npm run dev      # Vite on https://localhost:5173 (self-signed certificate)
npm run signal   # WebSocket signalling server for the phone controller (port 8787)
```

Open `https://localhost:5173` and accept the certificate warning once.
`npm test` runs all unit tests; `npm run typecheck` runs strict TypeScript.

## Controllers

### Mouse (works everywhere)
1. Move the mouse left/right to aim (cyan arrow on the lane).
2. Press and **hold** the left button on the lane.
3. Drag **down** (backswing), then flick **up** quickly (forward swing).
4. **Let go** during the flick. Moving sideways as you let go adds hook.

### Phone
1. Phone and computer must be on the same Wi-Fi. Keep `npm run signal` running.
2. Main menu → Settings → Controller → Phone. Scan the QR code (or type the URL shown).
3. Accept the certificate warning on the phone, tap **Tap to enable motion** (iOS asks for permission).
4. Hold the phone flat in your palm, screen up, top pointing at the screen. Hold the big button, swing, let go.
5. Rumble uses `navigator.vibrate` (Android only; iOS Safari doesn't support it).

### Joy-Con
1. Pair the Joy-Con with the computer over Bluetooth.
2. Use **Chrome or Edge 89+ on desktop** (WebHID). Firefox and Safari show a clear "not supported" message.
3. Main menu → Settings → Controller → Joy-Con, pick it in the browser popup.
4. Hold it vertically like a remote. ZR/ZL/R/L = trigger, A = A, B = back/pause. Rumble on release and impact.
5. If the swing reads backwards in the debug panel, flip the sign in `AXES` in `src/input/JoyConBackend.ts` or set `swingSign` to -1.

Phone and Joy-Con run a 2-second **calibration** before each game: hold still, pointing at the screen.
It measures gyro bias and stores the forward direction.

## Keys

| Key | Action |
|---|---|
| Tab | Toggle scoreboard |
| Esc / Backspace / B | Back (pause in a match) |
| Arrows + Enter | Move and select in menus |
| Q / E | Spin your Buddy in the creator |
| M | Mute (saved in Settings) |
| F3 | Debug panel: sensor graphs, rate, latency, last swing, live tuning sliders |

## How the throw works

- `SwingDetector` state machine: idle → aiming (trigger down) → backswing (pitch rate < `-backswingRate`) → forward (pitch rate > `forwardRate`) → release (trigger up).
- **Speed:** peak forward pitch rate (+ a little linear accel), mapped between `weakRate` and `rateForMaxSpeed` onto `speedMin`–`speedMax` with `speedCurve`.
- **Direction:** yaw change during the swing × `yawToAngle`, clamped to ±`maxAngleDeg`; jerky swings add random noise.
- **Spin:** wrist roll rate at release / `rollRateForMaxSpin` × `maxSpin`.
- **Hook:** `Ball.physicsStep` adds a lateral impulse `hookGain × spin × mass × g × dryness`. Dryness is 0 on the oil (first `oilLength` m) and 1 on the dry back end. Spin decays by `spinDecay` per second on the dry part.
- Orientation comes from a complementary filter (`src/math/Filter.ts`): gyro integration plus `filterGain` of gravity tilt correction per sample.


## What's in Phase 2

| Area | Where |
|---|---|
| Sports registry (6 sports, 14 modes, lazy scenes) | `src/sports/registry.ts`, `src/sports/types.ts`, icons in `src/sports/icons.ts` |
| 100-Pin layout and scoring | `src/sports/pinLayouts.ts`, `src/sports/scoringHundred.ts` |
| Handicap | `src/sports/handicap.ts` (80% of 200 − average, 800 for 100-Pin) |
| Buddies | `src/buddy/` config, builder, animator (named states), creator screen, 2D avatar |
| Saves | `src/save/` one key `breezyIsle.save`, `schemaVersion: 1`, migrations, memory fallback |
| XP, unlocks, achievements | `src/progression/` |
| Audio | `src/audio/Mixer.ts` (buses, −8 dB ducking), `Music.ts` (procedural, per-sport flavour, 1 s crossfade), `CrowdSfx.ts`, `Sfx.ts` |
| Screens | `src/screens/` stack `ScreenManager` with 250 ms transitions; match runs in `src/match/MatchHost.ts` |
| Navigation | `src/core/Nav.ts` mouse / arrows+Enter+Esc / motion pointer (trigger = select, B = back) |
| Settings | `src/core/settings.ts` device settings + per-profile overrides (controller, accessibility) |
| Quality | `src/core/Quality.ts` Low/Med/High, auto-lowers when FPS stays under 55 |
| Language | `src/i18n/` English + Dutch via `t(key)` |
| Events | `src/core/events.ts` typed bus: roll, strike, spare, gutter, gameEnd, achievement, unlock… |

### Decisions I made where the brief left room
- "13 modes": the menu lists 14, so the registry has 14.
- Practice re-racks every ball and only uses player 1.
- Auto-lowered graphics last for the session; the saved setting stays what you picked.
- The game always starts on the mouse; your saved controller choice pre-selects it in Settings (Joy-Con needs a click to connect).
- `xpForLevel(n)` is the XP needed to go from level n to n+1.
- Colour-blind mode swaps player colours to the Okabe–Ito palette at match start.

## Test checklist (Phase 2)

1. `npm test`: registry, i18n parity, 10-pin and 100-pin scoring, XP, handicap, saves, achievements all pass. `npm run typecheck` is clean.
2. `npm run dev`: title over the island flyover. Click → "Who's playing?".
3. New profile → creator: change every category, drag to spin, Randomize, try the name "fuck" (blocked), name it, Done → main menu with your chip top right.
4. Reload the page: the profile is still there with the same Buddy.
5. Open each of the six tiles: mode panel shows every mode; non-bowling ones are greyed with SOON.
6. Pick a coming-soon mode (e.g. Swordplay → Duel) → Start: friendly placeholder, "Go bowling" opens bowling setup.
7. Standard Bowling, 2 players (you + Guest), 5 frames, handicap on → play to the end. Buddies swing with your controller and react; results show the podium, XP and badges.
8. 100-Pin Bowling: wider lane, the pin wall, 50+/80+ bonus text, FPS counter (Settings → Graphics) stays near 60; on a slow machine a "graphics lowered" toast appears.
9. Unlock something: a strike gives First Strike (headband); reaching level 2 unlocks the sparkle trail and sun hat. Check the toast, the Stats screen and the lock disappearing in setup/creator.
10. Profile select → Export, delete the profile (confirm), Import the file back. Try importing a random .json: clear error toast.
11. Settings → Language → Nederlands: every screen switches. Toggle high contrast, bigger text, reduced motion, gutter assist (bumpers in the next ball).
12. Settings → Controller → Phone (QR) or Joy-Con: calibrate, navigate menus by pointing (trigger selects, B goes back), bowl, press B to pause → Resume / Restart / Settings / Quit.

## How to add a new sport

1. Write the scene: `src/<sport>/<Mode>Scene.ts` exporting a `SceneFactory` that returns a `SportScene` (see `src/game/BowlingScene.ts`): `fixedStep`, `frame`, `start`, `restart`, `setPaused`, `setQuality`, `refreshSettings`, `dispose`, and call `ctx.onFinished(summary)` at the end.
2. In `src/sports/registry.ts`, set that mode's `status: 'playable'`, `scene: () => import('../<sport>/<Mode>Scene').then(m => m.create…)`, its options and scoring type.
3. Add any new text keys to `src/i18n/en.ts` and `nl.ts` (the registry test fails until both have them).
4. Give the sport its rewards: `registerAchievement(...)` in a `progression` file and `registerUnlock(...)` for items, and put sport-specific counters in `PlayerResult.stats` (they land in `stats[sport][mode].extras` automatically).
5. Add Buddy poses with `BuddyAnimator.define('slash', …)` and a music flavour in `SPORT_FLAVOUR` (`src/audio/Music.ts`) if you want it to sound different.

## Phase 1 checklist (still valid for the throw itself)

1. `npm test`: all scoring tests pass (300, 0, 150, 190, 90, 167, 10th-frame racks).
2. `npm run dev`, open the page: the title appears over the island, no console errors.
3. Play with the mouse: hold, drag down, flick up, release. The ball rolls and the camera follows, then cuts to the pins.
4. Release without moving: weak roll plus the hint text. Fast flick: about 35–40 km/h on the power meter.
5. Flick sideways while releasing: the ball hooks on the last third of the lane.
6. Knock pins down: crash sound, shake, scoreboard pops up. Strike: slow motion, confetti, "STRIKE!". Check frame 10 bonus balls.
7. Press F3: graphs move while you swing, rate ~120 Hz for the mouse, sliders change feel live.
8. Start `npm run signal`, choose Phone, scan the QR code. Status says "Phone connected", F3 shows 60–100 Hz and latency.
9. Swing the phone: the arm follows on screen, release throws. Calibration ran before the game.
10. In Chrome/Edge choose Joy-Con, connect, calibrate, throw. You feel rumble on release and impact. In Firefox the menu explains it's unsupported.

## Tuning guide: the 8 values to change first (`src/tuning.ts`)

| Problem | Change |
|---|---|
| Throws feel too **weak** | Lower `rateForMaxSpeed` (e.g. 14 → 10) or raise `speedMin` |
| Throws feel too **strong** / always max | Raise `rateForMaxSpeed`, or raise `speedCurve` above 1 |
| Gentle swings count as "no swing" | Lower `weakRate` and `forwardRate` |
| Swings trigger by accident | Raise `backswingRate` and `forwardRate` |
| **Too much hook** | Lower `hookGain` (0.016 → 0.010) or `maxSpin` |
| Hook starts too early / too late | Move `oilLength` (longer = later hook) |
| Ball goes wide too easily | Lower `yawToAngle` or `maxAngleDeg` |
| Orientation drifts / wobbles | Raise `filterGain` for less drift, lower it for less swing wobble |

## Put it on GitHub Pages

1. Create a GitHub repo (e.g. `breezy-bowling`) and push this folder to the `main` branch.
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml`: install, test, build, deploy.
   The game appears at `https://<your-username>.github.io/breezy-bowling/`.
4. If the repo is your user site (`<username>.github.io`), change `BASE_PATH` in the workflow to `/`.

What works on Pages: **mouse** and **Joy-Con** (Pages is HTTPS, which WebHID needs).
The **phone** controller also needs the signal server, which Pages can't run. To enable it:
1. Host `server/signal.ts` on any Node host with WebSockets (Render, Fly.io, Railway…), start command `npx tsx server/signal.ts`. It reads `PORT` from the environment.
2. In the GitHub repo: **Settings → Secrets and variables → Actions → Variables**, add `SIGNAL_URL` = `wss://your-signal-host`.
3. Push again. The QR code now points phones at your Pages URL, and both sides meet on that server.

## Known limitations

- None of this has been run on real hardware yet. Joy-Con axis mapping (`AXES`) and the phone sign probe may need one flip for your device.
- The phone page uses a self-signed HTTPS certificate, so each phone must accept the warning once.
- WebRTC uses host candidates plus a public STUN server. Phone and computer need to be on the same network.
- `joy-con-webhid` ships without types; `src/globals.d.ts` declares the subset used. If `npm install` can't find `^0.6.0`, use the newest available version.
- Older iOS reports `accelerationIncludingGravity` inverted. The phone page probes the sign during the first 30 samples (hold the phone flat when you start).
- Pins use four-part compound colliders. Pin action is "toy-like" rather than a tour-grade simulation.
