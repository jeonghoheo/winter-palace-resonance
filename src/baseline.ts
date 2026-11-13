import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Vec2 } from './classifier';

export const BASELINE_STORAGE_KEY = 'wpr.baseline.v1';
export const BASELINE_CAPTURE_MS = 1500;
export const BASELINE_MIN_SHOULDER_RATIO = 0.8;
export const BASELINE_FRAMING_EXPAND = 1.25;
export const DRIFT_WINDOW_MS = 3000;
export const DRIFT_SUSTAIN_MS = 2000;
export const DRIFT_POSITION_SW = 0.35;
export const DRIFT_SCALE_RATIO = 0.25;

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const FRAMING_JOINTS = [NOSE, LEFT_ELBOW, RIGHT_ELBOW, LEFT_WRIST, RIGHT_WRIST] as const;

export interface FramingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Baseline {
  version: 1;
  capturedAt: string;
  /** Shoulder-line roll relative to image horizontal, in degrees. */
  rollDeg: number;
  midShoulder: Vec2;
  /** Shoulder width in normalized image units (the historical field name says Px). */
  shoulderWidthPx: number;
  /** Mid-shoulder -> mid-hip direction in degrees, or null when hips were absent. */
  torsoAxisDeg: number | null;
  /** Bounding box of nose/shoulders/elbows/wrists in the sample. */
  sampleFraming: FramingBox;
}

export interface BaselineCaptureUpdate {
  phase: 'idle' | 'capturing' | 'done' | 'failed';
  progress: number;
  prompt: string;
  done: boolean;
  failed: boolean;
  baseline: Baseline | null;
  error: string | null;
  shoulderRatio: number;
}

export function isReliableLandmark(
  landmark: NormalizedLandmark | undefined,
): boolean {
  return Boolean(
    landmark &&
      (landmark.visibility ?? 0) >= 0.5 &&
      landmark.x >= 0 &&
      landmark.x <= 1 &&
      landmark.y >= 0 &&
      landmark.y <= 1,
  );
}

function hasReliableShoulders(
  landmarks: NormalizedLandmark[] | null,
): landmarks is NormalizedLandmark[] {
  if (!landmarks || landmarks.length <= RIGHT_SHOULDER) return false;
  return (
    isReliableLandmark(landmarks[LEFT_SHOULDER]) &&
    isReliableLandmark(landmarks[RIGHT_SHOULDER])
  );
}

export function computeBaseline(
  samples: NormalizedLandmark[][],
): Baseline | null {
  const usable = samples.filter((sample) => hasReliableShoulders(sample));
  if (usable.length === 0) return null;

  const rollValues: number[] = [];
  const midXValues: number[] = [];
  const midYValues: number[] = [];
  const widthValues: number[] = [];
  const torsoValues: number[] = [];
  const leftValues: number[] = [];
  const topValues: number[] = [];
  const rightValues: number[] = [];
  const bottomValues: number[] = [];

  for (const landmarks of usable) {
    const left = landmarks[LEFT_SHOULDER];
    const right = landmarks[RIGHT_SHOULDER];
    const midX = (left.x + right.x) / 2;
    const midY = (left.y + right.y) / 2;

    rollValues.push(
      (Math.atan2(left.y - right.y, left.x - right.x) * 180) / Math.PI,
    );
    midXValues.push(midX);
    midYValues.push(midY);
    widthValues.push(Math.hypot(left.x - right.x, left.y - right.y));

    const leftHip = landmarks[LEFT_HIP];
    const rightHip = landmarks[RIGHT_HIP];
    if (isReliableLandmark(leftHip) && isReliableLandmark(rightHip)) {
      const hipY = (leftHip.y + rightHip.y) / 2;
      torsoValues.push(
        (Math.atan2(hipY - midY, (leftHip.x + rightHip.x) / 2 - midX) * 180) /
          Math.PI,
      );
    }

    const xs: number[] = [left.x, right.x];
    const ys: number[] = [left.y, right.y];
    for (const index of FRAMING_JOINTS) {
      const landmark = landmarks[index];
      if (isReliableLandmark(landmark)) {
        xs.push(landmark.x);
        ys.push(landmark.y);
      }
    }
    leftValues.push(Math.min(...xs));
    topValues.push(Math.min(...ys));
    rightValues.push(Math.max(...xs));
    bottomValues.push(Math.max(...ys));
  }

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    rollDeg: median(rollValues),
    midShoulder: {
      x: median(midXValues),
      y: median(midYValues),
    },
    shoulderWidthPx: median(widthValues),
    torsoAxisDeg: torsoValues.length > 0 ? median(torsoValues) : null,
    sampleFraming: {
      left: median(leftValues),
      top: median(topValues),
      right: median(rightValues),
      bottom: median(bottomValues),
    },
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export class BaselineSession {
  private phase: BaselineCaptureUpdate['phase'] = 'idle';
  private elapsedMs = 0;
  private lastTimestamp = -1;
  private totalFrames = 0;
  private shoulderFrames = 0;
  private samples: NormalizedLandmark[][] = [];
  private baseline: Baseline | null = null;
  private error: string | null = null;

  start(timestampMs: number): void {
    this.phase = 'capturing';
    this.elapsedMs = 0;
    this.lastTimestamp = timestampMs;
    this.totalFrames = 0;
    this.shoulderFrames = 0;
    this.samples = [];
    this.baseline = null;
    this.error = null;
  }

  cancel(): void {
    this.phase = 'idle';
    this.elapsedMs = 0;
    this.baseline = null;
    this.error = null;
  }

  update(
    landmarks: NormalizedLandmark[] | null,
    timestampMs: number,
  ): BaselineCaptureUpdate {
    if (this.phase !== 'capturing') return this.snapshot();

    const dt =
      this.lastTimestamp < 0
        ? 0
        : Math.min(Math.max(timestampMs - this.lastTimestamp, 0), 100);
    this.lastTimestamp = timestampMs;
    this.elapsedMs += dt;
    this.totalFrames += 1;

    if (hasReliableShoulders(landmarks)) {
      this.shoulderFrames += 1;
      this.samples.push(landmarks);
    }

    if (this.elapsedMs >= BASELINE_CAPTURE_MS) {
      const ratio =
        this.totalFrames === 0 ? 0 : this.shoulderFrames / this.totalFrames;
      if (ratio < BASELINE_MIN_SHOULDER_RATIO || this.samples.length === 0) {
        this.phase = 'failed';
        this.error =
          'Keep both shoulders in frame for the full 1.5s, then try again.';
      } else {
        const baseline = computeBaseline(this.samples);
        if (!baseline) {
          this.phase = 'failed';
          this.error = 'Could not compute a baseline from the samples.';
        } else {
          this.baseline = baseline;
          this.phase = 'done';
        }
      }
    }

    return this.snapshot();
  }

  private snapshot(): BaselineCaptureUpdate {
    const ratio =
      this.totalFrames === 0 ? 0 : this.shoulderFrames / this.totalFrames;
    return {
      phase: this.phase,
      progress:
        this.phase === 'done'
          ? 1
          : Math.min(1, this.elapsedMs / BASELINE_CAPTURE_MS),
      prompt:
        'Hold a relaxed neutral pose — keep your head, shoulders and both arms in frame.',
      done: this.phase === 'done',
      failed: this.phase === 'failed',
      baseline: this.baseline,
      error: this.error,
      shoulderRatio: ratio,
    };
  }
}

/** Rotates normalized landmarks around a pivot in image coordinates. */
export function rotateLandmarksAround(
  landmarks: NormalizedLandmark[],
  pivot: Vec2,
  degrees: number,
): NormalizedLandmark[] {
  if (degrees === 0) return landmarks;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return landmarks.map((landmark) => {
    const dx = landmark.x - pivot.x;
    const dy = landmark.y - pivot.y;
    return {
      ...landmark,
      x: pivot.x + dx * cos - dy * sin,
      y: pivot.y + dx * sin + dy * cos,
    };
  });
}

export function derotateLandmarks(
  landmarks: NormalizedLandmark[],
  baseline: Baseline,
): NormalizedLandmark[] {
  return rotateLandmarksAround(
    landmarks,
    baseline.midShoulder,
    -baseline.rollDeg,
  );
}

export function expandedFraming(
  box: FramingBox,
  factor = BASELINE_FRAMING_EXPAND,
): FramingBox {
  const centerX = (box.left + box.right) / 2;
  const centerY = (box.top + box.bottom) / 2;
  const halfWidth = ((box.right - box.left) / 2) * factor;
  const halfHeight = ((box.bottom - box.top) / 2) * factor;
  return {
    left: clamp01(centerX - halfWidth),
    top: clamp01(centerY - halfHeight),
    right: clamp01(centerX + halfWidth),
    bottom: clamp01(centerY + halfHeight),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function serializeBaseline(baseline: Baseline): string {
  return JSON.stringify(baseline);
}

export function parseBaseline(raw: string | null): Baseline | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const baseline = parsed as Partial<Baseline>;
    if (
      baseline.version !== 1 ||
      !Number.isFinite(baseline.rollDeg) ||
      !baseline.midShoulder ||
      !Number.isFinite(baseline.midShoulder.x) ||
      !Number.isFinite(baseline.midShoulder.y) ||
      !Number.isFinite(baseline.shoulderWidthPx) ||
      !baseline.sampleFraming ||
      !Number.isFinite(baseline.sampleFraming.left) ||
      !Number.isFinite(baseline.sampleFraming.top) ||
      !Number.isFinite(baseline.sampleFraming.right) ||
      !Number.isFinite(baseline.sampleFraming.bottom)
    ) {
      return null;
    }
    return baseline as Baseline;
  } catch {
    return null;
  }
}

export function loadBaseline(): Baseline | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseBaseline(
      window.localStorage.getItem(BASELINE_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export function saveBaseline(baseline: Baseline): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      BASELINE_STORAGE_KEY,
      serializeBaseline(baseline),
    );
  } catch (error) {
    console.warn('Could not save baseline in localStorage.', error);
  }
}

export interface DriftSample {
  midShoulder: Vec2;
  shoulderWidth: number;
}

export interface DriftDecision {
  drifting: boolean;
  positionDeviationSw: number;
  scaleDeviation: number;
}

interface TimedDriftSample extends DriftSample {
  timestampMs: number;
}

/**
 * Rolling 3s drift check against the baseline. A position deviation over
 * 0.35 SW or a scale change over 25% must persist for 2s while no pose is
 * being recognized. This never writes the baseline.
 */
export class DriftMonitor {
  private baseline: Baseline | null = null;
  private samples: TimedDriftSample[] = [];
  private driftSince: number | null = null;

  constructor(baseline: Baseline | null = null) {
    this.baseline = baseline;
  }

  reset(baseline: Baseline | null): void {
    this.baseline = baseline;
    this.samples = [];
    this.driftSince = null;
  }

  update(
    sample: DriftSample | null,
    timestampMs: number,
    poseInProgress: boolean,
  ): DriftDecision {
    const none: DriftDecision = {
      drifting: false,
      positionDeviationSw: 0,
      scaleDeviation: 0,
    };
    if (!this.baseline || !sample) {
      this.samples = [];
      this.driftSince = null;
      return none;
    }

    this.samples.push({ ...sample, timestampMs });
    const cutoff = timestampMs - DRIFT_WINDOW_MS;
    while (this.samples.length > 0 && this.samples[0].timestampMs < cutoff) {
      this.samples.shift();
    }

    let sumX = 0;
    let sumY = 0;
    let sumWidth = 0;
    for (const item of this.samples) {
      sumX += item.midShoulder.x;
      sumY += item.midShoulder.y;
      sumWidth += item.shoulderWidth;
    }
    const count = this.samples.length;
    const avgX = sumX / count;
    const avgY = sumY / count;
    const avgWidth = sumWidth / count;
    const positionDeviationSw =
      Math.hypot(
        avgX - this.baseline.midShoulder.x,
        avgY - this.baseline.midShoulder.y,
      ) / this.baseline.shoulderWidthPx;
    const scaleDeviation =
      Math.abs(avgWidth - this.baseline.shoulderWidthPx) /
      this.baseline.shoulderWidthPx;

    const overThreshold =
      positionDeviationSw > DRIFT_POSITION_SW ||
      scaleDeviation > DRIFT_SCALE_RATIO;

    if (!overThreshold || poseInProgress) {
      this.driftSince = null;
      return {
        drifting: false,
        positionDeviationSw,
        scaleDeviation,
      };
    }

    if (this.driftSince === null) this.driftSince = timestampMs;
    return {
      drifting: timestampMs - this.driftSince >= DRIFT_SUSTAIN_MS,
      positionDeviationSw,
      scaleDeviation,
    };
  }
}

export function driftSampleFromLandmarks(
  landmarks: NormalizedLandmark[] | null,
): DriftSample | null {
  if (!hasReliableShoulders(landmarks)) return null;
  const left = landmarks[LEFT_SHOULDER];
  const right = landmarks[RIGHT_SHOULDER];
  return {
    midShoulder: {
      x: (left.x + right.x) / 2,
      y: (left.y + right.y) / 2,
    },
    shoulderWidth: Math.hypot(left.x - right.x, left.y - right.y),
  };
}
