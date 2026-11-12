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

## Table tennis (Phase 3)

Two modes: **Match Play** (vs. AI at 5 levels or 2 local players, best of 1/3/5) and **Return Challenge** (a ball machine, targets, combo ×1–5, 3 lives).
The ball does not use Rapier. `src/tabletennis/BallPhysics.ts` is a hand-written 240 Hz simulation (drag, Magnus, swept collisions against table, net, posts and paddle) seeded for determinism.

### How the controls work

**Phone / Joy-Con (assisted paddle).** These give orientation, not position, so the paddle slides along the ball's predicted path by itself. You control:
- **Timing**: when you swing. Within `perfectMs` of the ideal moment you get PERFECT; later or earlier the ball hits nearer the paddle edge (weaker, odd angle). Outside `timingWindowMs` it's a miss.
- **Power**: swing speed (`rateForFullPower` = full power).
- **Direction**: paddle yaw at contact → left/right.
- **Loft**: paddle pitch at contact → low drive or high lob.
- **Spin**: brush up for topspin, down for backspin; roll the paddle for sidespin.
- **Forehand / backhand**: from the swing direction, mirrored by the handedness setting.
- **Serve**: press the trigger to toss (~0.2 m), then swing before it drops. A late swing gives a weak but legal serve.

**Mouse.** The paddle follows the mouse on a plane, capped at `mouseMaxSpeed` so it can't be overpowered. Flick up through the ball to hit; mouse speed = power. Hold **left** for topspin, **right** for backspin. Click to toss on a serve.

**2 players.** Turn on split controllers in Match Play setup and give each player a different controller kind (e.g. mouse + phone). If player 2's controller is skipped, the AI plays instead.

### How to tune the feel

All values live in `src/tabletennis/ttTuning.ts`, each with a comment. Press **F3** in a match: the "Table tennis" sliders change them live, and the overlay shows ball speed, spin (rpm), last contact quality, AI level, the predicted landing point and a drawing of the last contact (point on the face, face angle, spin). Copy values you like back into the file. See the tuning guide below.

### How to add an AI level

1. Add an entry to `AI_LEVELS` in `src/tabletennis/AI.ts` (keep them ordered easy → hard). Fields: `reactionMs`, `moveSpeed` (m/s), `timingErrMs`, `aimErr` (m), `variety` (0–1 chance of lob/spin/smash), `risk` (0–1, how close to the lines it aims), `power` [min, max], `care` (net retries when planning, 0 = nets a lot).
2. Add `ai.level.<id>` to `src/i18n/en.ts` and `nl.ts`.
3. Raise the `ai` option's range in `src/sports/registry.ts` (Match Play options).
4. Run `npm test`: `AI.test.ts` checks that the strongest beats the weakest ≥95% and that same-level games stay near 50%.

### Where latency could creep in (target < 50 ms swing → hit)

- `SwingDetector` (paddle mode) emits on the first sample after the swing peak, so it's one sample late: ~8 ms on the mouse, ~10–16 ms on phone or Joy-Con. No smoothing is added; don't add any there.
- Phone: the WebRTC data channel (F3 shows its latency). Joy-Con: its ~66 Hz report rate.
- `TTBase.fixedStep` maps the swing's timestamp onto engine time, so a hit lands at most one 120 Hz step late. A swing that's early on purpose waits for the ball (that's the timing window, not lag).
- Rendering: the frame after the hit (up to ~16 ms at 60 FPS). Heavy graphics settings make this worse.

### Table tennis test checklist

1. `npm run typecheck` and `npm test`: physics, rules, shot, AI, Return Challenge and progression tests pass (AI tests take a while).
2. Mouse rally vs. Beginner: the paddle follows the mouse, flick up returns the ball, EARLY/LATE/PERFECT text shows at contact.
3. Serve with the mouse: click to toss, flick to hit. Let the ball drop without swinging: you lose the point.
4. Net cord: hit low shots until one clips the tape. Muffled tick, the ball slows and wobbles. On a serve it's called LET and replayed.
5. Deuce: reach 10–10 (2P or a long match). "Deuce!" shows, then serve changes every point and you need 2 clear points.
6. Each AI level (0–4): Beginner nets and goes long often, Master almost never misses. F3 shows the AI level and predicted landing.
7. Topspin vs. backspin (hold left/right): F3 rpm changes sign and the ball dips vs. floats.
8. Rally of 10+: "RALLY ×10" flash, the crowd cheers, the music adds a layer.
9. Match point won: the side-camera replay plays at half speed. Skip it with a click / trigger. Then results and Rematch.
10. 2-player: split controllers on, mouse + phone (or Joy-Con). Each player hits only with their own controller.
11. Return Challenge: miss 3 balls to end it (lives drop with a sound), hit targets for +25, see the combo grow and the level step up every 10 returns. The best score shows on the results screen.
12. Phone and Joy-Con: calibrate, serve with the trigger, swing to hit. Turning the paddle aims, tilting it lobs, Joy-Con rumbles on every hit (stronger with power).

### Table tennis tuning guide: the 8 values to change first (`src/tabletennis/ttTuning.ts`)

| Problem | Change |
|---|---|
| Shots feel **floaty** | Raise `drag` (0.12 → 0.16) or lower `driveApex` (0.2 → 0.15) |
| Spin does too little / too much | `magnus` (0.0055): up for more dip and curve, down for less |
| Shots feel **too fast** | Lower `smashPower` and raise `rateForFullPower` (18 → 22) |
| Hits feel too weak | Lower `rateForFullPower` (18 → 14) |
| **Too hard to time** | Raise `timingWindowMs` (170 → 220) and `perfectMs` (35 → 50) |
| Too many nets / mistakes for the player | Raise `netClearAssist` (0.6 → 0.8) |
| Mouse too strong / too weak | `mouseMaxSpeed` (9): lower to calm it down |
| **AI feels unfair** | Edit `AI_LEVELS` in `AI.ts`: raise `reactionMs` / `timingErrMs`, lower `care` for more nets |

## Basketball (Phase 4)

Two modes: **3-Point Contest** (1–4 players in turns, 5 racks × 5 balls, money balls, 60 s, sudden death on a tie, practice, optional money rack) and **3-on-3 Pickup** (half court, you plus 2 AI teammates against 3 AI, first to 11 or 21, Easy / Normal / Hard).
The ball flies in Rapier at 1/120 s with CCD. The rim is 20 capsules, the backboard is a box (restitution 0.6), and the floor is 0.75. A basket counts only when the ball goes down through a plane above the rim and then down through a plane below it within 0.6 s (`HoopSensor.ts`). The net is a cosmetic Verlet net, with drag on the ball inside it.

### Controls

| | Phone / Joy-Con | Mouse + keyboard |
|---|---|---|
| Shoot | Hold the trigger to **set** (arc preview + aim arrow), lift to **jump**, flick up: the flick peak is the release. Best within ±`perfectMs` of the jump apex (PERFECT / GOOD within ±120 ms / EARLY / LATE). Controller yaw = aim | Aim with the pointer, hold the left button: the power meter bounces, let go in the drifting sweet spot |
| Move (pickup) | Joy-Con stick / phone touch joystick | WASD or arrows |
| Sprint | A button | Shift |
| Pass | Push the controller forward; turn it left/right to pass to that side, otherwise to the highlighted teammate (white ring) | Space or right-click; 1 / 2 picks the teammate |
| Steal | Sideways swipe near the ball handler | E (or right-click on defence) |
| Block / jump | Up-flick on defence | Space / F (or left-click on defence) |
| Skip replay | Any gesture | Any key or click |

Dribbling is automatic. In pickup, control switches by itself: to whoever has the ball on your team, and to the defender guarding the ball handler on defence. Left-handed (Settings → Hand) mirrors your Buddy's shooting and dribbling hand.

### Shot assist

Settings → **Shot assist**: Off / Low / High (default) / Very high. Your shot never aims itself. `ShotSolver.solveIdealShot` finds the perfect launch, and your power, direction and timing errors are added to it, shrunk by the assist factor (`ASSIST_SCALE` = 1 / 0.72 / 0.5 / 0.3). Defenders and distance add extra random error in pickup (`contestErr`, `distErr`), and assist does not reduce that. The AI never gets assist.

### Tuning

All values are in `src/basketball/bbTuning.ts`, each with a comment. Press **F3** in a match: the "Basketball" sliders change them live. The overlay shows ball speed, the last shot's power / direction / timing error and outcome, make % with the assist level, a side view of the last shot (ideal arc in cyan, actual in orange) and, in pickup, every player's role and AI state.

### How to add a court look

1. Add the id to `CourtLook` and an entry to `LOOKS` in `src/basketball/CourtScene.ts` (sky, fog, floor/court/paint/line colours, light, `wood`). Scenery that is specific to a look (bleachers, fence, skyline) is built in the `CourtScene` constructor by look id; add a branch for yours there.
2. Register the unlock in `src/basketball/bbProgression.ts`: `unlock('court', '<id>', { type: 'level', n: 5 })` (or `games` / `achievement`).
3. Add `court.<id>` to `src/i18n/en.ts` and `nl.ts`. It shows up under Court in mode setup.

### Where latency could creep in (target < 50 ms flick → ball in the air)

- `SwingDetector` (hoops mode) reports the release on the first sample after the flick peak, with no smoothing: about 10–16 ms on phone or Joy-Con. Don't add filtering there.
- Phone: the WebRTC data channel (F3 shows its latency). Joy-Con: its ~66 Hz report rate.
- The release is applied in the next frame and the ball launches in the next 1/120 s physics step, so at most ~16 ms more at 60 FPS.
- Mouse: none extra. The release is the button-up event, read once per frame.

### Basketball test checklist

1. `npm run typecheck` and `npm test`: ShotSolver, HoopSensor, contest and pickup rules, and AI tests pass (the 100-game AI test takes a while).
2. Contest with the mouse: the meter bounces and the sweet spot drifts; letting go in it gives PERFECT and usually a swish.
3. Contest with phone or Joy-Con: hold the trigger (arc + arrow show), lift and flick. A flick at the top of the jump gives PERFECT; early/late labels match.
4. Money balls: the 5th ball of each rack is coloured and scores 2. With the money-rack option on, the announced rack is all money balls.
5. Clock: after 60 s the buzzer sounds; a ball in the air still counts. A make released in the last second gets slow motion and counts for Buzzer Beater.
6. Racks: after 5 balls the Buddy moves to the next rack in 0.8 s while the clock runs. The HUD shows timer, score, rack balls, rack highlight and streak.
7. 3 makes in a row: ON FIRE, the flame trail and the extra music layer. A miss ends it.
8. 2–4 players tie: sudden death from the top rack until someone wins. Results show the personal best.
9. Practice: no clock; after each shot you see angle, power, aim and timing.
10. Pickup: move with WASD/stick, Space/push to pass (white ring = target, 1/2 picks), shoot from outside the arc = 2. After a steal or a defensive rebound, "Take it back outside the arc!" shows, and a basket before that doesn't count.
11. Defence: E/swipe near the ball handler steals sometimes (better when facing them), Space/up-flick when they shoot blocks sometimes. F3 lists the AI roles and states.
12. Win the pickup game: half-speed replay of the winning basket (skip with any key or gesture), then results with XP, assists, steals and blocks.

### Basketball tuning guide: the 8 values to change first (`src/basketball/bbTuning.ts`)

| Problem | Change |
|---|---|
| Shots go in **too easily** | Raise `powerGain` (0.3 → 0.4) and `dirGain` (0.28 → 0.35) |
| Shots are **too hard** | Raise `powerBand` (0.12 → 0.18); players can also raise Shot assist |
| **Timing too strict** | Raise `perfectMs` (40 → 60); GOOD stays at `goodMs` (120) |
| Shots feel **floaty** / too flat | `arcDeg` (52): lower for flatter, faster shots, raise for rainbows |
| Jump feels slow / fast for the flick | `jumpApexMs` (280): the moment the apex (best release) comes |
| Flicks don't register / fire too easily | `flickRate` (5.5): lower if shots don't go off, raise if they fire by accident |
| Mouse too easy | Lower `sweetWidth` (0.12 → 0.08) or raise `sweetDrift` |
| **Pickup AI feels unfair** | `contestErr` (0.05) for how much a defender hurts shots; per-difficulty values (`powerSd`, `stealChance`, `blockChance`, `reaction`) are in `AI_DIFFICULTY` in `bbAI.ts` |

## Frisbee (Phase 5)

Two modes: **Frisbee Dog** on the Beach Park (10 throws, the dog chases, catches and brings the disc back; 1–4 players in turn, practice) and **Frisbee Golf** (stroke play over 9 holes on the Meadow Course, Cliffside Course or the unlockable Night Course; 1–4 players, practice).
The disc flies in a hand-written model at 1/240 s (`src/frisbee/DiscPhysics.ts`): lift and drag from the angle of attack with a stall, a pitching moment that turns into roll through the spin (gyroscopic precession), per-disc turn and fade, wind with gusts, and ground contact (bounce, skid, rolling on edge, water stops it, trees knock it down).

### Throw controls

| | Phone / Joy-Con | Mouse + keyboard |
|---|---|---|
| Throw | Hold the trigger (grip), swing back and flick. The throw happens at the flick peak, no smoothing | Press the left button, pull back (like a slingshot) and let go. The throw goes the opposite way of the pull |
| Speed | How fast the flick is (8–32 m/s, depends on the disc) | How far you pull |
| Direction | Controller yaw at the release (±35°) | Pull sideways |
| Loft (−5…25°) | Controller pitch | W/S or the wheel ("nose" slider) |
| Bank / hyzer–anhyzer (±35°) | Controller roll: right edge down = anhyzer, curves right for right-handers | A/D ("bank" slider) |
| Spin | Wrist roll rate + flick (10–60 rad/s); a clean, fast release spins more and wobbles less | Fixed medium spin |
| Forehand | A sideways (yaw) flick toward your throwing side | – |
| Golf only | ←/→ or Q/E aim (Shift = fine), 1/2/3 driver / midrange / putter, V aim aid, Tab scorecard, any key skips the fly-over | same |

Left-handed (Settings → Hand) mirrors spin, forehand side and the Buddy. Inside 10 m of the basket a golf throw is a **putt**: the same input mapped onto 3–12 m/s.

### Scoring

- **Dog** (`dogScoring.ts`): a catch is 10 + 1 per metre, +20 mid-air, +30 for a leap; ×1.5 / ×2 / ×3 inside the blue / yellow / pink ring; +0.25 per catch in a row before it (max ×2); capped at 100 per throw, so a perfect round is 1000. A miss is 0 and resets the streak.
- **Golf** (`GolfRules.ts`): every throw is a stroke from where the disc stopped. Out of bounds (outside the flags, or water) is +1 and you throw again from the last lie. Farthest from the basket throws next; on the tee the best score on the last hole goes first. 8 throws at most per hole. The disc is in if it enters the chains slowly (≤ 8 m/s) and low (below 1.15 m); faster or higher it may rattle out (seeded, `Basket.ts`).

### Tuning

All values are in `src/frisbee/frisbeeTuning.ts`, each with a comment. Per-disc flight numbers (lift, drag, turn, fade, max speed) are in `DISC_TYPES`. Press **F3** in a match: the "Frisbee" sliders change them live. The overlay shows disc speed, spin, wobble, tilt, angle of attack, CL/CD/CM, wind, the dog's state and target, and a drawing of the last throw (top view direction, bank, loft and nose, spin / quality / speed bars).

### How to add a hole or a course

1. A hole is a `HoleDef` in a course file in `src/frisbee/courses/` (tee at 0,0, basket toward −z): `par`, `basket`, `bounds` (the in-bounds rectangle), optional `fairway` points, `trees` (use `grove()` / `treeLine()`), `rocks`, `ponds`, `sand`, `elev` (basket height above the tee) and `wind`. Append it to `holes`. Keep par 3 at 40–75 m and par 4 at 80–120 m (the course test checks this).
2. A new course: copy `meadow9.ts`, give it a new `id`, `look`, `palette` and 9 holes, add it to `COURSES` in `courses/index.ts` and to `CourseId` in `courses/types.ts`, register `unlock('course', '<id>', …)` in `fbProgression.ts`, and add `course.<id>` to `en.ts` and `nl.ts`. It shows up under Course in mode setup.

### How to add a dog type

1. Add an entry to `DOG_BREEDS` in `src/frisbee/DogAI.ts`: `speed` (m/s), `accel`, `turn` (rad/s), `jump` (m), `skill` (0–1: aim error and catch chance), `reaction` (× `dogReaction`), `coat` colours and `size`. Add the id to `DogBreedId`.
2. Register `unlock('dog', '<id>', { type: 'level', n: 8 })` in `src/frisbee/fbProgression.ts` and add `dog.<id>` to both languages.
3. Run `npm test`: `DogAI.test.ts` checks that a better breed catches more often; add your breed there if you want a target rate.

### Where latency could creep in (target < 50 ms flick → disc in the air)

- `SwingDetector` ('disc' mode) feeds `FlickTracker`, which fires on the first sample after the peak (no smoothing): about 10–16 ms on phone or Joy-Con. Don't add filtering there.
- Phone: the WebRTC data channel (F3 shows its latency). Joy-Con: its ~66 Hz report rate.
- The disc is launched in the same step the flick is reported; the next physics step is at most ~8 ms away (two 1/240 s steps per 1/120 s host step), plus up to one frame to draw.
- The dog's prediction (`simulateFlight`, ~1–3 ms) and the golf preview arc (recomputed at most ~8×/s while aiming) run on the main thread. On a slow device lower the quality so they don't stretch a frame.
- Mouse: none extra; the release is the button-up, read once per frame.

### Frisbee test checklist

1. `npm run typecheck` and `npm test`: DiscPhysics (incl. 10 000 random throws without NaN), ThrowMapper, dogScoring, DogAI, GolfRules, Basket, fbProgression and registry tests pass.
2. Dog, mouse: press, pull back, let go. The disc flies the opposite way of the pull; A/D tilts it (it curves that way), W/S lifts the nose. The sliders show while aiming.
3. Dog, phone / Joy-Con: hold the trigger (the Buddy winds up, "Grip" shows), flick: the throw goes at the flick peak. A wrist roll banks the disc; a lazy flick goes short and wobbles.
4. The dog reacts, runs to where the disc will come down and leaps for high ones: side view in slow motion. The HUD shows distance and ring during the flight and the points after.
5. The dog brings the disc back; about 2 s later the next throw is ready. After 10 throws the next player goes; results show a per-throw table under "Details" and the personal best.
6. Practice (Dog): endless throws, a read-out of speed, spin, direction, loft, nose, bank, quality and what the catch would score.
7. Golf: the fly-over plays (any key skips), the board shows hole, par, distance, height difference, total; the mini-map shows the lies and your aim.
8. Aim with ←/→; 1/2/3 changes the disc, the recommended one has a "tip" tag. V cycles the aim aid: Off / Short (first second of the arc) / Full (whole arc + landing ring).
9. Land in the water or outside the red flags: "Out of bounds +1", you throw again from the same spot.
10. Inside 10 m: "Putt!", softer throw, camera closer. A slow, low putt goes in with chains and swinging chains; a hard, high one can rattle out.
11. 2+ players: the farthest from the basket throws next; Tab shows the scorecard (birdie circled, bogey boxed). After 9 holes the lowest total wins.
12. Achievements and unlocks: e.g. an ace gives "Ace" and the Galaxy disc; a round under par unlocks the Night Course (glowing baskets).

### Frisbee tuning guide: the 8 values to change first (`src/frisbee/frisbeeTuning.ts`)

| Problem | Change |
|---|---|
| Throws go **too short** / too far for the effort | `rateForMax` (22 rad/s): lower it so an easier flick reaches full speed; `speedMax` (32) caps the top |
| Flicks **don't register** / fire by accident | `flickRate` (6 rad/s): lower if throws don't go off, raise if waving fires them |
| Discs **hook too hard** at the end | `fadeK` (0.7): lower for straighter finishes |
| Fast throws **turn over** (curve the wrong way) too much | `turnK` (0.012): lower for more stable drivers |
| **Bank too sensitive** on the controller | `rollGain` (0.8): lower to need more wrist roll for the same bank |
| The **dog is too good / too bad** | `dogCatchBase` (0.97) for the catch chance, `dogReaction` (0.35 s) for how fast it starts running |
| Discs **slide too far** after landing | `friction` (0.55): raise to stop sooner (per-surface factors are in `surfaceFriction`) |
| **Mouse throws too strong** compared with motion | `slingCap` (0.86 of the disc's max speed) |

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
