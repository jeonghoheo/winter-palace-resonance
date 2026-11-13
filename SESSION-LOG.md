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
