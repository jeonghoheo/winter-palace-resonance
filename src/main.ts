import './style.css';
import { SkeletonDrawer } from './draw';
import { PoseTracker, type PoseFrame } from './pose';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

const BASE_URL = import.meta.env.BASE_URL;
const WASM_URL = `${BASE_URL}wasm`;
const MODEL_URL = `${BASE_URL}models/pose_landmarker_lite.task`;

const KEY_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26];
const MIN_VISIBLE_KEY_LANDMARKS = 6;
const VISIBILITY_THRESHOLD = 0.5;

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
const resolutionControl = requireElement<HTMLFieldSetElement>('#resolution-control');
const fpsCurrent = requireElement<HTMLSpanElement>('#fps-current');
const fpsAverage = requireElement<HTMLSpanElement>('#fps-average');
const landmarkStatus = requireElement<HTMLSpanElement>('#landmark-status');
const captureStatus = requireElement<HTMLSpanElement>('#capture-status');
const delegateStatus = requireElement<HTMLSpanElement>('#delegate-status');
const errorElement = requireElement<HTMLParagraphElement>('#error');

const ctx = require2dContext(canvas);

const drawer = new SkeletonDrawer();
let tracker: PoseTracker | null = null;
let trackerReady = false;
let running = false;
let starting = false;
let currentResolution: Resolution = { width: 640, height: 480 };

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

function syncSizes(): void {
  const width = video.videoWidth || currentResolution.width;
  const height = video.videoHeight || currentResolution.height;
  stage.style.aspectRatio = `${width} / ${height}`;
  canvas.width = width;
  canvas.height = height;
  captureStatus.textContent = `${width}×${height}`;
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

  const previous = video.srcObject;
  if (previous instanceof MediaStream) {
    for (const track of previous.getTracks()) track.stop();
  }

  video.srcObject = stream;

  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
  }

  await video.play();
  syncSizes();
}

function stopCamera(): void {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) track.stop();
  }
  video.srcObject = null;
}

async function ensureTracker(): Promise<string> {
  if (!tracker) {
    const created = new PoseTracker();
    created.onFrame = handleFrame;
    created.onError = (error) => {
      showError(`Pose tracking stopped: ${errorMessage(error)}`);
    };
    tracker = created;
  }

  if (trackerReady) return tracker.activeDelegate ?? 'CPU';

  const delegate = await tracker.init(WASM_URL, MODEL_URL);
  trackerReady = true;
  delegateStatus.textContent = delegate;
  return delegate;
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

async function start(): Promise<void> {
  if (running || starting) return;
  starting = true;
  hideError();
  startButton.disabled = true;
  startButton.textContent = 'Starting…';
  currentResolution = readSelectedResolution();
  captureStatus.textContent = `${currentResolution.width}×${currentResolution.height}`;

  try {
    placeholder.textContent = 'Requesting camera…';
    await openCamera(currentResolution.width, currentResolution.height);

    stage.hidden = false;
    placeholder.hidden = true;
    landmarkStatus.textContent = 'loading model…';

    await ensureTracker();
    tracker?.start(video);

    running = true;
    startButton.textContent = 'Running';
  } catch (error) {
    stopCamera();
    stage.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = 'Camera is off. Click Start.';
    startButton.textContent = 'Start';
    startButton.disabled = false;
    showError(errorMessage(error));
  } finally {
    starting = false;
  }
}

function applyResolutionToInputs(resolution: Resolution): void {
  const input = document.querySelector<HTMLInputElement>(
    `input[name="resolution"][value="${resolution.width}x${resolution.height}"]`,
  );
  if (input) input.checked = true;
}

async function changeResolution(): Promise<void> {
  const previous = currentResolution;
  currentResolution = readSelectedResolution();
  captureStatus.textContent = `${currentResolution.width}×${currentResolution.height}`;

  if (!running) return;

  hideError();
  resolutionControl.disabled = true;
  try {
    await openCamera(currentResolution.width, currentResolution.height);
    tracker?.resetVideoClock();
    drawer.reset();
    syncSizes();
  } catch (error) {
    currentResolution = previous;
    applyResolutionToInputs(previous);
    captureStatus.textContent = `${previous.width}×${previous.height}`;
    showError(errorMessage(error));
  } finally {
    resolutionControl.disabled = false;
  }
}

startButton.addEventListener('click', () => {
  void start();
});

resolutionControl.addEventListener('change', () => {
  void changeResolution();
});
