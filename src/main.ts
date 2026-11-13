import './style.css';
import { SkeletonDrawer } from './draw';
import {
  PoseTracker,
  type Delegate,
  type PoseFrame,
} from './pose';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

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

const ctx = require2dContext(canvas);

const drawer = new SkeletonDrawer();
let tracker: PoseTracker | null = null;
let state: TrackingState = 'idle';
let starting = false;
let cameraLive = false;
let currentResolution: Resolution = { width: 640, height: 480 };

function setState(next: TrackingState): void {
  state = next;
  trackingStatus.textContent = next === 'loading' ? 'loading model…' : next;
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

function handleFrame(frame: PoseFrame): void {
  if (state === 'loading') setState('running');

  fpsCurrent.textContent = frame.fps.current.toFixed(0);
  fpsAverage.textContent = frame.fps.average5s.toFixed(1);

  const landmarks = frame.landmarks;
  const detected = landmarks !== null && isPoseDetected(landmarks);
  landmarkStatus.textContent = detected ? 'detected' : 'not detected';

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

function handleFatal(error: unknown): void {
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

applyResolutionToInputs(currentResolution);
setState('idle');
