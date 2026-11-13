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
