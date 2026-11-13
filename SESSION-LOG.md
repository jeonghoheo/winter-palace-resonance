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
