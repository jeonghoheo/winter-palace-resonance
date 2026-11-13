# WINTER PALACE: RESONANCE — Session Instructions

Webcam hero action game. The player stands in front of a camera and copies an enemy's pose to steal ("resonate") its ability, holds the pose while an overload gauge rises, then releases it with a big overhead swing for up to 2x damage.

## Confirmed spec v1.0 (do not expand scope beyond this)

- Core loop: enemy telegraphs a pose -> player copies it (Resonance) -> hold while Overload rises 0-100 over ~4s (damage multiplier 1x-2x; over 100 the player takes damage) -> Release: raise both hands overhead, then chop down fast -> counter explosion.
- 4 copy poses, judged ONLY by large joints (shoulders/elbows/wrists) using shoulder-width-normalized coordinates. No finger/hand-shape detection for gameplay.
  - ALPHA: both arms crossed in an X over the chest (each wrist crosses the body midline to the opposite side).
  - BETA: T pose, both arms straight out horizontally at shoulder height.
  - GAMMA: asymmetric diagonal — one arm up diagonally above the head, the other arm down by the hip.
  - DELTA: both fists/wrists gathered together in front of the solar plexus, not crossed.
- Release detection is two-phase and ONLY active in the CHARGED state: (1) both wrists rise above head level, (2) within 0.6s both wrists drop below chest level with downward speed above threshold.
- Pose hold rule: classification must be stable (majority of the last 10 frames) for 0.3s to count as a successful copy.
- Display profiles (one web build): PC browser / phone browser / phone mirrored to TV (TV mode: HUD inside 5% safe margins, wake lock, large HUD).
- Mobile rules: adaptive performance (start 640x480 + lite model, scale by measured FPS), landscape placement guide, hands-free flow (countdown after start tap; pause/restart by holding ALPHA 2s), distance-readable HUD.
- All video processing is on-device. No server, no API calls, no video upload.
- Prototype success criteria (measured on the user's MacBook Air M1): pose recognition >= 90% per pose over 20 tries, zero false Release triggers, >= 25 FPS during effects.

## Design rules (researched — full sources in DESIGN-RESEARCH.md)

Apply these whenever a block touches effects, sound, HUD, or pose feedback. DESIGN-RESEARCH.md in this folder is the reference; the values below are the adopted ones.

### Game feel / juice
- Hitstop at 60fps: light hit 2-3 frames, medium 4-6, Release/heavy 8-12, killing blow 12-20. NEVER freeze the input buffer — frozen input reads as lag. If attacker/victim freeze differs, freeze the victim slightly longer.
- Hit flash: starts on the SAME frame as the hit (1 frame late reads as lag), lasts 3-6 frames, white or a hot color outside the enemy palette.
- Screen shake: trauma model. trauma += 0.2 (small event) or 0.5 (large); shake amount = trauma^2; use Perlin-style noise, not random jitter; amplitude from 0.4% of screen height (light) to 1.5% (explosion), decaying to 0 over 8-12 frames. Clamp combined shake.
- Particles: pooled, hard cap 2,000 alive; default burst 10-16 per event, lifetime 0.3-0.6s. Charge state emits a continuous inward stream toward the player's hands.
- Hit sounds: randomize pitch ±5% per hit to avoid repetition fatigue; pitch rises slightly with combo count.

### Sound
- Block 3 (prototype): generate sounds with jsfxr-style WebAudio synthesis using the recipes in DESIGN-RESEARCH.md (explosion = 1.2s noise buffer + lowpass sweep 1000->10Hz; impact = sine 180->30Hz over 0.12s; success chime = two detuned triangles B4 493.88Hz -> E5 659.26Hz; charge = a rising sweep whose pitch tracks the Overload gauge; alarm = sawtooth alternating 440/880Hz).
- Block 6 (final audio): first-choice source is Kenney audio packs (CC0, commercial use allowed, no attribution required — verified). Freesound only with the CC0 filter. OpenGameArt only CC0 or CC-BY (record attribution in CREDITS.md). NEVER use CC-BY-NC material (no monetization allowed).
- All sounds must start without user-visible delay; preload/decode at game start (after the Start tap, which also unlocks AudioContext).

### Motion-game UX / feedback
- Telegraph is triple: enemy animation + translucent ghost silhouette of the target pose + pose icon. Never rely on one channel.
- Show pose similarity as a continuous % while the player is adjusting, not pass/fail only.
- When a copy fails or is incomplete, hint ONLY the single most-off joint (e.g., an arrow on the left elbow), never a list of errors.
- Feedback wording frames timing and energy, not failure ("too early", "more power"), following Just Dance grading language.
- If the skeleton is lost or the player leaves the frame: pause all timers, show the reframing guide, resume when the skeleton is back. Never punish tracking loss as a player mistake.

### HUD
- Minimum text size 26px at 1080p, scaled proportionally to canvas height. Text contrast >= 4.5:1 against its background chip.
- HUD elements sit on dark translucent chips — the camera video behind them has unpredictable brightness.
- Keep all HUD inside the 5% safe margin in EVERY profile (not only TV), and keep simultaneous HUD elements to about 5 (own design decision).

### Pose tech
- Classification runs on RAW joint angles through an angle state machine with hysteresis (enter and exit thresholds differ, e.g., an elbow counts as straight above 160 degrees and bent below 100 degrees). Smoothing (One Euro filter, minCutoff 0.8-1.3, beta 0.01-0.05) is applied ONLY to the visual skeleton overlay, never to classification input — smoothing classification input makes judgments feel sluggish.
- Gate classification on landmark visibility; when key joints are not visible, output "no pose", never a guess.
- Pose model: lite + GPU delegate. Default capture 640x480 (the model internally uses 256x256, so higher capture mainly costs performance).

## Working rules

- Execute ONLY the block named in the user's instruction. One block per run.
- Stack: TypeScript + Vite + Canvas 2D. No game engine, no React. MediaPipe via @mediapipe/tasks-vision (PoseLandmarker, lite model).
- After finishing a block: run `npm run build` (must pass) and append a result entry to SESSION-LOG.md IN ENGLISH: what was built, files changed, build result, how to run it, and anything the user must test manually.
- Handover checklist (required at the end of every block log entry): list every requirement of that block and mark each one Built / Missing / Broken / Not assessed, based on the build and the screenshot below — not on intention. End the entry with the line "Not yet played by a person" until the user confirms a manual playtest of that block.
- Screenshot check (from Block 2 on): after the build passes, serve the production build and capture the initial (pre-camera) screen with headless Chrome at 1280x720, saved to `docs/screens/block-<n>-start.png`. Look at the screenshot: fix any text overflow, overlapping or off-screen elements before logging, and record the screenshot path in the log. If headless Chrome is unavailable, mark the screenshot "Not assessed" in the checklist instead of skipping it silently.
- If git is initialized, commit at the end of the block with a clear message. Do not create a remote or push unless SESSION.md says so.
- If a requirement in a block is technically impossible, stop, write the reason in SESSION-LOG.md, and do not silently substitute a different design.

## Roadmap (context only — do not build ahead)

1. Camera + pose tracking + FPS measurement — DONE (Block 1 + FIX, commits 2892279 / c137fa7). Measured on the user's MacBook Air M1 in Brave with a real camera: 5s-average FPS 60.2 at 640x480 and 58.4 at 1280x720; landmarks detected. Performance baseline confirmed — large headroom over the 25 FPS effects criterion.
2. 4-pose classifier + personal calibration + recognition-rate test mode (this block)
3. Core loop PoC: dummy target, Resonance -> Overload -> Release -> explosion, with the juice values and prototype sounds from the Design rules, PLUS a tweak panel (sliders for overload rise time, pose hold time, similarity threshold, hitstop frames, shake gain, particle burst size; values persisted in localStorage; toggled with the T key; hidden by default and always hidden in the TV profile) (fun gate)
4. First real Nightmare enemy + full HUD (per HUD rules)
5. Three enemy types + boss combo pattern
6. Setup/start screens, story cards, final audio (Kenney CC0 first, per Sound rules) + CREDITS.md
7. Phone/TV profiles, adaptive performance, public deployment, real-phone test

---

## Block 2 — Pose classifier, calibration, recognition test mode

Goal: turn the raw landmarks from Block 1 into reliable pose judgments, and measure the recognition rate per pose. No game loop yet.

Build:
1. `src/classifier.ts` — pure functions over RAW landmarks (no smoothing on this input):
   - Features: elbow angles L/R (shoulder-elbow-wrist), wrist and elbow positions normalized by shoulder width (SW), origin at mid-shoulder, y down as in image coordinates. Note in code comments which side convention is used (raw image coordinates vs the mirrored preview) and keep it consistent everywhere.
   - Visibility gate: nose, both shoulders, both elbows, both wrists must have visibility >= 0.5, otherwise output NO_POSE.
   - Per-pose conditions with hysteresis (enter threshold stricter than exit). Initial values (all tunable constants at the top of the file):
     - Elbow "straight": enter >= 160 deg, exit <= 150 deg. Elbow "bent": <= 120 deg.
     - ALPHA: left wrist crosses the midline to the opposite side AND right wrist crosses to the opposite side (in raw image x), both wrists vertically between chin and mid-torso, both elbows bent.
     - BETA: both elbows straight, both wrists within ±0.35 SW vertically of their shoulder, each wrist at least 1.1 SW horizontally away from its shoulder.
     - GAMMA: one wrist above nose level and at least 0.7 SW horizontally from midline, the other wrist below hip level and within 0.5 SW of midline; the two sides must be opposite.
     - DELTA: wrist-to-wrist distance <= 0.35 SW, both wrists within 0.3 SW of the midline, both wrists vertically between shoulder line and hip line, NOT crossed (wrists keep their own sides, unlike ALPHA).
   - Stickiness: once a pose is active it stays active until its own exit conditions fail; when several poses match at once, prefer the active one, otherwise DELTA > ALPHA > GAMMA > BETA.
   - Stability: a pose counts as RECOGNIZED after it is the classifier output for 0.3s continuously (timestamp-based, not frame-count-based).
   - Similarity: for a chosen target pose, a continuous 0-100 score from the normalized per-condition distances (document the formula in comments). Also return the single worst condition and which joint it belongs to (for the one-joint hint).
2. Practice UI (extend the Block 1 page):
   - Large current-pose label (ALPHA/BETA/GAMMA/DELTA/NO_POSE) and, when a target pose is selected, the similarity % as a big number + bar, plus the one-joint hint text when similarity < 80.
   - Target pose selector (4 buttons) for free practice.
   - Keep the FPS meter and resolution toggle from Block 1.
3. Calibration: a "Calibrate" flow — stand neutral 1s, then hold each of the 4 poses 1s when prompted. Store per-pose median feature values in localStorage and use them to adjust the classifier thresholds, bounded to ±20% of the defaults. A "Reset calibration" button restores defaults. If calibration data exists, show "calibrated" on the page.
4. Test mode: pick a pose (or All), run 20 trials. Each trial: show the target, wait until RECOGNIZED (success, record time-to-recognize) or 3s timeout (fail). If the skeleton is lost mid-trial, pause that trial's timer. Results table per pose: trials, successes, success %, average recognition time. Button to download the results as JSON.
5. Tests: add vitest and unit tests for the pure math (angle calculation, normalization, each pose's enter/exit on synthetic landmark sets, hysteresis behavior). `npm test` must pass.

Verify before logging: `npm run build` passes, `npm test` passes, screenshot check per the Working rules, handover checklist in the log.

Log in SESSION-LOG.md (English): files created/changed, the final threshold constants, build + test results, screenshot path, checklist, and a "user test" note: run calibration once, then run Test mode (All, 20 trials) and report the per-pose success % and average recognition times shown on screen.
