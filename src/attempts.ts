import type { Landmark } from '@mediapipe/tasks-vision';
import {
  POSE_IDS,
  type PoseConditionInfo,
  type PoseFeatures,
  type PoseId,
  type PoseLabel,
  wristCrossingOffset,
  wristGap,
} from './classifier';

export const ATTEMPTS_STORAGE_KEY = 'wpr.attempts.v1';

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

const REQUIRED_WORLD_JOINTS = [
  NOSE,
  LEFT_SHOULDER,
  RIGHT_SHOULDER,
  LEFT_ELBOW,
  RIGHT_ELBOW,
  LEFT_WRIST,
  RIGHT_WRIST,
  LEFT_HIP,
  RIGHT_HIP,
] as const;

export interface AttemptFeatureSnapshot {
  elbowAngleLeft: number;
  elbowAngleRight: number;
  wristGap: number;
  crossingLeft: number;
  crossingRight: number;
  /** Wrist y minus its shoulder y, in shoulder-width units (down positive). */
  wristHeightLeft: number;
  wristHeightRight: number;
  wristVisibilityLeft: number;
  wristVisibilityRight: number;
}

export interface AttemptConditionSnapshot {
  id: string;
  name: string;
  value: number;
  valueLabel: string;
  requirement: string;
  passed: boolean;
  score: number;
}

export interface AttemptWorldJoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface AttemptWorldSnapshot {
  nose: AttemptWorldJoint;
  leftShoulder: AttemptWorldJoint;
  rightShoulder: AttemptWorldJoint;
  leftElbow: AttemptWorldJoint;
  rightElbow: AttemptWorldJoint;
  leftWrist: AttemptWorldJoint;
  rightWrist: AttemptWorldJoint;
  leftHip: AttemptWorldJoint;
  rightHip: AttemptWorldJoint;
  /** Elbow angles from the 3D world landmarks, in degrees. */
  elbowAngleLeftDeg: number;
  elbowAngleRightDeg: number;
}

export interface AttemptFrame {
  /** Milliseconds since this recording session started. */
  t: number;
  /** Absolute MediaPipe frame timestamp (performance.now clock). */
  timestampMs: number;
  features: AttemptFeatureSnapshot;
  conditions: AttemptConditionSnapshot[];
  /** Classifier output for this frame. */
  label: PoseLabel;
  similarity: number;
  /** MediaPipe world landmarks (meters); null if unavailable. */
  world: AttemptWorldSnapshot | null;
}

export interface AttemptSession {
  id: string;
  pose: PoseId;
  startedAt: string;
  stoppedAt: string;
  frames: AttemptFrame[];
}

export interface AttemptStore {
  version: 1;
  updatedAt: string;
  /** Recordings grouped by target pose; each Stop appends a session. */
  poses: Partial<Record<PoseId, AttemptSession[]>>;
}

export interface AttemptFrameInput {
  timestampMs: number;
  features: PoseFeatures;
  conditions: PoseConditionInfo[];
  label: PoseLabel;
  similarity: number;
  worldLandmarks: Landmark[] | null;
}

export interface AttemptStorage {
  load(): AttemptStore | null;
  save(store: AttemptStore): void;
}

export const localStorageAttemptStorage: AttemptStorage = {
  load(): AttemptStore | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(ATTEMPTS_STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isAttemptStore(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  save(store: AttemptStore): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      console.warn('Could not save attempts in localStorage.', error);
    }
  },
};

export function createEmptyAttemptStore(): AttemptStore {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    poses: {},
  };
}

export function buildAttemptFrame(
  sessionStartMs: number,
  input: AttemptFrameInput,
): AttemptFrame {
  const features = input.features;
  return {
    t: Math.max(0, Math.round(input.timestampMs - sessionStartMs)),
    timestampMs: input.timestampMs,
    // Stored numbers are rounded to 6 decimals to keep localStorage small;
    // classification and similarity themselves run at full precision.
    features: {
      elbowAngleLeft: round(features.left.elbowAngle),
      elbowAngleRight: round(features.right.elbowAngle),
      wristGap: round(wristGap(features)),
      crossingLeft: round(
        wristCrossingOffset(features.left.wrist.x, features.leftSideSign),
      ),
      crossingRight: round(
        wristCrossingOffset(features.right.wrist.x, features.rightSideSign),
      ),
      wristHeightLeft: round(
        features.left.wrist.y - features.left.shoulder.y,
      ),
      wristHeightRight: round(
        features.right.wrist.y - features.right.shoulder.y,
      ),
      wristVisibilityLeft: round(features.wristVisibility.left),
      wristVisibilityRight: round(features.wristVisibility.right),
    },
    conditions: input.conditions.map((condition) => ({
      id: condition.id,
      name: condition.name,
      value: round(condition.value),
      valueLabel: condition.valueLabel,
      requirement: condition.requirement,
      passed: condition.passed,
      score: round(condition.score),
    })),
    label: input.label,
    similarity: input.similarity,
    world: buildWorldSnapshot(input.worldLandmarks),
  };
}

function buildWorldSnapshot(
  landmarks: Landmark[] | null,
): AttemptWorldSnapshot | null {
  if (!landmarks) return null;
  for (const index of REQUIRED_WORLD_JOINTS) {
    if (!landmarks[index]) return null;
  }

  const joint = (index: number): AttemptWorldJoint => {
    const landmark = landmarks[index];
    return {
      x: round(landmark.x),
      y: round(landmark.y),
      z: round(landmark.z),
      visibility: round(landmark.visibility),
    };
  };

  return {
    nose: joint(NOSE),
    leftShoulder: joint(LEFT_SHOULDER),
    rightShoulder: joint(RIGHT_SHOULDER),
    leftElbow: joint(LEFT_ELBOW),
    rightElbow: joint(RIGHT_ELBOW),
    leftWrist: joint(LEFT_WRIST),
    rightWrist: joint(RIGHT_WRIST),
    leftHip: joint(LEFT_HIP),
    rightHip: joint(RIGHT_HIP),
    elbowAngleLeftDeg: angle3D(
      landmarks[LEFT_SHOULDER],
      landmarks[LEFT_ELBOW],
      landmarks[LEFT_WRIST],
    ),
    elbowAngleRightDeg: angle3D(
      landmarks[RIGHT_SHOULDER],
      landmarks[RIGHT_ELBOW],
      landmarks[RIGHT_WRIST],
    ),
  };
}

function angle3D(a: Landmark, b: Landmark, c: Landmark): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const abz = a.z - b.z;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const cbz = c.z - b.z;
  const lengths = Math.hypot(abx, aby, abz) * Math.hypot(cbx, cby, cbz);
  if (lengths < 1e-9) return 180;
  const cosine = clamp(
    (abx * cbx + aby * cby + abz * cbz) / lengths,
    -1,
    1,
  );
  return round((Math.acos(cosine) * 180) / Math.PI, 2);
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Records practice attempts until Stop. Each Stop appends one session to the
 * pose's list in the in-memory store and persists the whole store.
 */
export class AttemptRecorder {
  private readonly storage: AttemptStorage;
  private store: AttemptStore;
  private active = false;
  private session: AttemptSession | null = null;
  private startTimestampMs = 0;

  constructor(storage: AttemptStorage = localStorageAttemptStorage) {
    this.storage = storage;
    this.store = storage.load() ?? createEmptyAttemptStore();
  }

  get isRecording(): boolean {
    return this.active;
  }

  get recordingPose(): PoseId | null {
    return this.session?.pose ?? null;
  }

  get frameCount(): number {
    return this.session?.frames.length ?? 0;
  }

  getStore(): AttemptStore {
    return this.store;
  }

  hasAttempts(): boolean {
    return POSE_IDS.some(
      (pose) => (this.store.poses[pose]?.length ?? 0) > 0,
    );
  }

  start(pose: PoseId, timestampMs: number): boolean {
    if (this.active) return false;
    this.active = true;
    this.startTimestampMs = timestampMs;
    this.session = {
      id: `${Date.now()}-${pose}`,
      pose,
      startedAt: new Date().toISOString(),
      stoppedAt: '',
      frames: [],
    };
    return true;
  }

  record(input: AttemptFrameInput): boolean {
    if (!this.active || !this.session) return false;
    this.session.frames.push(buildAttemptFrame(this.startTimestampMs, input));
    return true;
  }

  stop(): AttemptSession | null {
    if (!this.active || !this.session) return null;
    const session = this.session;
    session.stoppedAt = new Date().toISOString();

    const sessions = this.store.poses[session.pose] ?? [];
    this.store.poses[session.pose] = [...sessions, session];
    this.store.updatedAt = new Date().toISOString();
    this.storage.save(this.store);

    this.active = false;
    this.session = null;
    this.startTimestampMs = 0;
    return session;
  }
}

function isAttemptStore(value: unknown): value is AttemptStore {
  if (!value || typeof value !== 'object') return false;
  const store = value as Partial<AttemptStore>;
  return (
    store.version === 1 &&
    Boolean(store.poses) &&
    typeof store.poses === 'object'
  );
}
