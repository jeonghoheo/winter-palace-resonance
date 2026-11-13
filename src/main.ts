import './style.css';
import { SkeletonDrawer, drawFramingGuide } from './draw';
import { PoseTracker, type Delegate, type PoseFrame } from './pose';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  POSE_IDS,
  PoseClassifier,
  evaluatePose,
  extractFeatures,
  wristCrossingOffset,
  wristGap,
  type Classification,
  type PoseConditionInfo,
  type PoseEvaluation,
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
import { detectFramingWarning } from './framing';
import { AttemptRecorder } from './attempts';
import {
  RecognitionTest,
  TRIAL_TIMEOUT_MS,
  type TestTarget,
  type TestUpdate,
} from './testMode';

const BASE_URL = import.meta.env.BASE_URL;
const WASM_URL = `${BASE_URL}wasm`;
const MODEL_STORAGE_KEY = 'wpr.model.v1';

type ModelId = 'lite' | 'full';

const MODEL_URLS: Record<ModelId, string> = {
  lite: `${BASE_URL}models/pose_landmarker_lite.task`,
  full: `${BASE_URL}models/pose_landmarker_full.task`,
};

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
const modelControl = requireElement<HTMLFieldSetElement>('#model-control');
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
const debugReadout = requireElement<HTMLParagraphElement>('#debug-readout');
const conditionList = requireElement<HTMLDivElement>('#condition-list');
const framingWarning = requireElement<HTMLParagraphElement>('#framing-warning');
const poseHint = requireElement<HTMLParagraphElement>('#pose-hint');
const calibrationBadge = requireElement<HTMLSpanElement>('#calibration-badge');
const calibrateButton = requireElement<HTMLButtonElement>('#calibrate');
const resetCalibrationButton = requireElement<HTMLButtonElement>('#reset-calibration');
const calibrationStatus = requireElement<HTMLParagraphElement>('#calibration-status');
const calibrationFill = requireElement<HTMLDivElement>('#calibration-fill');
const recordButton = requireElement<HTMLButtonElement>('#record-attempts');
const downloadAttemptsButton = requireElement<HTMLButtonElement>('#download-attempts');
const recordStatus = requireElement<HTMLParagraphElement>('#record-status');
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
const recorder = new AttemptRecorder();
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

interface ConditionRowElements {
  row: HTMLDivElement;
  value: HTMLSpanElement;
  requirement: HTMLSpanElement;
  status: HTMLSpanElement;
}

let conditionRowIds = '';
let conditionRowElements: ConditionRowElements[] = [];

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
  const recording = recorder.isRecording;

  calibrateButton.disabled = !running || calibrating || testActive || recording;
  resetCalibrationButton.disabled =
    !running || calibrating || testActive || recording;
  startTestButton.disabled = !running || calibrating || testActive || recording;
  testTargetSelect.disabled = !running || calibrating || testActive;
  downloadButton.disabled = !recognitionTest?.getResults();
  recordButton.disabled = !running || calibrating || testActive;
  recordButton.textContent = recording ? 'Stop recording' : 'Record attempts';
  downloadAttemptsButton.disabled = !recorder.hasAttempts();
  for (const button of targetButtons) {
    button.disabled = !running || calibrating || recording;
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

function loadModelChoice(): ModelId {
  try {
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (stored === 'lite' || stored === 'full') return stored;
  } catch {
    // localStorage may be unavailable in hardened browser modes.
  }
  return window.innerWidth >= 900 ? 'full' : 'lite';
}

function readSelectedModel(): ModelId {
  const selected = document.querySelector<HTMLInputElement>(
    'input[name="model"]:checked',
  );
  return selected?.value === 'lite' ? 'lite' : 'full';
}

function applyModelToInputs(model: ModelId): void {
  const input = document.querySelector<HTMLInputElement>(
    `input[name="model"][value="${model}"]`,
  );
  if (input) input.checked = true;
}

function persistModel(model: ModelId): void {
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, model);
  } catch {
    // Ignore storage failures; the in-memory selection still works.
  }
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

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function makeConditionSpan(className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  return span;
}

function renderConditionList(
  conditions: PoseConditionInfo[] | null,
): void {
  if (!conditions || conditions.length === 0) {
    conditionList.hidden = true;
    conditionList.replaceChildren();
    conditionRowIds = '';
    conditionRowElements = [];
    return;
  }

  const ids = conditions.map((condition) => condition.id).join('|');
  if (ids !== conditionRowIds) {
    conditionList.replaceChildren();
    conditionRowElements = conditions.map((condition) => {
      const row = document.createElement('div');
      row.className = 'condition-row';
      const name = makeConditionSpan('condition-name');
      name.textContent = condition.name;
      const value = makeConditionSpan('condition-value');
      const requirement = makeConditionSpan('condition-requirement');
      const status = makeConditionSpan('condition-status');
      row.append(name, value, requirement, status);
      conditionList.append(row);
      return { row, value, requirement, status };
    });
    conditionRowIds = ids;
  }

  conditionList.hidden = false;
  conditions.forEach((condition, index) => {
    const elements = conditionRowElements[index];
    if (!elements) return;
    elements.value.textContent = condition.valueLabel;
    elements.requirement.textContent = condition.requirement;
    elements.status.textContent = condition.passed ? 'PASS' : 'FAIL';
    elements.row.classList.toggle('pass', condition.passed);
    elements.row.classList.toggle('fail', !condition.passed);
  });
}

function updatePracticeUi(
  features: PoseFeatures | null,
  classification: Classification,
  warning: string | null,
  evaluation: PoseEvaluation | null,
): void {
  currentPoseLabel.textContent = classification.label;
  currentPoseLabel.dataset.pose = classification.label;
  currentPoseLabel.classList.toggle('recognized', classification.recognized);

  framingWarning.hidden = warning === null;
  framingWarning.textContent = warning ?? '';

  if (features) {
    debugReadout.textContent =
      `elbow L ${features.left.elbowAngle.toFixed(0)}° / R ${features.right.elbowAngle.toFixed(0)}° · ` +
      `wrist gap ${wristGap(features).toFixed(2)} SW · ` +
      `cross L ${formatSigned(
        wristCrossingOffset(features.left.wrist.x, features.leftSideSign),
      )} / R ${formatSigned(
        wristCrossingOffset(features.right.wrist.x, features.rightSideSign),
      )}`;
  } else {
    debugReadout.textContent =
      'elbow L -- / R -- · wrist gap -- · cross L -- / R --';
  }

  if (!features || !evaluation) {
    renderConditionList(null);
    similarityValue.textContent = '--%';
    setBarWidth(similarityFill, 0);
    similarityBar.setAttribute('aria-valuenow', '0');
    if (!warning) {
      poseHint.hidden = false;
      poseHint.textContent =
        'Step back so your nose, shoulders, elbows, and wrists are all visible.';
    } else {
      poseHint.hidden = true;
      poseHint.textContent = '';
    }
    return;
  }

  const similarity = evaluation.similarity;
  similarityValue.textContent = `${similarity.score}%`;
  setBarWidth(similarityFill, similarity.score);
  similarityBar.setAttribute('aria-valuenow', String(similarity.score));
  renderConditionList(evaluation.conditions);

  // Framing problems take precedence over the generic pose hint.
  if (warning) {
    poseHint.hidden = true;
    poseHint.textContent = '';
  } else if (similarity.score < 80) {
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
  const framingMessage = detectFramingWarning(landmarks);
  const targetPose = recorder.recordingPose ?? practiceTarget;
  const evaluation = features
    ? evaluatePose(features, targetPose, thresholds)
    : null;

  updatePracticeUi(features, classification, framingMessage, evaluation);

  if (recorder.isRecording) {
    if (features && evaluation) {
      recorder.record({
        timestampMs: frame.timestampMs,
        features,
        conditions: evaluation.conditions,
        label: classification.label,
        similarity: evaluation.similarity.score,
        worldLandmarks: frame.worldLandmarks,
      });
      recordStatus.textContent =
        `Recording ${recorder.recordingPose ?? practiceTarget} — ` +
        `${recorder.frameCount} frames. Hold the pose up to 5 times, then press Stop.`;
    } else {
      recordStatus.textContent =
        `Recording ${recorder.recordingPose ?? practiceTarget} — paused (no tracked pose).`;
    }
  }

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

  if (state === 'running' && canvas.width > 0 && canvas.height > 0) {
    drawFramingGuide(ctx, canvas.width, canvas.height);
  }

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
    recognitionTest?.isActive ||
    recorder.isRecording
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
  if (
    state !== 'running' ||
    calibrationSession !== null ||
    recorder.isRecording
  ) {
    return;
  }

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

function stopRecording(message: string): void {
  if (!recorder.isRecording) return;
  const session = recorder.stop();
  if (session) {
    const counts = POSE_IDS.map(
      (pose) => `${pose} ${recorder.getStore().poses[pose]?.length ?? 0}`,
    ).join(' · ');
    recordStatus.textContent =
      `Saved ${session.frames.length} frames for ${session.pose}. ` +
      `Sessions: ${counts}. ${message}`;
  } else {
    recordStatus.textContent = message;
  }
  updateTrainingControls();
}

function toggleRecording(): void {
  if (recorder.isRecording) {
    stopRecording('Recording stopped.');
    return;
  }
  if (
    state !== 'running' ||
    calibrationSession !== null ||
    recognitionTest?.isActive
  ) {
    return;
  }
  recorder.start(practiceTarget, performance.now());
  recordStatus.textContent =
    `Recording ${practiceTarget}. Hold the pose up to 5 times (~1s each), then press Stop.`;
  updateTrainingControls();
}

function downloadAttempts(): void {
  if (!recorder.hasAttempts()) return;
  const blob = new Blob([JSON.stringify(recorder.getStore(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  anchor.href = url;
  anchor.download = `wpr-attempts-${stamp}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function cancelActiveTraining(message: string): void {
  if (recorder.isRecording) {
    stopRecording('Recording stopped and saved.');
  }
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
  modelControl.disabled = false;
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
  modelControl.disabled = true;
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

    const selectedModel = readSelectedModel();
    persistModel(selectedModel);
    const requested: Delegate = gpuToggle.checked ? 'GPU' : 'CPU';
    const started = await created.start(
      video,
      WASM_URL,
      MODEL_URLS[selectedModel],
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
    modelControl.disabled = false;
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

async function changeModel(): Promise<void> {
  const selected = readSelectedModel();
  persistModel(selected);
  if (!cameraLive) return;
  // Rebuild tracking with the newly selected model.
  await startPipeline();
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

modelControl.addEventListener('change', () => {
  void changeModel();
});

calibrateButton.addEventListener('click', startCalibration);
resetCalibrationButton.addEventListener('click', resetCalibration);
startTestButton.addEventListener('click', startRecognitionTest);
downloadButton.addEventListener('click', downloadResults);
recordButton.addEventListener('click', toggleRecording);
downloadAttemptsButton.addEventListener('click', downloadAttempts);

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

if (recorder.hasAttempts()) {
  const counts = POSE_IDS.map(
    (pose) => `${pose} ${recorder.getStore().poses[pose]?.length ?? 0}`,
  ).join(' · ');
  recordStatus.textContent = `Saved attempts — ${counts}. Record more or download the JSON.`;
}

applyResolutionToInputs(currentResolution);
applyModelToInputs(loadModelChoice());
setState('idle');
updateResultsTable();
