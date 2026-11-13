import './style.css';
import { SkeletonDrawer } from './draw';
import { PoseTracker, type Delegate, type PoseFrame } from './pose';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  POSE_IDS,
  PoseClassifier,
  extractFeatures,
  poseSimilarity,
  type Classification,
  type PoseFeatures,
  type PoseId,
} from './classifier';
import {
  CalibrationSession,
  clearCalibration,
  hasCalibration,
  loadCalibration,
  saveCalibration,
  thresholdsFromCalibration,
  type CalibrationData,
} from './calibration';
import {
  RecognitionTest,
  TRIAL_TIMEOUT_MS,
  type TestTarget,
  type TestUpdate,
} from './testMode';

const BASE_URL = import.meta.env.BASE_URL;
const WASM_URL = `${BASE_URL}wasm`;
const MODEL_URL = `${BASE_URL}models/pose_landmarker_lite.task`;

const KEY_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26];
const MIN_VISIBLE_KEY_LANDMARKS = 6;
const VISIBILITY_THRESHOLD = 0.5;

type TrackingState = 'idle' | 'loading' | 'running' | 'error';

interface Resolution {
  width: number;
  height: number;
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function require2dContext(element: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = element.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable.');
  return context;
}

const video = requireElement<HTMLVideoElement>('#video');
const canvas = requireElement<HTMLCanvasElement>('#overlay');
const stage = requireElement<HTMLDivElement>('#stage');
const placeholder = requireElement<HTMLDivElement>('#placeholder');
const startButton = requireElement<HTMLButtonElement>('#start');
const retryButton = requireElement<HTMLButtonElement>('#retry');
const gpuToggle = requireElement<HTMLInputElement>('#gpu-toggle');
const resolutionControl = requireElement<HTMLFieldSetElement>('#resolution-control');
const fpsCurrent = requireElement<HTMLSpanElement>('#fps-current');
const fpsAverage = requireElement<HTMLSpanElement>('#fps-average');
const trackingStatus = requireElement<HTMLSpanElement>('#tracking-status');
const landmarkStatus = requireElement<HTMLSpanElement>('#landmark-status');
const captureStatus = requireElement<HTMLSpanElement>('#capture-status');
const delegateStatus = requireElement<HTMLSpanElement>('#delegate-status');
const errorElement = requireElement<HTMLParagraphElement>('#error');

const practicePanel = requireElement<HTMLElement>('#practice-panel');
const currentPoseLabel = requireElement<HTMLSpanElement>('#current-pose');
const similarityValue = requireElement<HTMLSpanElement>('#similarity-value');
const similarityBar = requireElement<HTMLDivElement>('#similarity-bar');
const similarityFill = requireElement<HTMLDivElement>('#similarity-fill');
const poseHint = requireElement<HTMLParagraphElement>('#pose-hint');
const calibrationBadge = requireElement<HTMLSpanElement>('#calibration-badge');
const calibrateButton = requireElement<HTMLButtonElement>('#calibrate');
const resetCalibrationButton = requireElement<HTMLButtonElement>('#reset-calibration');
const calibrationStatus = requireElement<HTMLParagraphElement>('#calibration-status');
const calibrationFill = requireElement<HTMLDivElement>('#calibration-fill');
const targetButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.pose-button'),
);

const testPanel = requireElement<HTMLElement>('#test-panel');
const testTargetSelect = requireElement<HTMLSelectElement>('#test-target');
const startTestButton = requireElement<HTMLButtonElement>('#start-test');
const downloadButton = requireElement<HTMLButtonElement>('#download-results');
const testStatus = requireElement<HTMLParagraphElement>('#test-status');
const testFill = requireElement<HTMLDivElement>('#test-fill');
const resultCells = new Map<string, HTMLTableCellElement>();

const ctx = require2dContext(canvas);

const drawer = new SkeletonDrawer();
const classifier = new PoseClassifier();
let calibrationData: CalibrationData | null = loadCalibration();
let thresholds = thresholdsFromCalibration(calibrationData);
classifier.thresholds = thresholds;
let practiceTarget: PoseId = 'ALPHA';
let calibrationSession: CalibrationSession | null = null;
let recognitionTest: RecognitionTest | null = null;

let tracker: PoseTracker | null = null;
let state: TrackingState = 'idle';
let starting = false;
let cameraLive = false;
let currentResolution: Resolution = { width: 640, height: 480 };

for (const pose of POSE_IDS) {
  const row = document.querySelector<HTMLTableRowElement>(
    `#results-body tr[data-pose="${pose}"]`,
  );
  if (!row) continue;
  for (const field of ['trials', 'successes', 'rate', 'avg']) {
    const cell = row.querySelector<HTMLTableCellElement>(
      `[data-field="${field}"]`,
    );
    if (cell) resultCells.set(`${pose}:${field}`, cell);
  }
}

function setState(next: TrackingState): void {
  state = next;
  trackingStatus.textContent = next === 'loading' ? 'loading model…' : next;
  const trainingVisible = next === 'running';
  practicePanel.hidden = !trainingVisible;
  testPanel.hidden = !trainingVisible;
  updateTrainingControls();
}

function updateTrainingControls(): void {
  const running = state === 'running';
  const calibrating = calibrationSession !== null;
  const testActive = recognitionTest?.isActive ?? false;

  calibrateButton.disabled = !running || calibrating || testActive;
  resetCalibrationButton.disabled = !running || calibrating || testActive;
  startTestButton.disabled = !running || calibrating || testActive;
  testTargetSelect.disabled = !running || calibrating || testActive;
  downloadButton.disabled = !recognitionTest?.getResults();
  for (const button of targetButtons) {
    button.disabled = !running || calibrating;
  }
}

function showError(message: string): void {
  errorElement.textContent = message;
  errorElement.hidden = false;
}

function hideError(): void {
  errorElement.hidden = true;
  errorElement.textContent = '';
}

function readSelectedResolution(): Resolution {
  const selected = document.querySelector<HTMLInputElement>(
    'input[name="resolution"]:checked',
  );
  if (!selected) return currentResolution;
  const [width, height] = selected.value.split('x').map(Number);
  return { width, height };
}

function applyResolutionToInputs(resolution: Resolution): void {
  const input = document.querySelector<HTMLInputElement>(
    `input[name="resolution"][value="${resolution.width}x${resolution.height}"]`,
  );
  if (input) input.checked = true;
}

/**
 * The CAPTURE readout must reflect the live track, never the requested value.
 * Track settings are also used to size the overlay canvas.
 */
function syncFromTrack(): void {
  const stream = video.srcObject;
  const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : null;
  const settings = track?.getSettings();
  const trackWidth = settings?.width;
  const trackHeight = settings?.height;

  if (trackWidth && trackHeight) {
    captureStatus.textContent = `${trackWidth}×${trackHeight}`;
  }

  const canvasWidth = video.videoWidth || trackWidth || currentResolution.width;
  const canvasHeight = video.videoHeight || trackHeight || currentResolution.height;
  stage.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
}

async function openCamera(width: number, height: number): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Camera API is unavailable. Open the page over HTTPS or on localhost.',
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30 },
      facingMode: 'user',
    },
  });

  video.srcObject = stream;
  cameraLive = true;
  syncFromTrack();

  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
  }

  await video.play();
  syncFromTrack();
}

function stopCamera(): void {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) track.stop();
  }
  video.srcObject = null;
  cameraLive = false;
}

function disposeTracker(): void {
  tracker?.dispose();
  tracker = null;
}

function isPoseDetected(landmarks: NormalizedLandmark[]): boolean {
  let visible = 0;
  for (const index of KEY_LANDMARKS) {
    const landmark = landmarks[index];
    if (landmark && (landmark.visibility ?? 0) >= VISIBILITY_THRESHOLD) {
      visible += 1;
    }
  }
  return visible >= MIN_VISIBLE_KEY_LANDMARKS;
}

function setBarWidth(fill: HTMLElement, percent: number): void {
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function updatePracticeUi(
  features: PoseFeatures | null,
  classification: Classification,
): void {
  currentPoseLabel.textContent = classification.label;
  currentPoseLabel.dataset.pose = classification.label;
  currentPoseLabel.classList.toggle('recognized', classification.recognized);

  if (!features) {
    similarityValue.textContent = '--%';
    setBarWidth(similarityFill, 0);
    similarityBar.setAttribute('aria-valuenow', '0');
    poseHint.hidden = false;
    poseHint.textContent =
      'Step back so your nose, shoulders, elbows, and wrists are all visible.';
    return;
  }

  const similarity = poseSimilarity(features, practiceTarget, thresholds);
  similarityValue.textContent = `${similarity.score}%`;
  setBarWidth(similarityFill, similarity.score);
  similarityBar.setAttribute('aria-valuenow', String(similarity.score));

  if (similarity.score < 80) {
    poseHint.hidden = false;
    poseHint.textContent = `${similarity.worst.joint} — ${similarity.worst.hint}`;
  } else {
    poseHint.hidden = true;
    poseHint.textContent = '';
  }
}

function handleFrame(frame: PoseFrame): void {
  if (state === 'loading') setState('running');

  fpsCurrent.textContent = frame.fps.current.toFixed(0);
  fpsAverage.textContent = frame.fps.average5s.toFixed(1);

  const landmarks = frame.landmarks;
  const detected = landmarks !== null && isPoseDetected(landmarks);
  landmarkStatus.textContent = detected ? 'detected' : 'not detected';

  // Classification input is always the raw landmarks from MediaPipe.
  const features = landmarks ? extractFeatures(landmarks) : null;
  const classification = classifier.updateWithFeatures(
    features,
    frame.timestampMs,
  );

  updatePracticeUi(features, classification);

  if (calibrationSession) {
    updateCalibration(features, frame.timestampMs);
  }
  if (recognitionTest) {
    updateRecognitionTest(
      classification,
      features !== null,
      frame.timestampMs,
    );
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (landmarks && canvas.width > 0 && canvas.height > 0) {
    drawer.draw(
      ctx,
      landmarks,
      canvas.width,
      canvas.height,
      frame.timestampMs,
    );
  } else {
    drawer.reset();
  }
}

function startCalibration(): void {
  if (
    state !== 'running' ||
    calibrationSession !== null ||
    recognitionTest?.isActive
  ) {
    return;
  }

  calibrationSession = new CalibrationSession();
  calibrationSession.start(performance.now());
  calibrationStatus.textContent = 'Get ready…';
  setBarWidth(calibrationFill, 0);
  updateTrainingControls();
}

function updateCalibration(
  features: PoseFeatures | null,
  timestampMs: number,
): void {
  if (!calibrationSession) return;
  const update = calibrationSession.update(features, timestampMs);
  setBarWidth(calibrationFill, update.progress * 100);

  if (update.done && update.data) {
    calibrationData = update.data;
    saveCalibration(update.data);
    thresholds = thresholdsFromCalibration(update.data);
    classifier.thresholds = thresholds;
    classifier.resetStability();
    calibrationBadge.hidden = false;
    calibrationStatus.textContent = 'Calibration saved for all four poses.';
    calibrationSession = null;
    updateTrainingControls();
    return;
  }

  if (update.error) {
    calibrationStatus.textContent = `Calibration failed: ${update.error}`;
    calibrationSession = null;
    setBarWidth(calibrationFill, 0);
    updateTrainingControls();
    return;
  }

  calibrationStatus.textContent = update.paused
    ? `${update.prompt} (paused — show your upper body)`
    : update.prompt;
}

function resetCalibration(): void {
  clearCalibration();
  calibrationData = null;
  thresholds = thresholdsFromCalibration(null);
  classifier.thresholds = thresholds;
  classifier.resetStability();
  calibrationBadge.hidden = true;
  calibrationStatus.textContent = 'Calibration reset to defaults.';
  setBarWidth(calibrationFill, 0);
  updateTrainingControls();
}

function startRecognitionTest(): void {
  if (state !== 'running' || calibrationSession !== null) return;

  const target = testTargetSelect.value as TestTarget;
  recognitionTest = new RecognitionTest();
  recognitionTest.onTrialStart = () => classifier.resetStability();
  recognitionTest.start(target, performance.now());
  testStatus.textContent = 'Starting…';
  setBarWidth(testFill, 0);
  updateResultsTable();
  updateTrainingControls();
}

function updateRecognitionTest(
  classification: Classification,
  featuresPresent: boolean,
  timestampMs: number,
): void {
  if (!recognitionTest) return;
  const update = recognitionTest.update(
    classification.label,
    classification.recognized,
    featuresPresent,
    timestampMs,
  );

  setBarWidth(testFill, update.state === 'done' ? 100 : update.progress * 100);
  testStatus.textContent = testStatusText(update);
  updateResultsTable();

  if (update.state === 'done') {
    updateTrainingControls();
  }
}

function testStatusText(update: TestUpdate): string {
  if (update.state === 'running') {
    const target = update.target ?? '—';
    const elapsed = Math.min(
      TRIAL_TIMEOUT_MS,
      update.progress * TRIAL_TIMEOUT_MS,
    ) / 1000;
    if (update.paused) {
      return `Paused — target ${target}. Show your upper body to continue.`;
    }
    return (
      `Target ${target} — trial ${update.trialNumber}/${update.totalTrials} — ` +
      `${elapsed.toFixed(1)}s / 3.0s`
    );
  }

  if (update.state === 'between') {
    const result = update.lastResult;
    if (!result) return 'Next trial…';
    if (result.success) {
      return `Recognized ${result.pose} in ${result.recognitionMs ?? 0} ms. Next trial…`;
    }
    return `Time — ${result.pose} was not recognized. Next trial…`;
  }

  if (update.state === 'done') {
    return 'Test complete. Results are ready to download.';
  }

  return 'Ready.';
}

function updateResultsTable(): void {
  const summaries = recognitionTest?.getSummaries() ?? null;

  for (const pose of POSE_IDS) {
    const summary = summaries?.[pose];
    const hasTrials = Boolean(summary && summary.trials > 0);
    setResultCell(pose, 'trials', hasTrials ? String(summary?.trials) : '—');
    setResultCell(
      pose,
      'successes',
      hasTrials ? String(summary?.successes) : '—',
    );
    setResultCell(
      pose,
      'rate',
      hasTrials ? `${summary?.successRate.toFixed(1)}%` : '—',
    );
    setResultCell(
      pose,
      'avg',
      summary?.averageRecognitionMs != null
        ? `${Math.round(summary.averageRecognitionMs)} ms`
        : '—',
    );
  }
}

function setResultCell(pose: PoseId, field: string, text: string): void {
  const cell = resultCells.get(`${pose}:${field}`);
  if (cell) cell.textContent = text;
}

function downloadResults(): void {
  const results = recognitionTest?.getResults();
  if (!results) return;

  const blob = new Blob([JSON.stringify(results, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  anchor.href = url;
  anchor.download = `wpr-recognition-${stamp}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function cancelActiveTraining(message: string): void {
  if (calibrationSession) {
    calibrationSession.cancel();
    calibrationSession = null;
    setBarWidth(calibrationFill, 0);
    calibrationStatus.textContent = message;
  }
  if (recognitionTest?.isActive) {
    recognitionTest = null;
    setBarWidth(testFill, 0);
    testStatus.textContent = message;
    updateResultsTable();
  }
  updateTrainingControls();
}

function handleFatal(error: unknown): void {
  cancelActiveTraining('Tracking stopped; training session cancelled.');
  setState('error');
  startButton.textContent = 'Start';
  startButton.disabled = true;
  retryButton.hidden = false;
  retryButton.disabled = false;
  resolutionControl.disabled = false;
  gpuToggle.disabled = false;
  showError(
    `Pose tracking stopped after repeated inference failures: ${errorMessage(error)}. ` +
      'The camera preview is still running. Press Retry to rebuild tracking.',
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission was denied. Allow camera access in the browser site settings, then reload the page.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No camera was found. Connect a camera and try again.';
      case 'NotReadableError':
        return 'The camera is already in use by another app. Close it and try again.';
      default:
        break;
    }
  }
  if (error instanceof Error) return error.message;
  return 'Unknown error.';
}

/**
 * Builds the whole pipeline from scratch: camera first, then one landmarker.
 * Also used for the resolution switch and Retry, which is why it always stops
 * and closes the previous pipeline before acquiring anything new.
 */
async function startPipeline(): Promise<void> {
  if (starting) return;
  starting = true;

  cancelActiveTraining('Tracking restarted; training session cancelled.');
  hideError();
  retryButton.hidden = true;
  startButton.disabled = true;
  startButton.textContent = 'Starting…';
  resolutionControl.disabled = true;
  gpuToggle.disabled = true;
  setState('loading');
  landmarkStatus.textContent = 'not detected';

  try {
    disposeTracker();
    stopCamera();
    captureStatus.textContent = '—';
    delegateStatus.textContent = '—';

    currentResolution = readSelectedResolution();
    await openCamera(currentResolution.width, currentResolution.height);

    stage.hidden = false;
    placeholder.hidden = true;

    const created = new PoseTracker();
    created.onFrame = handleFrame;
    created.onFatal = handleFatal;
    tracker = created;

    const requested: Delegate = gpuToggle.checked ? 'GPU' : 'CPU';
    const started = await created.start(
      video,
      WASM_URL,
      MODEL_URL,
      requested,
    );
    delegateStatus.textContent = started.delegate;

    if (started.gpuFallback) {
      gpuToggle.checked = false;
      console.warn('GPU was requested but failed; a fresh CPU instance is running.');
    }

    classifier.resetStability();
    setState('running');
    startButton.textContent = 'Running';
  } catch (error) {
    disposeTracker();

    if (!cameraLive) {
      stage.hidden = true;
      placeholder.hidden = false;
      placeholder.textContent = 'Camera is off. Click Start.';
    }

    setState('error');
    startButton.textContent = 'Start';
    startButton.disabled = true;
    retryButton.hidden = false;
    showError(
      cameraLive
        ? `Pose tracking failed to start: ${errorMessage(error)}`
        : errorMessage(error),
    );
  } finally {
    starting = false;
    resolutionControl.disabled = false;
    gpuToggle.disabled = false;
    retryButton.disabled = false;
  }
}

async function changeResolution(): Promise<void> {
  currentResolution = readSelectedResolution();

  if (!cameraLive) {
    captureStatus.textContent = '—';
    return;
  }

  // Re-acquire the camera and recreate the landmarker at the new size.
  await startPipeline();
}

function changeDelegate(): void {
  if (!cameraLive) return;
  // Rebuild tracking with the newly selected delegate.
  void startPipeline();
}

startButton.addEventListener('click', () => {
  void startPipeline();
});

retryButton.addEventListener('click', () => {
  void startPipeline();
});

resolutionControl.addEventListener('change', () => {
  void changeResolution();
});

gpuToggle.addEventListener('change', changeDelegate);

calibrateButton.addEventListener('click', startCalibration);
resetCalibrationButton.addEventListener('click', resetCalibration);
startTestButton.addEventListener('click', startRecognitionTest);
downloadButton.addEventListener('click', downloadResults);

for (const button of targetButtons) {
  button.addEventListener('click', () => {
    const pose = button.dataset.pose as PoseId | undefined;
    if (!pose) return;
    practiceTarget = pose;
    for (const candidate of targetButtons) {
      candidate.setAttribute('aria-pressed', String(candidate === button));
    }
  });
}

if (hasCalibration(calibrationData)) {
  calibrationBadge.hidden = false;
  calibrationStatus.textContent = 'Calibration loaded from this browser.';
}

applyResolutionToInputs(currentResolution);
setState('idle');
updateResultsTable();
