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
- Recognition-first principle (user decision, 2026-11-13): a pose that cannot be recognized at all is worthless no matter how precise the classifier is. Matching must be GENEROUS — robustness beats precision. Precision lives in the similarity score (feedback / damage), never in pass/fail strictness.
- Setup baseline (user decision, 2026-11-13): nothing about the player's camera is assumed universal — not its angle, height, distance, or the player's posture. At session start the game captures the player's OWN neutral setup (their camera tilt, their position and size in frame, their proportions) and locks classification to that baseline. Rationale: once a player has adjusted their camera they do not move it during play, so their starting setup IS the correct reference frame. A drift check watches for a bumped camera and offers re-baselining.
- Supported postures/framing (all first-class): standing full-body; seated upper-body at a desk; close framing where arms are partially cropped by the frame edges (classification must fall back to arm-segment directions there, see Pose tech).
- Display profiles (one web build): PC browser / phone browser / phone mirrored to TV (TV mode: HUD inside 5% safe margins, wake lock, large HUD).
- Mobile rules: adaptive performance (start 640x480 + lite model, scale by measured FPS), landscape placement guide, hands-free flow (countdown after start tap; pause/restart by holding ALPHA 2s), distance-readable HUD.
- All video processing is on-device. No server, no API calls, no video upload.
- Prototype success criteria (measured on the user's MacBook Air M1, in the player's own setup baseline — the user's primary setup is seated at his desk): pose recognition >= 90% per pose over 20 tries, zero false Release triggers, >= 25 FPS during effects.

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
- Visibility gating is PER-LANDMARK, not global (changed in Block 2 FIX 5): NO_POSE only when the torso core (shoulders) is unreliable. An unreliable or out-of-frame wrist/elbow never kills the frame — the classifier falls back to arm-segment direction evidence for that side (see FIX 5). Never invent a wrist position the model did not report; use directions of segments that ARE reported.
- Setup baseline: before classification, landmark coordinates are de-rotated by the baseline camera roll captured at setup (rotate around the baseline mid-shoulder by -baselineRoll), so a tilted camera reads as level. With no baseline stored, the transform is identity and classification behaves as before. The baseline also anchors the framing guide and the drift check (see FIX 5).
- Pose model: Full on desktop-width viewports, Lite below that (decided in Block 2 FIX 2 — the lite model's landmark warping at T-pose distance was the BETA blocker; Full measures ~38 FPS on the user's MacBook Air M1, real camera). CPU delegate default. Default capture 640x480 (the model internally uses 256x256, so higher capture mainly costs performance).
- Classification uses 2D image-coordinate angles. 3D world-landmark angles were measured against 2D on real attempt data (Block 2 FIX 3 analysis) and read ~10 degrees lower, which would tighten BETA past its working point — do NOT switch classification to 3D angles.

## Working rules

- Execute ONLY the block named in the user's instruction. One block per run.
- Stack: TypeScript + Vite + Canvas 2D. No game engine, no React. MediaPipe via @mediapipe/tasks-vision (PoseLandmarker, lite model).
- After finishing a block: run `npm run build` (must pass) and append a result entry to SESSION-LOG.md IN ENGLISH: what was built, files changed, build result, how to run it, and anything the user must test manually.
- Handover checklist (required at the end of every block log entry): list every requirement of that block and mark each one Built / Missing / Broken / Not assessed, based on the build and the screenshot below — not on intention. End the entry with the line "Not yet played by a person" until the user confirms a manual playtest of that block.
- Screenshot check (from Block 2 on): after the build passes, serve the production build and capture the initial (pre-camera) screen with headless Chrome at 1280x720, saved to `docs/screens/block-<n>-start.png`. Look at the screenshot: fix any text overflow, overlapping or off-screen elements before logging, and record the screenshot path in the log. If headless Chrome is unavailable, mark the screenshot "Not assessed" in the checklist instead of skipping it silently.
- The GitHub remote `origin` exists (public repo). Commit at the end of the block AND push to origin as part of the same run.
- If a requirement in a block is technically impossible, stop, write the reason in SESSION-LOG.md, and do not silently substitute a different design.

## Roadmap (context only — do not build ahead)

1. Camera + pose tracking + FPS measurement — DONE (Block 1 + FIX, commits 2892279 / c137fa7). Measured on the user's MacBook Air M1 in Brave with a real camera: 5s-average FPS 60.2 at 640x480 and 58.4 at 1280x720; landmarks detected. Performance baseline confirmed — large headroom over the 25 FPS effects criterion.
2. 4-pose classifier + personal calibration + recognition-rate test mode — code done (commit e85d758); Block 2 FIX done (commit 5f55997, tests 38/38); Block 2 FIX 2 done (commit f69c804, tests 44/44: Full/Lite model toggle with Full default on desktop, per-condition breakdown, attempt recorder with 3D capture); Block 2 FIX 3 done (commit b8699cb, tests 49/49: data-computed DELTA/GAMMA thresholds); Block 2 FIX 4 done (commit 8fca998, tests 53/53: shoulder-anchored hipRefY + gate-relative similarity). Attempt-data analysis (2026-11-13, 3,715 real frames, Full model, ~38 FPS real camera): BETA is SOLVED by the Full model (8 clean holds, 2D elbows 167-175 deg, never below threshold in-hold); 3D elbow angles read ~10 deg lower than 2D and are REJECTED for classification; DELTA was blocked by the wrist-gap enter threshold (his gathered gap median 0.44 SW vs enter 0.35); GAMMA never passed once — its two down-side conditions were geometrically impossible for a naturally hanging arm. FIX 3/FIX 4 human tests (2026-11-13, user testing SEATED at his desk): all four poses match, but BETA recognition flickers (wrists drift to the frame edges in a seated T, tripping the global visibility gate) and GAMMA stays weak. The user then set the direction himself: recognition robustness beats precision; seated play and close/cropped framing are first-class; and the reference frame must be the PLAYER'S OWN setup, captured at session start (camera angle/distance/posture differ per person, and a set camera does not move during play). Block 2 FIX 5 done (commit bbc87be, tests 68/68: setup baseline + de-rotation, per-landmark fallbacks, drift chip). Lite attempt analysis (2026-11-13, 2,518 seated frames; full analysis in the project notes, fix6-analysis): BETA intent frames labeled 99% — the half-cropped BETA failure did NOT reproduce in this data (wrist visibility stayed >= 0.5 throughout), so it is not fixed blind. GAMMA proved asymmetric: right-arm-up labels 90% of intent frames, flipped (left-up/right-down) only 22% — his right arm hangs at a median 0.96 SW from the midline vs the 0.85 down-midline gate (100% of flipped intent frames outside it), and that wrist's Lite visibility is 0.33 vs 0.82 on the other side. Next: Block 2 FIX 6 (GAMMA down-side gate + low-visibility fallback), then the formal 20-trial measurement in the user's own seated baseline on BOTH model tiers (the user requires Lite to be sufficient). Recognition improvement ladder (agreed 2026-11-13): measurement -> Full model + 3D check (done, 3D rejected) -> RTMPose only if still insufficient, decided after the Block 3 fun gate.
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

---

## Block 2 FIX 3 — data-computed thresholds for DELTA and GAMMA (do this before Block 3)

Evidence: the user's attempt recording (3,715 frames, Full model, real camera) was analyzed frame-by-frame against this classifier. Full analysis is in the project notes (fix3-analysis). Findings:
- BETA works on the Full model — no BETA changes in this block.
- DELTA: in the wrist-gathered intent zone (gap <= 0.60 SW, 1,323 frames), 99% of the non-DELTA frames fail ONLY the wrist-gap enter check. His natural gathered gap: median 0.44 SW, p75 0.53. DELTA-labeled frames: median gap 0.29, max 0.45. Secondary: the right wrist sits further from the midline (|crossR| > 0.30 in 48% of failing frames; DELTA-frame median own-side offset -0.20 SW).
- GAMMA: zero pass frames in the entire recording. His up side clears every up condition with large margins (above-nose ~0.9 vs 0.05 required; horizontal ~1.39 vs 0.55). BOTH down-side conditions fail in every attempt: down-wrist midline distance median 0.64 SW vs limit 0.50 (a naturally hanging arm rests at 0.6-0.7 SW — outside the shoulder line), and down wrist sits 0.24 SW ABOVE the hip line vs required at/below it.
- 3D elbow angles read ~10 deg lower than 2D inside good BETA holds and would fail 9%/3% of in-hold frames at the 150 deg threshold (2D fails 0-1%). Classification stays on 2D angles — do not change that.

Required changes (src/classifier.ts DEFAULT_THRESHOLDS + matching similarity score ranges):
1. DELTA wrist distance: deltaWristDistanceEnter 0.35 -> 0.50; deltaWristDistanceExit 0.45 -> 0.62.
2. DELTA midline: deltaWristMidlineEnter 0.30 -> 0.38; deltaWristMidlineExit 0.40 -> 0.48.
3. ALPHA wrist distance (keep a signature gap above DELTA's new enter): alphaWristDistanceEnter 0.50 -> 0.55; alphaWristDistanceExit 0.45 -> 0.48. DELTA remains protected by POSE_PRIORITY (DELTA first) and by its own-side crossing cap (crossing <= 0.15), which a true X violates.
4. GAMMA down midline: gammaDownMidlineEnter 0.50 -> 0.85; gammaDownMidlineExit 0.60 -> 0.95. (A T-pose arm sits at ~1.5 SW, so BETA still cannot pass as GAMMA.)
5. GAMMA down below hip: gammaDownBelowHipEnter 0.0 -> -0.40; gammaDownBelowHipExit -0.10 -> -0.50.
6. Similarity score ranges: re-center the soft-distance ranges of the changed conditions (DELTA gap, DELTA midline, GAMMA down-midline, GAMMA down-below-hip, ALPHA gap) so the user's measured medians score at least 0.7: DELTA gap 0.44, DELTA midline |x| 0.20-0.30, GAMMA down midline 0.64, GAMMA down below-hip -0.24.
7. New unit tests:
   - Synthetic DELTA with wrist gap 0.48 and slight crossing 0.10 -> DELTA, not ALPHA.
   - Synthetic DELTA with wrist gap 0.44, right wrist at |x| 0.34 -> DELTA matches.
   - Synthetic GAMMA (both orientations) with down wrist at |x| 0.65 and 0.25 SW above the hip line -> GAMMA matches.
   - Synthetic BETA T-pose -> does NOT match GAMMA.
   - Existing ALPHA tests keep passing with the new 0.55 enter (adjust synthetic fixtures if they used a gap between 0.50 and 0.55, and say so in the log).
8. Calibration behavior unchanged (it scales enter thresholds within +/-20% of the NEW defaults). NO other thresholds change. `npm run build` and `npm test` must pass.

Log a "Block 2 FIX 3" entry in SESSION-LOG.md (English): final constants, test results, screenshot check (docs/screens/block-2-fix3-start.png), handover checklist, and this user-test note:
- User test (Full model): in practice mode try each pose 5 times and report the recognized counts — DELTA (gather both fists at the solar plexus; they do NOT need to touch), GAMMA (one arm up diagonal; let the other arm hang fully down by the thigh), BETA, ALPHA. If all four reach 5/5 or 4/5, run the formal Test mode (All, 20 trials per pose) and report the per-pose success rates.

---

## Block 2 FIX 4 — upper-body robustness: shoulder-anchored hip reference + honest similarity (do this before Block 3)

Context (2026-11-13): after FIX 3, all four poses MATCH. But the user's FIX 3 test was done SEATED at his desk (torso-only framing — head, shoulders, arms; hips out of frame), and the similarity readout stayed <= 50% for BETA/GAMMA/DELTA while ALPHA read 99%. Two defects:
1. Hip dependence. GAMMA's down-below-hip condition and the DELTA/ALPHA bands are computed from hipY. When the hips are out of frame, extractFeatures substitutes FALLBACK_HIP_OFFSET_SW = 1.6 — a standing full-body proportion that is wrong for a cropped or seated torso, distorting both gates and scores. All four poses are upper-body poses; none of them truly needs the hip line.
2. Dishonest similarity. The per-condition soft score ranges were hand-tuned against standing data, so a frame can pass EVERY gate and still average <= 50%. Similarity must mean "how comfortably inside the gates am I" — a property of the gates themselves, not of a hand-tuned ideal pose.

Required changes (src/classifier.ts unless noted):
1. Effective hip reference `hipRefY` on PoseFeatures: when both hip landmarks are visible, hipRefY = the real hipY; otherwise hipRefY = 1.15 (SW below the shoulder line — waist level of a cropped torso). Use hipRefY for ALL classification and scoring that currently uses hipY (GAMMA down-below-hip measurement, DELTA band, and midTorsoY derivation for the ALPHA band). Keep the raw hipY field for debugging. Gate thresholds themselves do NOT change (GAMMA down-below-hip stays enter -0.40 / exit -0.50, now measured against hipRefY; with the cropped reference, a seated down wrist hanging beside the thigh passes with margins comparable to standing).
2. Gate-relative similarity. Replace every condition's hand-tuned soft-distance range with a range derived from that condition's own enter gate by a single fixed rule:
   - "At least" conditions (value >= gate): score 0.6 at the gate, 1.0 at gate + margin, 0.0 at gate - range. Margins: angle conditions margin 25 deg / range 55 deg; SW conditions margin 0.25 SW / range 0.55 SW.
   - "At most" conditions (value <= gate): mirror image — 1.0 at gate - margin, 0.6 at the gate, 0.0 at gate + range (same margin/range values).
   - Band conditions: 1.0 inside the central 60% of the enter band, 0.6 at the band edges, 0.0 at 0.35 SW outside the band.
   Apply uniformly to all four poses' conditions (including ALPHA, whose scores will drop from ~99 toward honest values — that is intended).
3. Practice UI (src/main.ts / index.html): one static hint line near the framing guide: "Standing full-body or seated upper-body framing both work — keep your head, shoulders and both arms in frame." No other UI changes.
4. New unit tests:
   - Cropped-torso GAMMA fixture: landmarks WITHOUT visible hips (fallback path), down wrist hanging beside the thigh (at the hipRefY level), up wrist diagonal -> GAMMA matches and similarity >= 70.
   - Cropped-torso DELTA fixture: hips hidden, wrists gathered 0.65 SW below the shoulder line with gap 0.44 -> DELTA matches and similarity >= 70.
   - All-gates-passing synthetic fixtures for all 4 poses (standing, hips visible) -> each pose's similarity >= 70.
   - All FIX 3 tests keep passing (adjust only fixtures whose similarity assertions depended on the old hand-tuned ranges, and say so in the log).
5. NO gate threshold changes in this block beyond the hipRefY substitution. Calibration unchanged. `npm run build` and `npm test` must pass.

Log a "Block 2 FIX 4" entry in SESSION-LOG.md (English): what changed (hipRefY constant, the uniform scoring rule), test results, screenshot check (docs/screens/block-2-fix4-start.png), handover checklist, and this user-test note:
- User test: (a) SEATED at the desk, torso framing: try each pose 3 times — all four should recognize AND show similarity mostly above 70%. (b) Then the formal measurement STANDING: calibration once, then Test mode (All, 20 trials per pose); report per-pose success % and average recognition times. The 90% success criterion is judged on the standing run.

---

## Block 2 FIX 5 — setup baseline: classify in the player's own reference frame (do this before Block 3)

Direction set by the user (2026-11-13), and it overrides the FIX 4 user-test plan above (the formal measurement now happens seated, in his own baseline, after this block):
- Recognition that fails entirely is worthless regardless of detail. Matching must be generous; precision belongs to the similarity score only.
- Camera angle, distance and framing must NOT be fixed to our assumptions. Every player sets up differently, and once set, a camera does not move during play — so capture the player's own setup at session start and lock the reference frame to it. The system adapts to the player, never the reverse.
- Close framing with arms partially cropped, and seated play, must still classify.

Required changes:
1. Baseline capture (new src/baseline.ts + UI in src/main.ts / index.html):
   - A "Set baseline" flow in practice mode: the user settles into their play position (seated or standing, camera fixed), presses the button, and holds a relaxed neutral pose for 1.5s while the app samples landmarks (require shoulders visible in >= 80% of sampled frames, else report failure and let them retry).
   - Store the baseline in localStorage (`wpr.baseline.v1`): rollDeg (angle of the shoulder line vs image horizontal), midShoulder (x, y in normalized coords), shoulderWidthPx (normalized), torsoAxisDeg (shoulder->hip direction when hips are visible in the sample, else null), sampleFraming (bounding box of nose/shoulders/elbows/wrists in the sample).
   - Baseline is ALSO captured automatically as the first step of the existing calibration flow (before the neutral step proceeds), so calibrated users always have one. Practice/test modes show the baseline state ("Baseline: set (roll -6.2 deg)" / "Baseline: not set").
   - Unit tests: baseline computation from synthetic landmark samples (including a rolled sample), persistence round-trip, capture-failure path.
2. De-rotation before classification (src/classifier.ts or a transform step in front of extractFeatures): when a baseline exists, rotate all landmark coordinates around the baseline midShoulder by -rollDeg BEFORE feature extraction, so a tilted camera reads as level. Every downstream feature (midline crossings, heights, bands) then works in the player's frame unchanged. No baseline -> identity transform. The drawn skeleton overlay keeps using the raw coordinates (the player must see their real image); only classification input is transformed.
   - Unit tests: synthetic standing fixtures (all 4 poses + neutral) rotated by +12 deg and -12 deg around the shoulder center, with a matching baseline -> same labels as unrotated; without a baseline the rotated BETA fixture may fail (that is the bug being fixed — do not assert it passes).
3. Per-landmark visibility + segment-direction fallbacks (src/classifier.ts):
   - extractFeatures returns null (NO_POSE) ONLY when a shoulder is unreliable (visibility < 0.5) or shoulders cannot form a line. Elbow/wrist reliability becomes per-landmark flags on PoseFeatures; a low-visibility or out-of-image wrist/elbow no longer nulls the frame. MediaPipe coordinates outside [0,1] are valid data (out-of-frame estimates) — do not clamp them; reliability flags carry the trust decision.
   - Fallback evidence, used ONLY for a side whose wrist is unreliable or out of frame:
     - BETA side: passes if the elbow sits within the shoulder-height band (+/- 0.35 SW of the shoulder line) AND the elbow's horizontal offset from its shoulder is >= 0.55 SW on that side AND the shoulder->elbow segment is within 30 deg of horizontal. (Arms hanging at the sides put the elbow low and close — they must not pass.)
     - GAMMA up side: passes if the elbow is >= 0.30 SW above the shoulder line AND >= 0.35 SW out to that side (upper arm clearly pointing up-diagonal).
     - GAMMA down side and ALPHA/DELTA: unchanged (their wrists work in front of the torso, where cropping does not occur). If a wrist IS reliable, the existing wrist conditions are used as-is — fallback never replaces good data.
   - The per-condition breakdown marks fallback-judged conditions with "(arm direction)" so the user can see why a cropped pose passed.
   - Unit tests: BETA fixture with both wrists out of frame (coords beyond the edges, visibility 0.2) and elbows at shoulder height -> BETA matches via fallback; arms-at-sides fixture with cropped wrists -> NO_POSE; GAMMA fixture with the up wrist cropped -> GAMMA matches via fallback; all existing tests keep passing (adjust only fixtures that relied on the old global visibility null, and say so in the log).
4. Baseline-relative framing guide + drift check (src/main.ts):
   - The framing guide rectangle is drawn from the baseline sampleFraming (expanded by 25%) instead of the fixed universal zone; with no baseline, keep the current guide.
   - Drift check: rolling 3s average of midShoulder position and shoulder width vs the baseline; if position deviates > 0.35 SW or scale changes > 25% sustained for 2s while no pose recognition is in progress, show a non-blocking chip: "Camera may have moved — re-set your baseline" with a button that jumps to the baseline flow. Never interrupt an in-progress pose; never auto-overwrite the baseline.
   - Unit tests: the drift decision as a pure function over synthetic feature streams (drift detected / not detected).
5. NO gate threshold changes in this block. Calibration behavior unchanged (it still scales enter thresholds; it now also captures the baseline first). `npm run build` and `npm test` must pass.

Log a "Block 2 FIX 5" entry in SESSION-LOG.md (English): what was built, the baseline schema, test results, screenshot check (docs/screens/block-2-fix5-start.png), handover checklist, and this user-test note:
- User test (all SEATED at your desk, your normal camera setup — do not adjust anything for us): (1) press Set baseline, sit neutral for 1.5s. (2) Practice each pose 3 times, including a BETA where your hands go slightly out of frame. (3) Then the formal measurement: calibration once, Test mode (All, 20 trials per pose), report per-pose success % and average recognition times. The 90% criterion is judged on THIS seated run.

---

## Block 2 FIX 6 — GAMMA down-side: widen the hang gate + low-visibility fallback (do this before Block 3)

Evidence (project notes fix6-analysis; Lite model, seated, 2,518 recorded frames re-evaluated offline): GAMMA is asymmetric for the user. Right-arm-up / left-arm-down: 90% of intent frames labeled GAMMA (down wrist median 0.79 SW from the midline, visibility 0.82). Flipped (left-up / right-down): only 22% labeled — his right arm hangs at a median 0.96 SW from the midline (100% of flipped intent frames outside the 0.85 enter gate; even at the +20% calibration bound 1.02 the median sits on the edge and the 0.3s stability rule breaks), and that wrist's Lite visibility is 0.33 (vs 0.82 left), so its extrapolated x drifts further out. Two stacked causes: a gate narrower than his body, and the FIX 5 assumption that the down wrist "works in front of the torso" — seated, a hanging wrist is beside the thigh/chair, not in front of the torso, so the down side needs the same fallback treatment as the up side. (BETA in the same data: 99% of intent frames labeled, wrist visibility never below 0.5 — the half-cropped BETA failure did not reproduce and is NOT addressed here.)

Required changes (src/classifier.ts):
1. GAMMA down midline: gammaDownMidlineEnter 0.85 -> 1.15; gammaDownMidlineExit 0.95 -> 1.25. Confusion protection against BETA does NOT come from this limit — it comes from the down wrist's height (a GAMMA down wrist sits >= ~1.2 SW below the shoulder line; a T-pose wrist sits at shoulder height and at |x| 1.5-1.9 SW, still outside 1.15). The similarity range for this condition re-derives automatically from the FIX 4 gate-relative rule (his 0.96 median then scores ~0.95 instead of ~0.4).
2. GAMMA down-side fallback, used ONLY when the down wrist is unreliable (visibility < 0.5): the down side passes if that side's elbow is >= 0.45 SW below the shoulder line AND the extrapolated wrist is >= 0.90 SW below the shoulder line AND |wrist x from midline| <= 1.30 SW. Both down conditions (midline, below-hip) are then considered passed via direction evidence, and the condition list marks them "(arm direction)" like the other fallbacks. A reliable wrist always uses the normal conditions.
3. New unit tests:
   - Flipped GAMMA fixture (left up, right down) with down wrist |x| 0.96 and visibility 0.33 -> GAMMA matches (fallback path).
   - Flipped GAMMA fixture with down wrist |x| 0.96 and visibility 0.9 -> GAMMA matches (widened gate).
   - BETA T-pose fixture -> does NOT match GAMMA (existing guard, must keep passing with the widened gate).
   - One arm horizontal at shoulder height + other arm hanging -> does NOT match GAMMA (up side fails).
   - All existing tests keep passing.
4. NO other threshold changes. Calibration unchanged (it scales the NEW defaults). `npm run build` and `npm test` must pass.

Log a "Block 2 FIX 6" entry in SESSION-LOG.md (English): final constants, test results, screenshot check (docs/screens/block-2-fix6-start.png), handover checklist, and this user-test note:
- User test (Lite, seated, baseline set): GAMMA BOTH orientations 5 times each — report recognized counts per orientation. Then BETA 3 times. If flipped GAMMA reaches 4/5 or better, run the formal measurement: Test mode (All, 20 trials per pose) on Lite, then toggle to Full and repeat; report per-pose success % and average recognition times for both tiers.

---

## Housekeeping — publish to GitHub as a public repo (one-time; user decision 2026-11-13)

The user decided this project is open from the start, like his lc-checker repo (public, MIT). This block is NOT a game feature — it publishes the existing local git history. Execute it when instructed, independently of the block order.

Steps:
1. Pre-push checks:
   - Verify `.gitignore` covers `node_modules/` and `dist/` (add them if missing).
   - Verify no secrets would be published: no `.env` files tracked, no API keys or tokens anywhere in tracked files (this project uses no runtime keys — confirm by listing tracked files and grepping for `KEY`, `TOKEN`, `SECRET`, `PASSWORD` in tracked text files; report anything found and STOP if a real secret appears).
   - Verify every tracked file is under GitHub's 100MB limit (the pose models in `public/models/` are ~9.4MB and ~5.8MB — fine).
2. Add a `LICENSE` file with the standard MIT license text, copyright (c) 2026 Heo Jeongho.
3. If `README.md` is still the default Vite template, replace it with a minimal project README: title "Winter Palace: Resonance", one-line description (webcam hero action game — copy the enemy's pose to steal its power), status line "Work in progress — pose-recognition prototype (Block 2)", run instructions (`npm install`, `npm run dev`), and the license note. Keep it short and factual; do not invent features that are not built yet.
4. Commit any changes from steps 1-3 as one commit: "Housekeeping: gitignore check, MIT license, README".
5. Create the remote and push:
   - Preferred: `gh repo create winter-palace-resonance --public --source=. --remote=origin --push` (repo name exactly `winter-palace-resonance`, owner = the authenticated user, PUBLIC visibility).
   - If `gh` is not installed or not authenticated, STOP and log the exact manual step for the user (create an empty repo named `winter-palace-resonance` on github.com with NO README/gitignore/license initialization), then on re-run use `git remote add origin https://github.com/jeonghoheo/winter-palace-resonance.git` + `git push -u origin <current-branch>`.
   - Push the current branch as-is and set its upstream; do not rename branches.
6. Verify: the remote HEAD equals the local HEAD (e.g., `git ls-remote origin` or `gh repo view`), and record the repository URL and the pushed HEAD hash.
7. Amend this file's Working rules: replace the bullet "Do not create a remote or push unless SESSION.md says so." with "The GitHub remote `origin` exists (public repo). Commit at the end of the block AND push to origin as part of the same run." — so future blocks keep the repo in sync.
8. Log a "Housekeeping — GitHub publish" entry in SESSION-LOG.md (English): pre-push check results, repo URL, pushed HEAD hash, verification result, handover checklist. This entry does not need the "Not yet played by a person" line.
