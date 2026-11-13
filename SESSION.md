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
2. 4-pose classifier + personal calibration + recognition-rate test mode — code done (commit e85d758); Block 2 FIX done (commit 5f55997, tests 38/38). Second human playtest (2026-11-13): ALPHA works; BETA still hard AND the drawn skeleton itself warps/bends at T-pose (a landmark-quality problem, not a threshold problem); GAMMA similarity rarely passes ~40% (suspected: one or more conditions score near zero structurally); DELTA still fails. Next: Block 2 FIX 2 (measurement round — full model option + per-condition breakdown + attempt recorder with parallel 3D world-landmark angle capture; NO threshold changes until real attempt data exists). Full 20-trial measurement still pending. Recognition improvement ladder agreed with the user (2026-11-13): FIX 2 measurement -> Full model + 3D-landmark angles -> RTMPose only if still insufficient, and that decision waits until after the Block 3 fun gate.
3. Core loop PoC: dummy target, Resonance -> Overload -> Release -> explosion, with the juice values and prototype sounds from the Design rules, PLUS a tweak panel (sliders for overload rise time, pose hold time, similarity threshold, hitstop frames, shake gain, particle burst size; values persisted in localStorage; toggled with the T key; hidden by default and always hidden in the TV profile) (fun gate)
4. First real Nightmare enemy + full HUD (per HUD rules) + art direction decision (style candidates are collected in the project notes; the user decides them in this block)
5. Three enemy types + boss combo pattern
6. Setup/start screens, story cards, final audio (Kenney CC0 first, per Sound rules) + CREDITS.md
7. Phone/TV profiles, adaptive performance, public deployment, real-phone test

---

## Block 2 FIX — classifier tuning from the first human playtest (do this before Block 3)

Playtest feedback from the user (2026-11-13, real camera, real person):
- ALPHA: recognized well.
- BETA: recognized only with effort — thresholds too strict.
- DELTA: when the user performs DELTA, ALPHA fires instead.
- GAMMA: hard to recognize, and the pose intent was not obvious to the user.
- The user also suspects BETA/GAMMA failures are partly a framing problem: at MacBook distance his outstretched/raised hands leave the camera frame (the MacBook webcam FOV is narrow).

Required changes (src/classifier.ts unless noted):
1. ALPHA vs DELTA disambiguation by wrist distance FIRST: the true signature of DELTA is "wrists together", of ALPHA "wrists apart on crossed sides".
   - If wrist-to-wrist distance <= 0.45 SW, ALPHA must NOT activate, no matter how far the wrists have crossed the midline (hands gathered at the center naturally overshoot the midline slightly).
   - ALPHA gains a condition: wrist-to-wrist distance >= 0.50 SW (an X has separated hands; hands near the opposite shoulders).
   - DELTA's own-side condition is relaxed: a wrist may overshoot the midline by up to 0.15 SW and still count as DELTA, as long as the wrist-distance condition holds.
   - Update the similarity scoring for ALPHA and DELTA to match the new conditions, and add unit tests: (a) synthetic DELTA with wrists together and slightly crossed -> DELTA, not ALPHA; (b) synthetic ALPHA with wrists apart and crossed -> ALPHA.
2. BETA relaxed (real elbows rarely reach a true 160 degrees on camera): elbow straight enter >= 150 deg / exit >= 140; wrist vertical tolerance enter 0.45 SW / exit 0.55; wrist horizontal distance enter 1.00 SW / exit 0.90.
3. GAMMA relaxed: up-wrist horizontal enter 0.55 SW / exit 0.45; up-wrist vertical passes if it is above nose level OR at least 0.90 SW above the shoulder line; down-wrist passes at hip level (enter margin 0.00 SW below the hip line).
4. Practice-mode debug readout (src/main.ts + index.html): one small line under the similarity display showing live values — elbow angle L / R (degrees), wrist distance (SW), and each wrist's crossing offset from the midline (SW, signed). This is a tuning aid; keep it visually minor.
5. Framing help (practice and test modes):
   - Draw a framing guide rectangle on the overlay: the zone the player should occupy — head near the top margin, hips above the bottom margin, and enough side margin that a T-pose fits. Show it whenever tracking is running in practice/test mode.
   - When the upper body is tracked but a wrist landmark is within 5% of any frame edge or its visibility is below 0.5, show a specific warning chip naming the side from the user's mirrored point of view (e.g., "Your left hand is out of frame — step back"). Framing problems must be distinguishable from pose errors; this warning takes precedence over the generic NO_POSE display for that case.
6. Keep calibration behavior unchanged (it adjusts enter thresholds within +/-20% of the NEW defaults). `npm run build` and `npm test` must pass, with the new/updated tests included.

Log a "Block 2 FIX" entry in SESSION-LOG.md (English): the final constant values changed, test results, checklist, and a user-test note: stand far enough back that the whole T-pose fits inside the framing guide, then in practice mode try DELTA 5 times (ALPHA must not fire), BETA 5 times, GAMMA 5 times, and report how many of each were recognized.

---

## Block 2 FIX 2 — measurement round: full model + per-condition breakdown + attempt recorder (do this before Block 3)

Second human playtest after Block 2 FIX (2026-11-13, real camera, real person):
- ALPHA: works reasonably well now.
- BETA: the DRAWN SKELETON ITSELF warps/bends strangely at T-pose. The landmarks are wrong before classification even runs — this is a tracking-quality problem (lite model, small person in frame at the distance the narrow webcam forces), NOT a threshold problem.
- GAMMA: similarity rarely exceeds ~40% even when the user performs the pose as instructed. Suspicion: one or more GAMMA conditions score near zero structurally, capping the mean. Currently invisible — the similarity is a single opaque number.
- DELTA: still fails. Unknown which condition fails (wrist gap? band? visibility when the wrists overlap in front of the chest?).

Principle for this round: STOP tuning thresholds blind. This block changes NO classification thresholds. It adds measurement, so the next tuning round (FIX 3) is computed from the user's real attempt data.

Required changes:
1. Full model option (src/pose.ts or wherever the landmarker is created):
   - Download pose_landmarker_full.task at setup time (official MediaPipe model storage: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task) and bundle it locally in public/ next to the lite model. Runtime stays fully local — no CDN, no network calls at runtime.
   - Add a model toggle in the practice/test UI: Lite / Full. Switching rebuilds the landmarker (same lifecycle handling as the resolution switch). Persist the choice in localStorage. Default: Full on desktop-width viewports, Lite below that.
   - The log entry must report: both model file sizes on disk, and headless FPS if measurable; the real-camera FPS and skeleton-stability judgement stay a user test (mark Not assessed).
2. Per-condition breakdown (src/classifier.ts + practice UI):
   - Refactor the classifier so evaluating a pose also returns per-condition detail: for each condition of the target pose — name, current measured value, enter requirement, pass/fail, and its 0-1 score contribution to similarity.
   - In practice mode, under the similarity bar, show the selected target pose's conditions as a compact live list: condition name, current value vs requirement, pass (green) / fail (red). Update every frame. This list is a DEV/tuning aid — small text is fine here (the HUD size rules apply to gameplay HUD, not to this practice tool).
   - Unit tests: per-condition detail is returned for all 4 poses and matches the aggregate similarity computation.
3. Attempt recorder (practice mode):
   - Flow: user selects a target pose, presses "Record attempts", performs the pose up to 5 times holding ~1s each, presses "Stop". While recording, capture per frame: timestamp, raw feature values (elbow angles L/R, wrist gap SW, crossing offsets L/R, wrist heights relative to shoulder line, per-wrist visibility), the target pose's per-condition pass/score values, classifier output label, and similarity.
   - ALSO capture, per frame, the MediaPipe 3D world landmarks (meters) for nose, shoulders, elbows, wrists and hips, plus elbow angles L/R computed from those 3D coordinates. Classification keeps using the 2D features — the 3D values are recorded ONLY so the FIX 3 analysis can compare 2D vs 3D elbow-angle stability on the same real attempts (especially BETA holds) and decide whether classification should switch angle computation to 3D.
   - Save recordings in localStorage keyed by pose, and provide a "Download attempts JSON" button exporting all recorded attempts (all poses) as one JSON file.
   - Unit tests: recorder serializes frames to the documented JSON shape (including the 3D fields); recording start/stop state handling.
4. NO threshold changes in this block. Calibration behavior unchanged. `npm run build` and `npm test` must pass.

Log a "Block 2 FIX 2" entry in SESSION-LOG.md (English): files changed, model file sizes, build/test results, screenshot check (docs/screens/block-2-fix2-start.png), handover checklist, and this user-test note:
- User test: (1) switch the model toggle to Full and do BETA — does the skeleton stop warping? Report the 5s-average FPS on Full too. (2) With the recorder: record 5 attempts each of DELTA, GAMMA, BETA (hold each ~1s, return to neutral between attempts). (3) Download the attempts JSON and attach it in the project chat. Thresholds for FIX 3 will be computed from that data, including the 2D-vs-3D elbow comparison.
