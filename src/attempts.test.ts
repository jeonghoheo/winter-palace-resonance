import { describe, expect, it } from 'vitest';
import type { Landmark } from '@mediapipe/tasks-vision';
import {
  evaluatePose,
  wristCrossingOffset,
  wristGap,
  type PoseFeatures,
  type Vec2,
} from './classifier';
import {
  AttemptRecorder,
  buildAttemptFrame,
  type AttemptStorage,
  type AttemptStore,
} from './attempts';

const v = (x: number, y: number): Vec2 => ({ x, y });

function makeFeatures(): PoseFeatures {
  return {
    shoulderWidth: 0.2,
    leftSideSign: 1,
    rightSideSign: -1,
    nose: v(0, -0.5),
    chinY: -0.4,
    midTorsoY: 0.75,
    hipY: 1.5,
    hipRefY: 1.5,
    wristVisibility: { left: 0.98, right: 0.91 },
    left: {
      shoulder: v(0.5, 0),
      elbow: v(0.6, 0.3),
      wrist: v(1.7, 0),
      hip: v(0.5, 1.5),
      elbowAngle: 174,
    },
    right: {
      shoulder: v(-0.5, 0),
      elbow: v(-0.6, 0.3),
      wrist: v(-1.7, 0),
      hip: v(-0.5, 1.5),
      elbowAngle: 168,
    },
  };
}

function makeWorldLandmarks(): Landmark[] {
  const landmarks: Landmark[] = Array.from(
    { length: 33 },
    () => ({ x: 0, y: 0, z: 0, visibility: 0.9 }),
  );
  const set = (index: number, x: number, y: number, z = 0): void => {
    landmarks[index] = { x, y, z, visibility: 0.9 };
  };
  set(0, 0, -0.5, 0);
  set(11, 0, 0, 0);
  set(13, 0, 1, 0);
  set(15, 1, 1, 0);
  set(12, 0, 0, 0);
  set(14, 0, 1, 0);
  set(16, -1, 1, 0);
  set(23, 0, 2, 0);
  set(24, 0, 2, 0);
  return landmarks;
}

class MemoryStorage implements AttemptStorage {
  store: AttemptStore | null = null;

  load(): AttemptStore | null {
    return this.store;
  }

  save(store: AttemptStore): void {
    this.store = store;
  }
}

describe('buildAttemptFrame', () => {
  it('serializes 2D features, conditions, and 3D world landmarks', () => {
    const features = makeFeatures();
    const conditions = evaluatePose(features, 'BETA').conditions;
    const world = makeWorldLandmarks();

    const frame = buildAttemptFrame(1000, {
      timestampMs: 1160,
      features,
      conditions,
      label: 'BETA',
      similarity: 88,
      worldLandmarks: world,
    });

    expect(frame.t).toBe(160);
    expect(frame.timestampMs).toBe(1160);
    expect(frame.label).toBe('BETA');
    expect(frame.similarity).toBe(88);
    expect(frame.features.elbowAngleLeft).toBe(174);
    expect(frame.features.elbowAngleRight).toBe(168);
    expect(frame.features.wristGap).toBeCloseTo(wristGap(features), 8);
    expect(frame.features.crossingLeft).toBeCloseTo(
      wristCrossingOffset(features.left.wrist.x, features.leftSideSign),
      8,
    );
    expect(frame.features.wristHeightLeft).toBeCloseTo(0, 8);
    expect(frame.features.wristVisibilityLeft).toBe(0.98);
    expect(frame.features.wristVisibilityRight).toBe(0.91);

    expect(frame.conditions.length).toBe(conditions.length);
    expect(frame.conditions[0].id).toBe(conditions[0].id);
    expect(frame.conditions[0].name).toBe(conditions[0].name);
    expect(frame.conditions[0].value).toBeCloseTo(conditions[0].value, 6);
    expect(frame.conditions[0].valueLabel).toBe(conditions[0].valueLabel);
    expect(frame.conditions[0].requirement).toBe(conditions[0].requirement);
    expect(frame.conditions[0].passed).toBe(conditions[0].passed);
    expect(frame.conditions[0].score).toBeCloseTo(conditions[0].score, 6);

    expect(frame.world).not.toBeNull();
    expect(frame.world?.nose.y).toBeCloseTo(-0.5, 8);
    expect(frame.world?.leftShoulder.x).toBeCloseTo(0, 8);
    expect(frame.world?.rightWrist.x).toBeCloseTo(-1, 8);
    expect(frame.world?.elbowAngleLeftDeg).toBeCloseTo(90, 6);
    expect(frame.world?.elbowAngleRightDeg).toBeCloseTo(90, 6);

    const json = JSON.stringify(frame);
    expect(json).toContain('"world"');
    expect(json).toContain('"elbowAngleLeftDeg"');
    expect(json).toContain('"conditions"');
  });

  it('writes null world data when landmarks are unavailable', () => {
    const features = makeFeatures();
    const frame = buildAttemptFrame(0, {
      timestampMs: 50,
      features,
      conditions: evaluatePose(features, 'BETA').conditions,
      label: 'NO_POSE',
      similarity: 12,
      worldLandmarks: null,
    });
    expect(frame.world).toBeNull();
  });
});

describe('AttemptRecorder', () => {
  it('handles start/stop state and appends sessions per pose', () => {
    const storage = new MemoryStorage();
    const recorder = new AttemptRecorder(storage);
    expect(recorder.isRecording).toBe(false);
    expect(recorder.hasAttempts()).toBe(false);

    const features = makeFeatures();
    const conditions = evaluatePose(features, 'DELTA').conditions;
    const input = {
      timestampMs: 1250,
      features,
      conditions,
      label: 'DELTA' as const,
      similarity: 70,
      worldLandmarks: makeWorldLandmarks(),
    };

    expect(recorder.start('DELTA', 1000)).toBe(true);
    expect(recorder.isRecording).toBe(true);
    expect(recorder.recordingPose).toBe('DELTA');
    expect(recorder.record(input)).toBe(true);
    expect(recorder.record({ ...input, timestampMs: 1300 })).toBe(true);
    expect(recorder.frameCount).toBe(2);

    const session = recorder.stop();
    expect(session?.frames).toHaveLength(2);
    expect(session?.stoppedAt.length).toBeGreaterThan(0);
    expect(recorder.isRecording).toBe(false);
    expect(recorder.record(input)).toBe(false);
    expect(recorder.hasAttempts()).toBe(true);
    expect(recorder.getStore().poses.DELTA).toHaveLength(1);
    expect(storage.store?.poses.DELTA).toHaveLength(1);

    expect(recorder.start('DELTA', 2000)).toBe(true);
    expect(recorder.start('DELTA', 2100)).toBe(false);
    recorder.record({ ...input, timestampMs: 2100 });
    recorder.stop();
    expect(recorder.getStore().poses.DELTA).toHaveLength(2);
    expect(recorder.getStore().version).toBe(1);
    expect(recorder.getStore().updatedAt.length).toBeGreaterThan(0);
  });
});
