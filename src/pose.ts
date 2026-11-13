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

export interface StartedTracking {
  delegate: Delegate;
  gpuFallback: boolean;
}

export type Delegate = 'GPU' | 'CPU';

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

const FPS_WINDOW_MS = 5000;
const CURRENT_WINDOW_MS = 1000;
const MAX_CONSECUTIVE_FAILURES = 30;
const VIDEO_FRAME_TIMEOUT_MS = 10000;

export class PoseTracker {
  private landmarker: PoseLandmarker | null = null;
  private delegate: Delegate | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private rafId = 0;
  private lastVideoTime = -1;
  private frameTimestamps: number[] = [];
  private startedAt = 0;
  private consecutiveFailures = 0;
  private taskCanvas: HTMLCanvasElement | null = null;

  onFrame: ((frame: PoseFrame) => void) | null = null;
  onFatal: ((error: unknown) => void) | null = null;

  get activeDelegate(): Delegate | null {
    return this.delegate;
  }

  /**
   * Creates the one live landmarker and validates it with a first inference.
   * Creation and the first detectForVideo call share one try/catch: on Brave a
   * GPU instance can be created successfully and only crash on that first
   * frame. Any instance that throws is closed before we move on.
   */
  async start(
    video: HTMLVideoElement,
    wasmUrl: string,
    modelUrl: string,
    requestedDelegate: Delegate,
  ): Promise<StartedTracking> {
    if (this.landmarker || this.running) {
      throw new Error('Pose tracker is already running.');
    }

    assertWebglAvailable();
    this.video = video;
    await waitForVideoFrame(video);

    const vision = await FilesetResolver.forVisionTasks(wasmUrl);

    let gpuFallback = false;
    let boot: BootResult;

    if (requestedDelegate === 'GPU') {
      try {
        boot = await this.createAndProbe(vision, modelUrl, video, 'GPU');
        this.delegate = 'GPU';
      } catch (gpuError) {
        console.warn(
          'GPU delegate failed during creation or first inference; recreating with CPU.',
          gpuError,
        );
        gpuFallback = true;
        boot = await this.createAndProbe(vision, modelUrl, video, 'CPU');
        this.delegate = 'CPU';
      }
    } else {
      boot = await this.createAndProbe(vision, modelUrl, video, 'CPU');
      this.delegate = 'CPU';
    }

    this.landmarker = boot.landmarker;
    this.startedAt = boot.timestampMs;
    this.lastVideoTime = video.currentTime;
    this.consecutiveFailures = 0;
    this.running = true;

    this.recordFrame(boot.timestampMs);
    this.onFrame?.({
      landmarks: boot.result.landmarks.length > 0 ? boot.result.landmarks[0] : null,
      timestampMs: boot.timestampMs,
      fps: this.computeFps(boot.timestampMs),
    });

    this.rafId = requestAnimationFrame(this.tick);

    return { delegate: this.delegate, gpuFallback };
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** Closes the landmarker; the tracker object must not be restarted afterwards. */
  dispose(): void {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
    this.video = null;
    this.taskCanvas?.remove();
    this.taskCanvas = null;
  }

  /**
   * MediaPipe's Wasm graph needs a WebGL context even with the CPU delegate,
   * and it fails with "undefined (reading 'activeTexture')" if the graph has to
   * create that context implicitly. Passing an explicit canvas makes the
   * context ownership deterministic (upstream workaround for that crash).
   */
  private createTaskCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'fixed';
    canvas.style.left = '-10000px';
    canvas.style.top = '0';
    canvas.style.width = '1px';
    canvas.style.height = '1px';
    canvas.style.visibility = 'hidden';
    document.body.append(canvas);
    return canvas;
  }

  private async createAndProbe(
    vision: VisionFileset,
    modelUrl: string,
    video: HTMLVideoElement,
    delegate: Delegate,
  ): Promise<BootResult> {
    const canvas = this.createTaskCanvas();
    let landmarker: PoseLandmarker | null = null;
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate,
        },
        canvas,
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });

      const timestampMs = performance.now();
      const result = landmarker.detectForVideo(video, timestampMs);
      this.taskCanvas = canvas;

      return { landmarker, result, timestampMs };
    } catch (error) {
      landmarker?.close();
      canvas.remove();
      throw error;
    }
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
        this.consecutiveFailures = 0;
        this.recordFrame(now);
        this.onFrame?.({
          landmarks: result.landmarks.length > 0 ? result.landmarks[0] : null,
          timestampMs: now,
          fps: this.computeFps(now),
        });
      } catch (error) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.failTracking(error);
          return;
        }
        console.warn(
          `Pose inference failed (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}); retrying.`,
          error,
        );
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private failTracking(error: unknown): void {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
    this.onFatal?.(error);
  }

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
    const currentStart = now - CURRENT_WINDOW_MS;
    let currentCount = 0;
    for (let i = timestamps.length - 1; i >= 0; i -= 1) {
      if (timestamps[i] < currentStart) break;
      currentCount += 1;
    }

    const elapsedSeconds = Math.max((now - this.startedAt) / 1000, 0.5);
    const averageWindowSeconds = Math.min(FPS_WINDOW_MS / 1000, elapsedSeconds);
    const currentWindowSeconds = Math.min(
      CURRENT_WINDOW_MS / 1000,
      Math.max((now - this.startedAt) / 1000, 0.5),
    );

    return {
      current: currentCount / currentWindowSeconds,
      average5s: timestamps.length / averageWindowSeconds,
    };
  }
}

interface BootResult {
  landmarker: PoseLandmarker;
  result: ReturnType<PoseLandmarker['detectForVideo']>;
  timestampMs: number;
}

function assertWebglAvailable(): void {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
  if (!gl) {
    throw new Error(
      'WebGL is unavailable in this browser. MediaPipe pose tracking needs WebGL even with the CPU delegate. ' +
        'In Brave, turn off Shields (or fingerprinting protection) for this site, then press Retry.',
    );
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Camera stream did not produce a frame in time.'));
    }, VIDEO_FRAME_TIMEOUT_MS);

    const onReady = (): void => {
      cleanup();
      resolve();
    };

    const onError = (): void => {
      cleanup();
      reject(new Error('Camera stream failed to produce frames.'));
    };

    const cleanup = (): void => {
      window.clearTimeout(timer);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}
