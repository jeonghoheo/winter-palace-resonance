import { POSE_IDS, type PoseId, type PoseLabel } from './classifier';

export type TestTarget = PoseId | 'ALL';
export type TestState = 'idle' | 'running' | 'between' | 'done';

export const TRIALS_PER_POSE = 20;
export const TRIAL_TIMEOUT_MS = 3000;
export const BETWEEN_TRIALS_MS = 700;

export interface TrialResult {
  pose: PoseId;
  success: boolean;
  recognitionMs: number | null;
}

export interface PoseSummary {
  trials: number;
  successes: number;
  successRate: number;
  averageRecognitionMs: number | null;
}

export interface TestResults {
  startedAt: string;
  finishedAt: string | null;
  target: TestTarget;
  trialsPerPose: number;
  results: TrialResult[];
  summaries: Record<PoseId, PoseSummary>;
}

export interface TestUpdate {
  state: TestState;
  target: PoseId | null;
  trialNumber: number;
  totalTrials: number;
  /** Progress through the current trial's 3s timeout, 0..1. */
  progress: number;
  paused: boolean;
  lastResult: TrialResult | null;
}

function emptySummaries(): Record<PoseId, PoseSummary> {
  return {
    ALPHA: { trials: 0, successes: 0, successRate: 0, averageRecognitionMs: null },
    BETA: { trials: 0, successes: 0, successRate: 0, averageRecognitionMs: null },
    GAMMA: { trials: 0, successes: 0, successRate: 0, averageRecognitionMs: null },
    DELTA: { trials: 0, successes: 0, successRate: 0, averageRecognitionMs: null },
  };
}

/**
 * Runs 20 trials per selected pose (interleaved when target is ALL). A trial
 * succeeds when the target is the classifier's RECOGNIZED output. Active trial
 * time only accumulates while landmarks are present, so losing the skeleton
 * pauses rather than fails the trial.
 */
export class RecognitionTest {
  onTrialStart: (() => void) | null = null;

  private state: TestState = 'idle';
  private queue: PoseId[] = [];
  private index = 0;
  private currentTarget: PoseId | null = null;
  private activeElapsedMs = 0;
  private betweenElapsedMs = 0;
  private lastTimestamp = -1;
  private lastResult: TrialResult | null = null;
  private results: TrialResult[] = [];
  private startedAtIso = '';
  private finishedAtIso: string | null = null;
  private target: TestTarget = 'ALL';

  get isActive(): boolean {
    return this.state === 'running' || this.state === 'between';
  }

  get isDone(): boolean {
    return this.state === 'done';
  }

  start(target: TestTarget, timestampMs: number): void {
    this.target = target;
    const poses: PoseId[] = target === 'ALL' ? [...POSE_IDS] : [target];
    this.queue = [];
    for (let trial = 0; trial < TRIALS_PER_POSE; trial += 1) {
      for (const pose of poses) this.queue.push(pose);
    }

    this.results = [];
    this.index = 0;
    this.lastResult = null;
    this.startedAtIso = new Date().toISOString();
    this.finishedAtIso = null;
    this.lastTimestamp = timestampMs;
    this.activeElapsedMs = 0;
    this.betweenElapsedMs = 0;
    this.beginTrial();
  }

  update(
    label: PoseLabel,
    recognized: boolean,
    featuresPresent: boolean,
    timestampMs: number,
  ): TestUpdate {
    const dt =
      this.lastTimestamp < 0
        ? 0
        : Math.min(Math.max(timestampMs - this.lastTimestamp, 0), 100);
    this.lastTimestamp = timestampMs;

    if (this.state === 'running') {
      if (featuresPresent) {
        this.activeElapsedMs += dt;
        if (
          this.currentTarget !== null &&
          recognized &&
          label === this.currentTarget
        ) {
          this.recordResult(true, this.activeElapsedMs);
        } else if (this.activeElapsedMs >= TRIAL_TIMEOUT_MS) {
          this.recordResult(false, null);
        }
      }
    } else if (this.state === 'between') {
      this.betweenElapsedMs += dt;
      if (this.betweenElapsedMs >= BETWEEN_TRIALS_MS) {
        this.advanceTrial();
      }
    }

    return this.snapshot(!featuresPresent);
  }

  getSummaries(): Record<PoseId, PoseSummary> {
    const summaries = emptySummaries();
    for (const pose of POSE_IDS) {
      const trials = this.results.filter((result) => result.pose === pose);
      const successes = trials.filter((result) => result.success);
      const times = successes
        .map((result) => result.recognitionMs)
        .filter((time): time is number => time !== null);
      summaries[pose] = {
        trials: trials.length,
        successes: successes.length,
        successRate:
          trials.length === 0 ? 0 : (successes.length / trials.length) * 100,
        averageRecognitionMs:
          times.length === 0
            ? null
            : times.reduce((sum, time) => sum + time, 0) / times.length,
      };
    }
    return summaries;
  }

  getResults(): TestResults | null {
    if (this.state !== 'done') return null;
    return {
      startedAt: this.startedAtIso,
      finishedAt: this.finishedAtIso,
      target: this.target,
      trialsPerPose: TRIALS_PER_POSE,
      results: [...this.results],
      summaries: this.getSummaries(),
    };
  }

  private beginTrial(): void {
    this.currentTarget = this.queue[this.index] ?? null;
    this.activeElapsedMs = 0;
    this.betweenElapsedMs = 0;
    this.lastResult = null;
    this.state = 'running';
    this.onTrialStart?.();
  }

  private recordResult(
    success: boolean,
    recognitionMs: number | null,
  ): void {
    if (this.currentTarget === null) return;
    const result: TrialResult = {
      pose: this.currentTarget,
      success,
      recognitionMs:
        success && recognitionMs !== null
          ? Math.round(recognitionMs)
          : null,
    };
    this.results.push(result);
    this.lastResult = result;
    this.state = 'between';
    this.betweenElapsedMs = 0;
  }

  private advanceTrial(): void {
    this.index += 1;
    if (this.index >= this.queue.length) {
      this.state = 'done';
      this.finishedAtIso = new Date().toISOString();
      return;
    }
    this.beginTrial();
  }

  private snapshot(paused: boolean): TestUpdate {
    return {
      state: this.state,
      target: this.currentTarget,
      trialNumber:
        this.queue.length === 0
          ? 0
          : Math.min(this.index + 1, this.queue.length),
      totalTrials: this.queue.length,
      progress: Math.min(1, this.activeElapsedMs / TRIAL_TIMEOUT_MS),
      paused: this.state === 'running' && paused,
      lastResult: this.lastResult,
    };
  }
}
