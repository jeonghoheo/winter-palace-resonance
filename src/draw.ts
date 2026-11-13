import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

const LANDMARK_COUNT = 33;
const MIN_VISIBILITY = 0.35;
const RESET_GAP_MS = 300;

const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [24, 26],
  [25, 27],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
  [27, 31],
  [28, 32],
];

class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;
  private lastValue: number | null = null;
  private lastDerivative = 0;
  private lastTimestamp = 0;

  constructor(minCutoff = 1.0, beta = 0.03, derivativeCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
  }

  reset(): void {
    this.lastValue = null;
    this.lastDerivative = 0;
    this.lastTimestamp = 0;
  }

  filter(value: number, timestampMs: number): number {
    if (this.lastValue === null) {
      this.lastValue = value;
      this.lastTimestamp = timestampMs;
      return value;
    }

    const dt = Math.max((timestampMs - this.lastTimestamp) / 1000, 1e-3);
    this.lastTimestamp = timestampMs;

    const derivative = (value - this.lastValue) / dt;
    const derivativeAlpha = smoothingAlpha(this.derivativeCutoff, dt);
    this.lastDerivative =
      derivativeAlpha * derivative +
      (1 - derivativeAlpha) * this.lastDerivative;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.lastDerivative);
    const alpha = smoothingAlpha(cutoff, dt);
    const filtered = alpha * value + (1 - alpha) * this.lastValue;

    this.lastValue = filtered;
    return filtered;
  }
}

function smoothingAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

interface Point {
  x: number;
  y: number;
  visibility: number;
}

export class SkeletonDrawer {
  private readonly filters: OneEuroFilter[][];
  private lastTimestamp = 0;

  constructor() {
    this.filters = Array.from({ length: LANDMARK_COUNT }, () => [
      new OneEuroFilter(),
      new OneEuroFilter(),
    ]);
  }

  reset(): void {
    for (const [xFilter, yFilter] of this.filters) {
      xFilter.reset();
      yFilter.reset();
    }
    this.lastTimestamp = 0;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    landmarks: NormalizedLandmark[],
    width: number,
    height: number,
    timestampMs: number,
  ): void {
    if (this.lastTimestamp !== 0 && timestampMs - this.lastTimestamp > RESET_GAP_MS) {
      this.reset();
    }
    this.lastTimestamp = timestampMs;

    const points: Point[] = landmarks.map((landmark, index) => {
      const [xFilter, yFilter] = this.filters[index];
      return {
        x: xFilter.filter(landmark.x, timestampMs) * width,
        y: yFilter.filter(landmark.y, timestampMs) * height,
        visibility: landmark.visibility ?? 0,
      };
    });

    const lineWidth = Math.max(2, height * 0.0045);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(94, 234, 255, 0.9)';
    ctx.lineWidth = lineWidth;

    for (const [startIndex, endIndex] of CONNECTIONS) {
      const start = points[startIndex];
      const end = points[endIndex];
      if (
        start.visibility < MIN_VISIBILITY ||
        end.visibility < MIN_VISIBILITY
      ) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }

    const jointRadius = Math.max(2.5, height * 0.0055);
    ctx.fillStyle = 'rgba(242, 251, 255, 0.95)';
    ctx.strokeStyle = 'rgba(10, 32, 52, 0.9)';
    ctx.lineWidth = Math.max(1, lineWidth * 0.35);

    for (const point of points) {
      if (point.visibility < MIN_VISIBILITY) continue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, jointRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/**
 * Overlay-only framing zone: head near the top margin, hips above the bottom
 * margin, and 12% side margins so a T-pose has room. Deliberately textless
 * because the overlay canvas is CSS-mirrored.
 */
export function drawFramingGuide(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) return;

  const marginX = width * 0.12;
  const top = height * 0.08;
  const bottom = height * 0.9;
  const x = marginX;
  const y = top;
  const w = width - marginX * 2;
  const h = bottom - top;

  ctx.save();

  ctx.setLineDash([Math.max(6, height * 0.02), Math.max(5, height * 0.014)]);
  ctx.lineWidth = Math.max(1.5, height * 0.003);
  ctx.strokeStyle = 'rgba(126, 240, 255, 0.28)';
  ctx.strokeRect(x, y, w, h);

  // Solid corner brackets make the zone readable against bright video.
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(2, height * 0.005);
  ctx.strokeStyle = 'rgba(126, 240, 255, 0.55)';
  const corner = Math.min(w, h) * 0.06;

  const corners: ReadonlyArray<readonly [number, number, number, number]> = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ];

  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * corner, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * corner);
    ctx.stroke();
  }

  ctx.restore();
}
