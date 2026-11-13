import {
  DEFAULT_THRESHOLDS,
  POSE_IDS,
  type ClassifierThresholds,
  type PoseFeatures,
  type PoseId,
  type Vec2,
} from './classifier';

export const CALIBRATION_STORAGE_KEY = 'wpr.calibration.v1';
export const CALIBRATION_PHASE_MS = 1000;

/** Serializable median feature vector captured while the player holds a pose. */
export interface CalibrationPoseValues {
  elbowAngleLeft: number;
  elbowAngleRight: number;
  leftShoulder: Vec2;
  rightShoulder: Vec2;
  leftElbow: Vec2;
  rightElbow: Vec2;
  leftWrist: Vec2;
  rightWrist: Vec2;
  nose: Vec2;
  chinY: number;
  midTorsoY: number;
  hipY: number;
  leftSideSign: number;
  rightSideSign: number;
  wristDistance: number;
}

export interface CalibrationData {
  version: 1;
  createdAt: string;
  neutral: CalibrationPoseValues | null;
  poses: Partial<Record<PoseId, CalibrationPoseValues>>;
}

export type CalibrationPhase =
  | 'idle'
  | 'neutral'
  | PoseId
  | 'done'
  | 'failed';

export interface CalibrationUpdate {
  phase: CalibrationPhase;
  prompt: string;
  /** Progress through the current 1s phase, 0..1. */
  progress: number;
  paused: boolean;
  done: boolean;
  data: CalibrationData | null;
  error: string | null;
}

const PHASE_SEQUENCE: readonly (CalibrationPhase)[] = [
  'neutral',
  'ALPHA',
  'BETA',
  'GAMMA',
  'DELTA',
];

const PHASE_PROMPTS: Record<string, string> = {
  neutral: 'Stand neutral — arms relaxed at your sides.',
  ALPHA: 'Hold ALPHA — arms crossed over your chest.',
  BETA: 'Hold BETA — arms straight out to the sides.',
  GAMMA: 'Hold GAMMA — one arm up, the other down by your hip.',
  DELTA: 'Hold DELTA — wrists together in front of your solar plexus.',
};

export function featuresToCalibrationValues(
  features: PoseFeatures,
): CalibrationPoseValues {
  return {
    elbowAngleLeft: features.left.elbowAngle,
    elbowAngleRight: features.right.elbowAngle,
    leftShoulder: { ...features.left.shoulder },
    rightShoulder: { ...features.right.shoulder },
    leftElbow: { ...features.left.elbow },
    rightElbow: { ...features.right.elbow },
    leftWrist: { ...features.left.wrist },
    rightWrist: { ...features.right.wrist },
    nose: { ...features.nose },
    chinY: features.chinY,
    midTorsoY: features.midTorsoY,
    hipY: features.hipY,
    leftSideSign: features.leftSideSign,
    rightSideSign: features.rightSideSign,
    wristDistance: Math.hypot(
      features.left.wrist.x - features.right.wrist.x,
      features.left.wrist.y - features.right.wrist.y,
    ),
  };
}

export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function medianValues(
  samples: CalibrationPoseValues[],
): CalibrationPoseValues | null {
  if (samples.length === 0) return null;

  const m = (pick: (sample: CalibrationPoseValues) => number): number =>
    medianOf(samples.map(pick));
  const v = (pick: (sample: CalibrationPoseValues) => Vec2): Vec2 => ({
    x: m((sample) => pick(sample).x),
    y: m((sample) => pick(sample).y),
  });

  return {
    elbowAngleLeft: m((s) => s.elbowAngleLeft),
    elbowAngleRight: m((s) => s.elbowAngleRight),
    leftShoulder: v((s) => s.leftShoulder),
    rightShoulder: v((s) => s.rightShoulder),
    leftElbow: v((s) => s.leftElbow),
    rightElbow: v((s) => s.rightElbow),
    leftWrist: v((s) => s.leftWrist),
    rightWrist: v((s) => s.rightWrist),
    nose: v((s) => s.nose),
    chinY: m((s) => s.chinY),
    midTorsoY: m((s) => s.midTorsoY),
    hipY: m((s) => s.hipY),
    leftSideSign: m((s) => s.leftSideSign),
    rightSideSign: m((s) => s.rightSideSign),
    wristDistance: m((s) => s.wristDistance),
  };
}

/**
 * Converts calibration medians into classifier thresholds. Every adjusted
 * enter threshold is clamped to +/-20% of its default value. Exit thresholds
 * are derived from the shifted enter threshold so stickiness keeps working.
 */
export function thresholdsFromCalibration(
  data: CalibrationData | null,
): ClassifierThresholds {
  const t: ClassifierThresholds = { ...DEFAULT_THRESHOLDS };
  if (!data) return t;

  const beta = data.poses.BETA;
  if (beta) {
    const straight = Math.min(beta.elbowAngleLeft, beta.elbowAngleRight);
    t.elbowStraightEnter = clampToDefault(
      Math.min(DEFAULT_THRESHOLDS.elbowStraightEnter, straight - 5),
      DEFAULT_THRESHOLDS.elbowStraightEnter,
    );
    t.elbowStraightExit = t.elbowStraightEnter - 10;

    const vertical = Math.max(
      Math.abs(beta.leftWrist.y - beta.leftShoulder.y),
      Math.abs(beta.rightWrist.y - beta.rightShoulder.y),
    );
    t.betaWristVerticalEnter = clampToDefault(
      vertical + 0.05,
      DEFAULT_THRESHOLDS.betaWristVerticalEnter,
    );
    t.betaWristVerticalExit =
      t.betaWristVerticalEnter *
      (DEFAULT_THRESHOLDS.betaWristVerticalExit /
        DEFAULT_THRESHOLDS.betaWristVerticalEnter);

    const horizontal = Math.min(
      Math.abs(beta.leftWrist.x - beta.leftShoulder.x),
      Math.abs(beta.rightWrist.x - beta.rightShoulder.x),
    );
    t.betaWristHorizontalEnter = clampToDefault(
      horizontal - 0.05,
      DEFAULT_THRESHOLDS.betaWristHorizontalEnter,
    );
    t.betaWristHorizontalExit =
      t.betaWristHorizontalEnter *
      (DEFAULT_THRESHOLDS.betaWristHorizontalExit /
        DEFAULT_THRESHOLDS.betaWristHorizontalEnter);
  }

  const alpha = data.poses.ALPHA;
  if (alpha) {
    const bent = Math.max(alpha.elbowAngleLeft, alpha.elbowAngleRight);
    t.elbowBentEnter = clampToDefault(
      Math.max(DEFAULT_THRESHOLDS.elbowBentEnter, bent + 5),
      DEFAULT_THRESHOLDS.elbowBentEnter,
    );
    t.elbowBentExit = t.elbowBentEnter + 12;
  }

  const gamma = data.poses.GAMMA;
  if (gamma) {
    const upHorizontal = Math.max(
      Math.abs(gamma.leftWrist.x),
      Math.abs(gamma.rightWrist.x),
    );
    t.gammaUpHorizontalEnter = clampToDefault(
      upHorizontal - 0.05,
      DEFAULT_THRESHOLDS.gammaUpHorizontalEnter,
    );
    t.gammaUpHorizontalExit =
      t.gammaUpHorizontalEnter *
      (DEFAULT_THRESHOLDS.gammaUpHorizontalExit /
        DEFAULT_THRESHOLDS.gammaUpHorizontalEnter);
  }

  const delta = data.poses.DELTA;
  if (delta) {
    t.deltaWristDistanceEnter = clampToDefault(
      delta.wristDistance + 0.05,
      DEFAULT_THRESHOLDS.deltaWristDistanceEnter,
    );
    t.deltaWristDistanceExit =
      t.deltaWristDistanceEnter *
      (DEFAULT_THRESHOLDS.deltaWristDistanceExit /
        DEFAULT_THRESHOLDS.deltaWristDistanceEnter);

    const midline = Math.max(
      Math.abs(delta.leftWrist.x),
      Math.abs(delta.rightWrist.x),
    );
    t.deltaWristMidlineEnter = clampToDefault(
      midline + 0.05,
      DEFAULT_THRESHOLDS.deltaWristMidlineEnter,
    );
    t.deltaWristMidlineExit =
      t.deltaWristMidlineEnter *
      (DEFAULT_THRESHOLDS.deltaWristMidlineExit /
        DEFAULT_THRESHOLDS.deltaWristMidlineEnter);
  }

  return t;
}

function clampToDefault(value: number, defaultValue: number): number {
  return Math.min(defaultValue * 1.2, Math.max(defaultValue * 0.8, value));
}

export function loadCalibration(): CalibrationData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isCalibrationData(parsed)) {
      window.localStorage.removeItem(CALIBRATION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCalibration(data: CalibrationData): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(data));
}

export function clearCalibration(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CALIBRATION_STORAGE_KEY);
}

export function hasCalibration(data: CalibrationData | null): boolean {
  return Boolean(data && POSE_IDS.every((pose) => data.poses[pose]));
}

function isCalibrationData(value: unknown): value is CalibrationData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<CalibrationData>;
  if (data.version !== 1 || !data.poses || typeof data.poses !== 'object') {
    return false;
  }
  return POSE_IDS.every((pose) => Boolean(data.poses?.[pose]));
}

type SampleBuckets = Record<'neutral' | PoseId, CalibrationPoseValues[]>;

function emptySamples(): SampleBuckets {
  return {
    neutral: [],
    ALPHA: [],
    BETA: [],
    GAMMA: [],
    DELTA: [],
  };
}

/**
 * Timestamp-driven calibration flow. Timers pause whenever features are not
 * available, so tracking loss never counts against the player.
 */
export class CalibrationSession {
  private phase: CalibrationPhase = 'idle';
  private elapsedMs = 0;
  private lastTimestamp = -1;
  private samples: SampleBuckets = emptySamples();
  private data: CalibrationData | null = null;
  private error: string | null = null;

  start(timestampMs: number): void {
    this.phase = 'neutral';
    this.elapsedMs = 0;
    this.lastTimestamp = timestampMs;
    this.samples = emptySamples();
    this.data = null;
    this.error = null;
  }

  cancel(): void {
    this.phase = 'idle';
    this.elapsedMs = 0;
    this.data = null;
    this.error = null;
  }

  update(
    features: PoseFeatures | null,
    timestampMs: number,
  ): CalibrationUpdate {
    const phase = this.phase;
    if (phase === 'idle' || phase === 'done' || phase === 'failed') {
      return this.snapshot(false);
    }

    const dt =
      this.lastTimestamp < 0
        ? 0
        : Math.min(Math.max(timestampMs - this.lastTimestamp, 0), 100);
    this.lastTimestamp = timestampMs;
    const paused = features === null;

    if (features) {
      const values = featuresToCalibrationValues(features);
      if (phase === 'neutral') {
        this.samples.neutral.push(values);
      } else {
        this.samples[phase].push(values);
      }
      this.elapsedMs += dt;
    }

    if (this.elapsedMs >= CALIBRATION_PHASE_MS) {
      this.elapsedMs -= CALIBRATION_PHASE_MS;
      this.advance();
    }

    return this.snapshot(paused);
  }

  private advance(): void {
    const index = PHASE_SEQUENCE.indexOf(this.phase);
    const next = index >= 0 ? PHASE_SEQUENCE[index + 1] : undefined;
    if (next) {
      this.phase = next;
      return;
    }
    this.finish();
  }

  private finish(): void {
    const poses: Partial<Record<PoseId, CalibrationPoseValues>> = {};
    for (const pose of POSE_IDS) {
      const median = medianValues(this.samples[pose]);
      if (!median) {
        this.phase = 'failed';
        this.error = `No usable ${pose} samples were captured.`;
        return;
      }
      poses[pose] = median;
    }

    this.data = {
      version: 1,
      createdAt: new Date().toISOString(),
      neutral: medianValues(this.samples.neutral),
      poses,
    };
    this.phase = 'done';
  }

  private snapshot(paused: boolean): CalibrationUpdate {
    const phase = this.phase;
    return {
      phase,
      prompt:
        phase === 'failed'
          ? this.error ?? 'Calibration failed.'
          : phase === 'done'
            ? 'Calibration saved.'
            : PHASE_PROMPTS[phase] ?? '',
      progress:
        phase === 'done'
          ? 1
          : phase === 'failed'
            ? 0
            : Math.min(1, this.elapsedMs / CALIBRATION_PHASE_MS),
      paused,
      done: phase === 'done',
      data: this.data,
      error: this.error,
    };
  }
}
