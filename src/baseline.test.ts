import { describe, expect, it } from 'vitest';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { classifyPose, extractFeatures } from './classifier';
import {
  BaselineSession,
  DriftMonitor,
  computeBaseline,
  derotateLandmarks,
  expandedFraming,
  parseBaseline,
  rotateLandmarksAround,
  serializeBaseline,
  type Baseline,
  type DriftSample,
} from './baseline';

type PoseName = 'ALPHA' | 'BETA' | 'GAMMA' | 'DELTA' | 'NEUTRAL';

function makeLandmarks(): NormalizedLandmark[] {
  return Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
}

function set(
  landmarks: NormalizedLandmark[],
  index: number,
  x: number,
  y: number,
  visibility = 1,
): void {
  landmarks[index] = { x, y, z: 0, visibility };
}

function poseLandmarks(pose: PoseName): NormalizedLandmark[] {
  const landmarks = makeLandmarks();
  set(landmarks, 0, 0.5, 0.4);
  set(landmarks, 11, 0.6, 0.5);
  set(landmarks, 12, 0.4, 0.5);
  set(landmarks, 13, 0.6, 0.7);
  set(landmarks, 14, 0.4, 0.7);
  set(landmarks, 15, 0.55, 0.9);
  set(landmarks, 16, 0.45, 0.9);
  set(landmarks, 23, 0.55, 0.8);
  set(landmarks, 24, 0.45, 0.8);

  if (pose === 'BETA') {
    set(landmarks, 13, 0.7, 0.5);
    set(landmarks, 14, 0.3, 0.5);
    set(landmarks, 15, 0.8, 0.5);
    set(landmarks, 16, 0.2, 0.5);
  } else if (pose === 'ALPHA') {
    set(landmarks, 13, 0.66, 0.56);
    set(landmarks, 14, 0.34, 0.56);
    set(landmarks, 15, 0.44, 0.53);
    set(landmarks, 16, 0.56, 0.53);
  } else if (pose === 'GAMMA') {
    set(landmarks, 13, 0.62, 0.42);
    set(landmarks, 14, 0.47, 0.62);
    set(landmarks, 15, 0.68, 0.36);
    set(landmarks, 16, 0.63, 0.73);
  } else if (pose === 'DELTA') {
    set(landmarks, 13, 0.55, 0.58);
    set(landmarks, 14, 0.44, 0.58);
    set(landmarks, 15, 0.52, 0.63);
    set(landmarks, 16, 0.432, 0.63);
  }
  return landmarks;
}

function labelFor(landmarks: NormalizedLandmark[]): string {
  const features = extractFeatures(landmarks);
  expect(features).not.toBeNull();
  if (!features) return 'NO_POSE';
  return classifyPose(features, null);
}

function makeBaseline(rollDeg: number): Baseline {
  return {
    version: 1,
    capturedAt: '2026-11-13T00:00:00.000Z',
    rollDeg,
    midShoulder: { x: 0.5, y: 0.5 },
    shoulderWidthPx: 0.2,
    torsoAxisDeg: 90,
    sampleFraming: { left: 0.2, top: 0.3, right: 0.8, bottom: 0.8 },
  };
}

describe('computeBaseline', () => {
  it('captures roll, mid-shoulder, width, torso axis, and framing', () => {
    const sample = rotateLandmarksAround(
      poseLandmarks('BETA'),
      { x: 0.5, y: 0.5 },
      12,
    );
    const baseline = computeBaseline([sample, sample]);
    expect(baseline).not.toBeNull();
    if (!baseline) return;
    expect(baseline.rollDeg).toBeCloseTo(12, 4);
    expect(baseline.midShoulder.x).toBeCloseTo(0.5, 6);
    expect(baseline.midShoulder.y).toBeCloseTo(0.5, 6);
    expect(baseline.shoulderWidthPx).toBeCloseTo(0.2, 6);
    expect(baseline.torsoAxisDeg).not.toBeNull();
    expect(baseline.sampleFraming.left).toBeLessThan(
      baseline.sampleFraming.right,
    );
    expect(baseline.sampleFraming.top).toBeLessThan(
      baseline.sampleFraming.bottom,
    );
  });

  it('round-trips through serialization', () => {
    const baseline = makeBaseline(-6.2);
    const parsed = parseBaseline(serializeBaseline(baseline));
    expect(parsed).toEqual(baseline);
    expect(parseBaseline('not json')).toBeNull();
  });

  it('expands the sample framing by 25%', () => {
    const expanded = expandedFraming(
      { left: 0.2, top: 0.3, right: 0.8, bottom: 0.8 },
      1.25,
    );
    expect(expanded.left).toBeCloseTo(0.125, 6);
    expect(expanded.right).toBeCloseTo(0.875, 6);
    expect(expanded.top).toBeCloseTo(0.2375, 6);
    expect(expanded.bottom).toBeCloseTo(0.8625, 6);
  });
});

describe('BaselineSession', () => {
  it('fails when the shoulders are not visible in 80% of frames', () => {
    const session = new BaselineSession();
    session.start(0);
    const bad = poseLandmarks('NEUTRAL');
    set(bad, 11, 0.6, 0.5, 0.2);
    set(bad, 12, 0.4, 0.5, 0.2);
    let update = session.update(bad, 0);
    for (let tick = 1; tick <= 16; tick += 1) {
      update = session.update(bad, tick * 100);
    }
    expect(update.failed).toBe(true);
    expect(update.baseline).toBeNull();
  });

  it('produces a baseline from a visible neutral hold', () => {
    const session = new BaselineSession();
    session.start(0);
    const good = poseLandmarks('NEUTRAL');
    let update = session.update(good, 0);
    for (let tick = 1; tick <= 16; tick += 1) {
      update = session.update(good, tick * 100);
    }
    expect(update.done).toBe(true);
    expect(update.baseline?.shoulderWidthPx).toBeCloseTo(0.2, 6);
  });
});

describe('baseline de-rotation', () => {
  const poses: PoseName[] = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'NEUTRAL'];

  it('keeps the same labels for all poses rotated by +12 and -12 degrees', () => {
    for (const pose of poses) {
      const raw = poseLandmarks(pose);
      const expected = labelFor(raw);
      for (const rotation of [12, -12]) {
        const rotated = rotateLandmarksAround(
          raw,
          { x: 0.5, y: 0.5 },
          rotation,
        );
        const derotated = derotateLandmarks(rotated, makeBaseline(rotation));
        expect(labelFor(derotated)).toBe(expected);
      }
    }
  });

  it('uses raw coordinates for the rotated input (no hidden clamping)', () => {
    const rotated = rotateLandmarksAround(
      poseLandmarks('BETA'),
      { x: 0.5, y: 0.5 },
      12,
    );
    expect(rotated[11].y).not.toBeCloseTo(0.5, 6);
  });
});

describe('DriftMonitor', () => {
  const baseline = makeBaseline(0);
  const good: DriftSample = {
    midShoulder: { x: 0.5, y: 0.5 },
    shoulderWidth: 0.2,
  };
  const shifted: DriftSample = {
    midShoulder: { x: 0.58, y: 0.5 },
    shoulderWidth: 0.2,
  };
  const scaled: DriftSample = {
    midShoulder: { x: 0.5, y: 0.5 },
    shoulderWidth: 0.26,
  };

  it('does not flag a steady camera', () => {
    const monitor = new DriftMonitor(baseline);
    let decision = monitor.update(good, 0, false);
    for (let tick = 1; tick <= 50; tick += 1) {
      decision = monitor.update(good, tick * 100, false);
    }
    expect(decision.drifting).toBe(false);
  });

  it('flags a sustained position shift after 2 seconds', () => {
    const monitor = new DriftMonitor(baseline);
    let decision = monitor.update(shifted, 0, false);
    for (let tick = 1; tick <= 25; tick += 1) {
      decision = monitor.update(shifted, tick * 100, false);
    }
    expect(decision.positionDeviationSw).toBeCloseTo(0.4, 6);
    expect(decision.drifting).toBe(true);
  });

  it('flags a sustained 30% scale change', () => {
    const monitor = new DriftMonitor(baseline);
    let decision = monitor.update(scaled, 0, false);
    for (let tick = 1; tick <= 25; tick += 1) {
      decision = monitor.update(scaled, tick * 100, false);
    }
    expect(decision.scaleDeviation).toBeCloseTo(0.3, 6);
    expect(decision.drifting).toBe(true);
  });

  it('never interrupts an in-progress pose', () => {
    const monitor = new DriftMonitor(baseline);
    let decision = monitor.update(shifted, 0, true);
    for (let tick = 1; tick <= 30; tick += 1) {
      decision = monitor.update(shifted, tick * 100, true);
    }
    expect(decision.drifting).toBe(false);

    for (let tick = 31; tick <= 55; tick += 1) {
      decision = monitor.update(shifted, tick * 100, false);
    }
    expect(decision.drifting).toBe(true);
  });
});
