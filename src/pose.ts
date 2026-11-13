import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

export interface FpsStats {
  current: number;
  average5s: number;
}

export interface PoseFrame {
  landmarks: NormalizedLandmark[] | null;
  timestampMs: number;
  fps: FpsStats;
}

export type Delegate = 'GPU' | 'CPU';

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

const FPS_WINDOW_MS = 5000;
const CURRENT_WINDOW_MS = 1000;

export class PoseTracker {
  private landmarker: PoseLandmarker | null = null;
  private delegate: Delegate | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private rafId = 0;
  private lastVideoTime = -1;
  private frameTimestamps: number[] = [];
  private startedAt = 0;

  onFrame: ((frame: PoseFrame) => void) | null = null;
  onError: ((error: unknown) => void) | null = null;

  get activeDelegate(): Delegate | null {
    return this.delegate;
  }

  async init(wasmUrl: string, modelUrl: string): Promise<Delegate> {
    const vision = await FilesetResolver.forVisionTasks(wasmUrl);
    try {
      this.landmarker = await this.createLandmarker(vision, modelUrl, 'GPU');
      this.delegate = 'GPU';
    } catch (error) {
      console.warn('GPU delegate unavailable, falling back to CPU.', error);
      this.landmarker = await this.createLandmarker(vision, modelUrl, 'CPU');
      this.delegate = 'CPU';
    }
    return this.delegate;
  }

  start(video: HTMLVideoElement): void {
    if (!this.landmarker) {
      throw new Error('Pose tracker is not initialized.');
    }
    if (this.running) return;

    this.video = video;
    this.running = true;
    this.lastVideoTime = -1;
    this.frameTimestamps = [];
    this.startedAt = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  resetVideoClock(): void {
    this.lastVideoTime = -1;
  }

  dispose(): void {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
    this.video = null;
  }

  private async createLandmarker(
    vision: VisionFileset,
    modelUrl: string,
    delegate: Delegate,
  ): Promise<PoseLandmarker> {
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelUrl,
        delegate,
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
  }

  private tick = (): void => {
    if (!this.running) return;

    const video = this.video;
    const landmarker = this.landmarker;

    if (
      video &&
      landmarker &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.currentTime !== this.lastVideoTime
    ) {
      this.lastVideoTime = video.currentTime;
      const now = performance.now();

      try {
        const result = landmarker.detectForVideo(video, now);
        this.recordFrame(now);
        this.onFrame?.({
          landmarks: result.landmarks.length > 0 ? result.landmarks[0] : null,
          timestampMs: now,
          fps: this.computeFps(now),
        });
      } catch (error) {
        this.stop();
        this.onError?.(error);
        return;
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private recordFrame(timestampMs: number): void {
    this.frameTimestamps.push(timestampMs);
    const cutoff = timestampMs - FPS_WINDOW_MS;
    while (
      this.frameTimestamps.length > 0 &&
      this.frameTimestamps[0] < cutoff
    ) {
      this.frameTimestamps.shift();
    }
  }

  private computeFps(now: number): FpsStats {
    const timestamps = this.frameTimestamps;
    let currentCount = 0;
    for (let i = timestamps.length - 1; i >= 0; i -= 1) {
      if (now - timestamps[i] > CURRENT_WINDOW_MS) break;
      currentCount += 1;
    }

    const elapsedSeconds = Math.max((now - this.startedAt) / 1000, 1);
    const windowSeconds = Math.min(FPS_WINDOW_MS / 1000, elapsedSeconds);

    return {
      current: currentCount,
      average5s: timestamps.length / windowSeconds,
    };
  }
}
