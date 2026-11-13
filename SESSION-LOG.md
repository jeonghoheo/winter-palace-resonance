# SESSION-LOG — WINTER PALACE: RESONANCE

Results are appended here in English, one entry per completed block.

## Setup (by Muse, 2026-11-13)
- Project folder created on the user's Mac: ~/Desktop/projects/winter-palace-resonance
- SESSION.md written with confirmed spec v1.0, working rules, roadmap, and Block 1 instructions.
- Build method: OpenCode + DeepSeek, one block per run, user starts each block with a one-line instruction.

## Block 1 — Camera, pose tracking, FPS meter (2026-11-13)
- Built: Vite + TypeScript page with a Start button (camera starts only after the click), mirrored camera preview, a Canvas 2D skeleton overlay for all 33 pose landmarks, a 640×480 / 1280×720 capture switch, a current + 5-second-average FPS meter, landmark detected/not-detected status, actual capture resolution, and explicit camera error messages.
- Pose model: MediaPipe Pose Landmarker Lite, float16 (`pose_landmarker_lite.task`, downloaded from Google's MediaPipe model storage and bundled locally in `public/models/`). GPU delegate is tried first and falls back to CPU automatically; the active delegate is shown on the page.
- Runtime assets: MediaPipe Tasks Vision Wasm binaries are bundled locally in `public/wasm/` (no model/CDN fetch at runtime, no server, no video upload).
- One Euro smoothing (minCutoff 1.0, beta 0.03) is applied only to the visual skeleton overlay; classification input (Block 2) will stay raw.
- Files created/changed: `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `src/main.ts`, `src/pose.ts`, `src/draw.ts`, `src/style.css`, `public/models/pose_landmarker_lite.task`, `public/wasm/vision_wasm_internal.js`, `public/wasm/vision_wasm_internal.wasm`.
- Build: `npm run build` passes (TypeScript + Vite production build).
- Run: `npm run dev` (served and checked on localhost).
- User test (manual, not automated): open the dev URL, click Start, allow camera access, stand back so the upper body is visible, and read the 5-second average FPS at 640×480; then switch the capture radio to 1280×720 and read the average FPS again. Confirm the skeleton tracks with the mirrored preview and that walking out of frame changes landmark status to "not detected".
- Prototype success criteria for this block are not yet measurable: they require the MacBook Air M1 plus a real camera session; record the two FPS readings from the user test above.

## Block 1 FIX — pose tracking crash (2026-11-13)
- Built: rebuilt the tracking lifecycle so the CPU delegate is the default, GPU only runs behind a manual "Try GPU (experimental)" toggle, creation and the first inference are validated together, per-frame errors are tolerated up to 30 consecutive failures, a Retry button rebuilds camera + landmarker from scratch, the status readout is a real idle/loading/running/error state machine, resolution changes fully re-acquire the camera and recreate the landmarker, and CAPTURE now comes from the live track's `getSettings()`.
- Root cause: the original GPU-first startup could leave a half-initialized Wasm/WebGL pipeline behind; the crash surfaced on the first `detectForVideo` as `Cannot read properties of undefined (reading 'activeTexture')`. Investigating it in headless Chrome with WebGL disabled showed that MediaPipe Tasks Vision builds a WebGL context even with the CPU delegate, so the failure was not avoided by the CPU fallback alone. The upstream workaround is to pass an explicit `canvas` to `PoseLandmarker.createFromOptions` so the graph's GL context exists; that is now done with a dedicated hidden canvas. A WebGL preflight also turns a fully blocked WebGL environment into a clear, actionable error (allow WebGL for the site / turn off Brave Shields for localhost) instead of the cryptic `activeTexture` message.
- Secondary fixes found during verification: the placeholder used `display: grid`, which overrode the `hidden` attribute, so camera-on showed both the placeholder and the video; added `[hidden] { display: none !important; }` and capped the preview height so Start, the controls, and all six stat chips fit at 1280x720 without scrolling. FPS timing now starts at the first completed inference instead of including model-load time.
- Files changed: `src/pose.ts`, `src/main.ts`, `index.html`, `src/style.css`, `SESSION-LOG.md`, plus screenshot `docs/screens/block-1-fix-start.png`.
- Verification environment: `npm run dev` on localhost + headless Chrome 157 with a fake camera device (`--use-fake-device-for-media-stream`), at 1280x720. Headless CPU tracking reached ~60 FPS at 640x480 and ~55-60 FPS at 1280x720; the fake camera contains no person, so no skeleton landmarks were expected.
- Build: `npm run build` passes (TypeScript + Vite).
- Run: `npm run dev`.
- Screenshot check: `docs/screens/block-1-fix-start.png` (initial pre-camera screen, 1280x720). No text overflow, overlap, or off-screen controls; Start is visible without scrolling. (Screenshot checks are required from Block 2 on; done here anyway because the layout was touched.)

Handover checklist (Block 1 FIX):
1. CPU default; GPU only behind a manual toggle; GPU failure closes the instance and creates a fresh CPU instance — Built. CPU-default happy path verified headless. The forced GPU-failure fallback path is coded but not force-tested.
2. Exactly one live landmarker; creation + first `detectForVideo` wrapped together; failure closes it, sets an error state, and shows Retry — Built. The WebGL-blocked run reached the error state with Retry visible; Retry itself was not clicked in that blocked environment.
3. Per-frame errors tolerated; tracking stops only after 30 consecutive failures; camera preview keeps running — Built (code path). Not force-tested with induced inference failures.
4. State machine idle -> loading model -> running / error; "loading model…" does not persist — Built and verified headless (idle -> loading -> running with the fake camera, and loading -> error with WebGL blocked). "Running" is entered when the first inference completes without throwing; landmark detection is reported separately by the Landmarks readout.
5. Resolution switch stops tracks, closes the landmarker, re-acquires the camera, and recreates the landmarker; CAPTURE from live `getSettings()` — Built and verified headless (640x480 -> 1280x720 -> 640x480 changed the readout and canvas size).
6. FPS counts completed inference frames; real numbers while running — Built and verified headless (~60 FPS at 640x480, ~55-60 FPS at 1280x720).
- Acceptance: skeleton appears and follows movement — Not assessed (requires a real camera with a person). FPS real at both resolutions — Built/verified headless, still needs the MacBook Air M1 reading. Landmark status flips when leaving the frame — Not assessed (requires a person; the no-person case correctly shows "not detected"). Resolution switch changes CAPTURE — Built/verified headless. No error banner in the happy path — Built/verified headless. `npm run build` passes — Built.
- User test (manual): open the dev page in Brave, click Start, stand back so the upper body is visible, confirm the skeleton follows you and Landmarks says "detected", then walk out of frame and confirm it flips to "not detected". Record the 5-second average FPS at 640x480, switch to 1280x720, confirm CAPTURE really changes, and record the 5-second average again. If the WebGL error still appears in Brave, allow WebGL / turn off Shields for this localhost site, then press Retry.
- Not yet played by a person

## Block 2 — Pose classifier, calibration, recognition test (2026-11-13)
- Built: a raw-landmark pose classifier for ALPHA/BETA/GAMMA/DELTA with a visibility gate, hysteresis, stickiness, 0.3s timestamp-based recognition, and a continuous similarity score with a single worst-joint hint; a practice UI with a large current-pose label, 4 target buttons, similarity number + bar, and the one-joint hint below 80%; a 1s-per-phase calibration flow (neutral + 4 poses) that stores per-pose median features in localStorage and adjusts thresholds within +/-20% of defaults; a recognition test mode (20 trials per pose, 3s timeout, timer pauses when landmarks are lost) with a per-pose results table and JSON download; and Vitest unit tests.
- Side convention: features and conditions use RAW MediaPipe image coordinates (x right, y down; the anatomical left shoulder is on the +x side of the raw image when facing the camera). The selfie preview is mirrored only with CSS. Side-dependent checks use each shoulder's own sign, so ALPHA/DELTA crossing logic does not depend on the mirror.
- Classifier file: `src/classifier.ts`. Features are shoulder-width (SW) normalized with the origin at mid-shoulder: elbow angles L/R (shoulder-elbow-wrist), wrist/elbow/shoulder positions, nose/chin/mid-torso/hip levels. Chin is approximated as nose + 0.1 SW; if hips are not visible the hip line falls back to shoulders + 1.6 SW. The gate requires nose, both shoulders, both elbows, and both wrists at visibility >= 0.5, otherwise NO_POSE.
- Final default thresholds (constants at the top of `src/classifier.ts`; calibration may shift enter thresholds within +/-20%):
  - Elbow straight: enter >=160 deg, exit >=150 deg. Elbow bent: enter <=120 deg, exit <=132 deg.
  - ALPHA: crossing enter 0.02 SW past midline / exit -0.02; wrist band inset 0.05 SW / slack 0.10 SW; both elbows bent.
  - BETA: wrist vertical enter 0.35 SW / exit 0.45; wrist horizontal enter 1.10 SW / exit 1.00; both elbows straight.
  - GAMMA: up wrist enter 0.05 SW above nose / exit -0.05; up horizontal enter 0.70 SW / exit 0.60; down wrist enter 0.05 SW below hip / exit -0.05; down midline enter 0.50 SW / exit 0.60; opposite sides required.
  - DELTA: wrist distance enter 0.35 SW / exit 0.45; midline enter 0.30 SW / exit 0.40; band inset 0.05 SW / slack 0.10; own-side enter 0.02 SW / exit -0.02.
  - Recognition stability: 300 ms; landmark visibility gate: 0.5.
- Similarity formula: each pose condition maps to a 0-1 distance (0 = comfortable target, 1 = far fallback), score = 100 * (1 - mean distance); the worst condition supplies the one-joint hint.
- Files created: `src/classifier.ts`, `src/calibration.ts`, `src/testMode.ts`, `src/classifier.test.ts`, `src/calibration.test.ts`, `src/testMode.test.ts`, `docs/screens/block-2-start.png`. Files changed: `src/main.ts`, `index.html`, `src/style.css`, `package.json`, `package-lock.json`, `SESSION-LOG.md`.
- Build: `npm run build` passes (TypeScript + Vite).
- Tests: `npm test` passes — 3 files, 30 tests (angle math, SW normalization, each pose's enter/exit, hysteresis, priority/stickiness, 300 ms stability, similarity, calibration clamping, and test-mode timing/pause/timeout).
- Run: `npm run dev`.
- Screenshot check: `docs/screens/block-2-start.png` (initial pre-camera screen of the production build, 1280x720). Checked: no overflow or overlap, Start and all controls/stat chips visible without scrolling.
- Additional headless verification: production build served with headless Chrome 157 and a fake camera fed a static T-pose photo. MediaPipe detected the person, the skeleton was drawn, current pose reported BETA (recognized), similarity was 96% for BETA vs 35% for ALPHA with a single left-wrist hint. Calibration completed and saved, the calibrated badge appeared, reloading restored it from localStorage, and Reset calibration restored defaults. A single-pose BETA test produced 20/20 successes (100%) at 323 ms average; the downloaded JSON contained all 20 trials and the summary. This used a static photo, not the user's real-camera session.

Handover checklist (Block 2):
1. `src/classifier.ts` pure functions over raw landmarks; elbow angles + SW-normalized wrist/elbow positions, mid-shoulder origin, y-down, side convention documented — Built; covered by unit tests.
2. Visibility gate on nose, both shoulders, both elbows, both wrists (>=0.5) -> NO_POSE — Built; covered by unit tests.
3. ALPHA/BETA/GAMMA/DELTA conditions with enter stricter than exit — Built; all four poses have synthetic enter/exit tests and hysteresis tests.
4. Stickiness (active pose preferred, otherwise DELTA > ALPHA > GAMMA > BETA) — Built; covered by unit tests.
5. RECOGNIZED only after the classifier output is stable for 0.3s, timestamp-based — Built; unit tested and observed live with the BETA fixture.
6. Similarity 0-100 from normalized per-condition distances, with the worst condition/joint returned — Built; unit tested and visible in the UI.
7. Practice UI: large current-pose label, 4 target buttons, big similarity % + bar, one-joint hint under 80%, FPS/resolution retained — Built; verified headless with a real-person image.
8. Calibration: neutral 1s + four 1s pose holds, prompts/progress, per-pose median features in localStorage, threshold adjustment bounded to +/-20%, exposed "calibrated" state, Reset calibration — Built; end-to-end save/reload/reset verified headless. Real-person pose accuracy during calibration is Not assessed.
9. Test mode: pose or All, 20 trials per pose, target shown, success on RECOGNIZED or 3s timeout, timer pauses when landmarks are lost, per-pose trials/successes/success %/average time, JSON download — Built; single-pose BETA test and JSON download verified live headless; All (80 trials), pause, and timeout paths covered by unit tests.
10. Vitest added; pure-math/hysteresis tests — Built; `npm test` passes 30/30.
11. `npm run build` passes — Built.
12. `npm test` passes — Built.
13. Production screenshot check at 1280x720 — Built; path above.
- Acceptance still requiring the user: real-camera per-pose recognition rate (>=90% over 20 tries), real-person calibration quality, and real-camera ALPHA/GAMMA/DELTA behavior — Not assessed (only BETA was exercised with a real-person image; the other poses are covered by synthetic unit tests).
- User test (manual): run calibration once (neutral, then hold each prompted pose for 1s), then run Test mode with All and 20 trials per pose. Report the per-pose success % and average recognition times shown in the results table (and optionally download the JSON). Also check that the one-joint hint matches the joint that feels most off.
- Not yet played by a person

## Block 2 FIX — classifier tuning from the first human playtest (2026-11-13)
- Built: wrist-distance-first ALPHA/DELTA disambiguation, relaxed BETA and GAMMA thresholds, a live debug readout under the similarity bar, and framing help (guide rectangle plus a mirrored-side warning chip).
- ALPHA vs DELTA: ALPHA now requires a wrist-to-wrist gap of >=0.50 SW enter / >=0.45 SW exit, so gathered hands cannot activate ALPHA even when they overshoot the midline. DELTA own-side tolerance was relaxed to -0.15 SW enter / -0.25 SW exit; the wrist-distance condition (<=0.35 enter / <=0.45 exit) still has to hold. Similarity for ALPHA includes a "spread your wrists" condition, and DELTA's own-side conditions are scored with the relaxed tolerance.
- Final constants changed in `src/classifier.ts`:
  - Elbow straight: enter 150 deg / exit 140 (was 160 / 150).
  - ALPHA wrist distance: enter 0.50 SW / exit 0.45 (new condition).
  - DELTA own side: enter -0.15 SW / exit -0.25 (was 0.02 / -0.02).
  - BETA wrist vertical: enter 0.45 SW / exit 0.55 (was 0.35 / 0.45).
  - BETA wrist horizontal: enter 1.00 SW / exit 0.90 (was 1.10 / 1.00).
  - GAMMA up horizontal: enter 0.55 SW / exit 0.45 (was 0.70 / 0.60).
  - GAMMA up vertical: above nose enter 0.05 / exit -0.05 (unchanged) OR above shoulder line enter 0.90 SW / exit 0.80 (new).
  - GAMMA down wrist: enter 0.00 SW below the hip / exit -0.10 (was 0.05 / -0.05).
  - Elbow bent, ALPHA crossing/band, GAMMA down midline, DELTA distance/midline/band, visibility 0.5 and 300 ms stability are unchanged.
- Debug readout: small monospace line under the similarity display showing elbow L/R (degrees), wrist gap (SW), and signed crossing offsets L/R (positive = crossed past the midline to the far side).
- Framing help: `src/framing.ts` detects a tracked upper body (nose + shoulders visible) with a wrist that is missing, below 0.5 visibility, or within 5% of any frame edge, and returns a message using the player's anatomical side (correct for the mirrored preview). The practice UI shows it as a warning chip and suppresses the generic NO_POSE hint for that frame. A dashed framing rectangle with corner brackets is drawn on the overlay whenever tracking is running (practice/test UI visible); it uses a 12% side margin, 8% top margin, and 10% bottom margin.
- Files changed: `src/classifier.ts`, `src/main.ts`, `src/draw.ts`, `index.html`, `src/style.css`, `src/classifier.test.ts`, `src/calibration.test.ts`, `SESSION-LOG.md`; new `src/framing.ts`, `src/framing.test.ts`; new screenshot `docs/screens/block-2-fix-start.png`.
- Build: `npm run build` passes (TypeScript + Vite).
- Tests: `npm test` passes — 4 files, 38 tests. New/updated coverage: ALPHA/DELTA wrist-distance disambiguation (gathered + slightly crossed -> DELTA, not ALPHA; separated crossed -> ALPHA), relaxed BETA enter/exit hysteresis, GAMMA shoulder-line branch, relaxed calibration thresholds, and framing warning cases (left/right/both, low visibility, upper body untracked).
- Run: `npm run dev`.
- Screenshot check: `docs/screens/block-2-fix-start.png` (production build, initial pre-camera screen, 1280x720). Checked: no overflow, overlap, or off-screen controls.
- Additional headless verification: static T-pose image through the fake camera still reports BETA, draws the skeleton, shows the debug line (e.g. `elbow L 170° / R 176° · wrist gap 4.66 SW · cross L -2.35 / R -2.31`), and draws the framing guide. No framing warning appeared for that framing because MediaPipe kept both wrists inside the frame; the warning logic itself is unit-tested.

Handover checklist (Block 2 FIX):
1. ALPHA vs DELTA wrist-distance-first rule; ALPHA gap >=0.50 SW; DELTA own-side overshoot up to 0.15 SW; similarity updated — Built; covered by the new unit tests. Live DELTA-with-real-camera behavior is Not assessed.
2. BETA relaxed to elbow 150/140, vertical 0.45/0.55, horizontal 1.00/0.90 — Built; constants and tests updated. Live BETA recognition on the real camera is Not assessed.
3. GAMMA relaxed to up horizontal 0.55/0.45, up vertical above nose OR >=0.90 SW above shoulders, down wrist at hip level — Built; synthetic tests include the shoulder-line branch. Live GAMMA recognition is Not assessed.
4. Practice debug readout for elbow angles, wrist gap, and signed crossing offsets — Built; verified live in headless Chrome.
5. Framing guide rectangle in practice/test mode; wrist edge/visibility warning with mirrored-side naming and precedence over the generic hint — Built. The guide is visible in the headless practice run. Warning detection is unit-tested; it was not triggered live by the static test image, so the live warning state is Not assessed.
6. Calibration behavior unchanged, adjusting enter thresholds within +/-20% of the NEW defaults — Built; calibration derivation tests updated and passing.
7. `npm run build` passes — Built.
8. `npm test` passes — Built (38/38).
9. Production screenshot check at 1280x720 — Built; path above.
- Acceptance still requiring the user: stand far enough back that the whole T-pose fits inside the framing guide, then in practice mode try DELTA 5 times (confirm ALPHA does not fire), BETA 5 times, and GAMMA 5 times, and report how many of each were recognized. Also report whether the framing guide/warning helps with the MacBook webcam FOV.
- Not yet played by a person

## Block 2 FIX 2 — measurement round: full model, per-condition breakdown, attempt recorder (2026-11-13)
- Built: a locally bundled Full pose model with a Lite/Full toggle, per-condition similarity breakdown in the practice UI, and an attempt recorder that stores 2D feature/condition data plus 3D world-landmark data for later analysis.
- No classification thresholds were changed in this block. `DEFAULT_THRESHOLDS`, `matchesPose`, calibration behavior, and the matching logic are unchanged; only evaluation/reporting, model selection, and recording were added.
- Model files (bundled locally in `public/models/`, no runtime CDN/network):
  - `pose_landmarker_lite.task`: 5,777,746 bytes (5.51 MiB / 5.8 MB).
  - `pose_landmarker_full.task`: 9,398,198 bytes (8.96 MiB / 9.4 MB). Downloaded from the official `pose_landmarker_full/float16/latest` URL.
- Model toggle: Lite/Full fieldset in the page controls. Switching rebuilds the full pipeline (camera + landmarker) like the resolution switch. The choice is persisted under `wpr.model.v1`; default is Full when `window.innerWidth >= 900`, Lite below that. Verified at 1280 px (Full default) and 800 px (Lite default); a stored Full choice overrides the narrow-width default and survives reload.
- Per-condition breakdown: `evaluatePose()` in `src/classifier.ts` now returns every condition with id, name, joint, measured value, formatted value, enter requirement, strict enter pass/fail, 0-1 distance, and 0-1 score (score = 1 - distance). `similarity.score` = 100 * average(condition scores); the worst condition is the lowest score. The practice UI renders a compact live list under the similarity bar with condition name, value, requirement, and green PASS / red FAIL. Added tests for all four poses and aggregate-score consistency.
- Attempt recorder: "Record attempts" / "Stop recording" in the practice panel, plus "Download attempts JSON". While recording, each frame with tracked features stores: relative and absolute timestamps; 2D elbow angles L/R, wrist gap, signed crossing offsets L/R, wrist heights relative to the shoulder line, per-wrist visibility; the target pose's per-condition value/requirement/pass/score; classifier output label; target similarity; and MediaPipe 3D world landmarks (meters) for nose, shoulders, elbows, wrists, and hips plus 3D elbow angles L/R. Classification still uses only the 2D features. Recordings are appended as sessions under each pose in `wpr.attempts.v1` in localStorage (numbers rounded to 6 decimals for storage size; classification stays full precision), and the download exports all poses/sessions as one JSON file.
- Headless FPS (production build, 640x480, CPU delegate, static T-pose fake-camera video, 5s average): Full ~36-39 FPS (current 38-40); Lite ~57.8 FPS (current ~60). These are headless Chrome numbers, not the MacBook Air M1 real-camera baseline.
- Headless verification: Full was selected by default at 1280 px; the BETA condition list showed six PASS rows; the recorder saved 64 frames for BETA; the downloaded JSON contained 2D features, per-condition details, world landmarks, and 3D elbow angles (e.g. left 168.92 deg / right 151.23 deg). Switching to Lite and back to Full rebuilt tracking each time and updated FPS. Model persistence and the 800 px Lite default were checked.
- Files changed: `src/classifier.ts`, `src/classifier.test.ts`, `src/pose.ts`, `src/main.ts`, `index.html`, `src/style.css`, `SESSION-LOG.md`; new `src/attempts.ts`, `src/attempts.test.ts`, `public/models/pose_landmarker_full.task`, `docs/screens/block-2-fix2-start.png`.
- Build: `npm run build` passes (TypeScript + Vite).
- Tests: `npm test` passes — 5 files, 44 tests. New coverage: per-condition detail for all 4 poses and aggregate-score consistency, attempt-frame JSON shape including 3D fields, and recorder start/stop/session handling.
- Run: `npm run dev`.
- Screenshot check: `docs/screens/block-2-fix2-start.png` (production build, initial pre-camera screen, 1280x720, Full model selected). Checked: no overflow, overlap, or off-screen controls.

Handover checklist (Block 2 FIX 2):
1. Full model downloaded and bundled locally; Lite/Full toggle; switching rebuilds the landmarker with resolution-switch lifecycle; choice persisted; Full on desktop width / Lite below — Built. Headless FPS measured for both. Real-camera FPS and skeleton-stability judgement are Not assessed.
2. Per-condition detail (name, measured value, enter requirement, pass/fail, 0-1 score contribution) returned for every condition; live compact list in practice mode — Built; unit tested for all 4 poses and verified live headless.
3. Attempt recorder flow (select target, Record attempts, Stop) captures the required 2D features, per-condition pass/score, classifier label, similarity, and 3D world landmarks/3D elbow angles; persists per pose in localStorage; downloads all attempts as JSON — Built; serialization and start/stop state unit-tested, and a live 64-frame BETA recording + JSON download verified headless. Actual 5-attempt recordings of DELTA/GAMMA/BETA are Not assessed (require the user).
4. No threshold changes; calibration behavior unchanged — Built (thresholds and calibration tests unchanged except defaults remain as in FIX 1).
5. `npm run build` passes — Built.
6. `npm test` passes — Built (44/44).
7. Production screenshot check at 1280x720 — Built; path above.
- User test: (1) Switch the model toggle to Full (it is the desktop default) and do BETA — does the skeleton stop warping? Report the 5s-average FPS on Full too. (2) With the recorder: select DELTA, record 5 attempts (~1s hold each, return to neutral between), Stop; repeat for GAMMA and BETA. (3) Download the attempts JSON and attach it in the project chat. FIX 3 thresholds will be computed from that data, including the 2D-vs-3D elbow comparison.
- Not yet played by a person
