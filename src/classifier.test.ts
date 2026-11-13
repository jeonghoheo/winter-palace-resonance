import { describe, expect, it } from 'vitest';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  DEFAULT_THRESHOLDS,
  POSE_IDS,
  PoseClassifier,
  classifyPose,
  evaluatePose,
  extractFeatures,
  jointAngle,
  matchesPose,
  poseSimilarity,
  selectPose,
  type PoseFeatures,
  type Vec2,
  type PoseId,
} from './classifier';

const v = (x: number, y: number): Vec2 => ({ x, y });

type FeatureOverrides = Omit<Partial<PoseFeatures>, 'left' | 'right'> & {
  left?: Partial<PoseFeatures['left']>;
  right?: Partial<PoseFeatures['right']>;
};

function makeFeatures(overrides: FeatureOverrides = {}): PoseFeatures {
  const base: PoseFeatures = {
    shoulderWidth: 0.2,
    leftSideSign: 1,
    rightSideSign: -1,
    nose: v(0, -0.5),
    chinY: -0.4,
    midTorsoY: 0.75,
    hipY: 1.5,
    wristVisibility: { left: 1, right: 1 },
    left: {
      shoulder: v(0.5, 0),
      elbow: v(0.5, 0.4),
      wrist: v(0.5, 0.8),
      hip: v(0.5, 1.5),
      elbowAngle: 175,
    },
    right: {
      shoulder: v(-0.5, 0),
      elbow: v(-0.5, 0.4),
      wrist: v(-0.5, 0.8),
      hip: v(-0.5, 1.5),
      elbowAngle: 175,
    },
  };

  return {
    ...base,
    ...overrides,
    left: { ...base.left, ...(overrides.left ?? {}) },
    right: { ...base.right, ...(overrides.right ?? {}) },
  };
}

const alphaFeatures = (): PoseFeatures =>
  makeFeatures({
    left: { wrist: v(-0.3, 0.15), elbowAngle: 90 },
    right: { wrist: v(0.3, 0.15), elbowAngle: 90 },
  });

const betaFeatures = (): PoseFeatures =>
  makeFeatures({
    left: { wrist: v(1.7, 0), elbowAngle: 175 },
    right: { wrist: v(-1.7, 0), elbowAngle: 175 },
  });

const gammaFeatures = (): PoseFeatures =>
  makeFeatures({
    left: { wrist: v(0.9, -0.7) },
    right: { wrist: v(0.2, 1.7) },
  });

const deltaFeatures = (): PoseFeatures =>
  makeFeatures({
    left: { wrist: v(0.1, 0.4) },
    right: { wrist: v(-0.1, 0.4) },
  });

const poseFixtures: Record<PoseId, () => PoseFeatures> = {
  ALPHA: alphaFeatures,
  BETA: betaFeatures,
  GAMMA: gammaFeatures,
  DELTA: deltaFeatures,
};

function makeLandmarks(): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from(
    { length: 33 },
    () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }),
  );
  const set = (index: number, x: number, y: number, visibility = 1): void => {
    landmarks[index] = { x, y, z: 0, visibility };
  };
  set(0, 0.5, 0.3); // nose
  set(11, 0.6, 0.4); // left shoulder
  set(12, 0.4, 0.4); // right shoulder
  set(13, 0.65, 0.55); // left elbow
  set(14, 0.35, 0.55); // right elbow
  set(15, 0.7, 0.7); // left wrist
  set(16, 0.3, 0.7); // right wrist
  set(23, 0.55, 0.7); // left hip
  set(24, 0.45, 0.7); // right hip
  return landmarks;
}

describe('jointAngle', () => {
  it('returns 90 degrees for a right angle', () => {
    expect(jointAngle(v(0, 1), v(0, 0), v(1, 0))).toBeCloseTo(90, 5);
  });

  it('returns 180 degrees for a straight joint', () => {
    expect(jointAngle(v(0, 1), v(0, 0), v(0, -1))).toBeCloseTo(180, 5);
  });

  it('falls back to 180 for a degenerate joint', () => {
    expect(jointAngle(v(0, 0), v(0, 0), v(1, 0))).toBe(180);
  });
});

describe('extractFeatures', () => {
  it('normalizes positions by shoulder width around mid-shoulder', () => {
    const features = extractFeatures(makeLandmarks());
    expect(features).not.toBeNull();
    if (!features) return;
    expect(features.shoulderWidth).toBeCloseTo(0.2, 6);
    expect(features.leftSideSign).toBe(1);
    expect(features.rightSideSign).toBe(-1);
    expect(features.left.shoulder.x).toBeCloseTo(0.5, 6);
    expect(features.right.shoulder.x).toBeCloseTo(-0.5, 6);
    expect(features.left.wrist.x).toBeCloseTo(1.0, 6);
    expect(features.left.wrist.y).toBeCloseTo(1.5, 6);
    expect(features.hipY).toBeCloseTo(1.5, 6);
    expect(features.chinY).toBeCloseTo(-0.4, 6);
    expect(features.midTorsoY).toBeCloseTo(0.75, 6);
    expect(features.left.elbowAngle).toBeCloseTo(180, 3);
  });

  it('returns null when a required joint is not visible', () => {
    const landmarks = makeLandmarks();
    landmarks[15] = { ...landmarks[15], visibility: 0.4 };
    expect(extractFeatures(landmarks)).toBeNull();
  });

  it('returns null when the landmark list is incomplete', () => {
    expect(extractFeatures(makeLandmarks().slice(0, 10))).toBeNull();
  });
});

describe('pose matching', () => {
  it('matches each fixture only with its own pose', () => {
    for (const pose of POSE_IDS) {
      const matched = POSE_IDS.filter((candidate) =>
        matchesPose(poseFixtures[candidate](), pose, false),
      );
      expect(matched).toContain(pose);
      expect(matched).toHaveLength(1);
    }
  });

  it('applies elbow bent hysteresis for ALPHA', () => {
    const features = alphaFeatures();
    features.left.elbowAngle = 130;
    features.right.elbowAngle = 130;
    expect(matchesPose(features, 'ALPHA', false)).toBe(false);
    expect(matchesPose(features, 'ALPHA', true)).toBe(true);
  });

  it('applies wrist height/reach hysteresis for BETA', () => {
    const features = makeFeatures({
      left: { wrist: v(1.45, 0.5), elbowAngle: 175 },
      right: { wrist: v(-1.45, 0.5), elbowAngle: 175 },
    });
    expect(matchesPose(features, 'BETA', false)).toBe(false);
    expect(matchesPose(features, 'BETA', true)).toBe(true);
  });

  it('accepts a GAMMA up wrist that clears the shoulder line even below the nose', () => {
    const features = makeFeatures({
      nose: v(0, -1.4),
      left: { wrist: v(0.6, -0.95) },
      right: { wrist: v(0.1, 1.5) },
    });
    expect(matchesPose(features, 'GAMMA', false)).toBe(true);
  });

  it('does not activate ALPHA when the wrists are together and slightly crossed', () => {
    const features = makeFeatures({
      left: { wrist: v(-0.08, 0.4) },
      right: { wrist: v(0.08, 0.4) },
    });
    expect(matchesPose(features, 'ALPHA', false)).toBe(false);
    expect(matchesPose(features, 'DELTA', false)).toBe(true);
    expect(classifyPose(features, null)).toBe('DELTA');
  });

  it('keeps separated crossed wrists as ALPHA', () => {
    const features = alphaFeatures();
    expect(matchesPose(features, 'ALPHA', false)).toBe(true);
    expect(matchesPose(features, 'DELTA', false)).toBe(false);
    expect(classifyPose(features, null)).toBe('ALPHA');
  });

  it('applies height hysteresis for GAMMA', () => {
    const features = makeFeatures({
      left: { wrist: v(0.9, -0.46) },
      right: { wrist: v(0.2, 1.54) },
    });
    expect(matchesPose(features, 'GAMMA', false)).toBe(false);
    expect(matchesPose(features, 'GAMMA', true)).toBe(true);
  });

  it('applies wrist distance/midline hysteresis for DELTA', () => {
    const features = makeFeatures({
      left: { wrist: v(0.34, 0.4) },
      right: { wrist: v(-0.1, 0.4) },
    });
    expect(matchesPose(features, 'DELTA', false)).toBe(false);
    expect(matchesPose(features, 'DELTA', true)).toBe(true);
  });
});

describe('selectPose', () => {
  it('prefers the active pose when it still matches', () => {
    expect(
      selectPose(
        { ALPHA: true, BETA: true, GAMMA: true, DELTA: true },
        'BETA',
      ),
    ).toBe('BETA');
  });

  it('uses DELTA > ALPHA > GAMMA > BETA priority', () => {
    expect(
      selectPose({ ALPHA: true, BETA: true, GAMMA: true, DELTA: true }, null),
    ).toBe('DELTA');
    expect(
      selectPose({ ALPHA: true, BETA: true, GAMMA: true, DELTA: false }, null),
    ).toBe('ALPHA');
    expect(
      selectPose({ ALPHA: false, BETA: true, GAMMA: true, DELTA: false }, null),
    ).toBe('GAMMA');
    expect(
      selectPose({ ALPHA: false, BETA: true, GAMMA: false, DELTA: false }, null),
    ).toBe('BETA');
  });

  it('returns NO_POSE when nothing matches', () => {
    expect(
      selectPose({ ALPHA: false, BETA: false, GAMMA: false, DELTA: false }, null),
    ).toBe('NO_POSE');
  });
});

describe('PoseClassifier stability', () => {
  it('recognizes a pose only after 300ms continuously', () => {
    const classifier = new PoseClassifier();
    const features = betaFeatures();

    const first = classifier.updateWithFeatures(features, 1000);
    expect(first.label).toBe('BETA');
    expect(first.recognized).toBe(false);
    expect(first.stableForMs).toBe(0);

    const second = classifier.updateWithFeatures(features, 1150);
    expect(second.recognized).toBe(false);
    expect(second.stableForMs).toBe(150);

    const third = classifier.updateWithFeatures(features, 1300);
    expect(third.recognized).toBe(true);
    expect(third.stableForMs).toBe(300);

    const lost = classifier.updateWithFeatures(null, 1316);
    expect(lost.label).toBe('NO_POSE');
    expect(lost.recognized).toBe(false);
  });

  it('resets the stability timer when the pose changes', () => {
    const classifier = new PoseClassifier();
    classifier.updateWithFeatures(betaFeatures(), 0);
    classifier.updateWithFeatures(betaFeatures(), 200);
    const gamma = classifier.updateWithFeatures(gammaFeatures(), 250);
    expect(gamma.label).toBe('GAMMA');
    expect(gamma.recognized).toBe(false);
    expect(gamma.stableForMs).toBe(0);
  });
});

describe('evaluatePose condition details', () => {
  it('returns per-condition detail that matches the aggregate similarity', () => {
    for (const pose of POSE_IDS) {
      const evaluation = evaluatePose(poseFixtures[pose](), pose);
      expect(evaluation.conditions.length).toBeGreaterThan(0);

      for (const condition of evaluation.conditions) {
        expect(condition.name.length).toBeGreaterThan(0);
        expect(condition.requirement.length).toBeGreaterThan(0);
        expect(condition.valueLabel.length).toBeGreaterThan(0);
        expect(typeof condition.passed).toBe('boolean');
        expect(condition.score).toBeGreaterThanOrEqual(0);
        expect(condition.score).toBeLessThanOrEqual(1);
        expect(condition.score).toBeCloseTo(1 - condition.distance, 6);
        expect(condition.passed).toBe(true);
      }

      const meanScore =
        evaluation.conditions.reduce((sum, condition) => sum + condition.score, 0) /
        evaluation.conditions.length;
      expect(evaluation.similarity.score).toBe(Math.round(meanScore * 100));
      const worstScore = Math.min(
        ...evaluation.conditions.map((condition) => condition.score),
      );
      expect(evaluation.similarity.worst.score).toBe(worstScore);
    }
  });

  it('reports failing conditions for an unrelated pose', () => {
    const armsDown = makeFeatures({
      left: { wrist: v(0.6, 1.2), elbowAngle: 170 },
      right: { wrist: v(-0.6, 1.2), elbowAngle: 170 },
    });
    const evaluation = evaluatePose(armsDown, 'BETA');
    expect(evaluation.conditions.some((condition) => !condition.passed)).toBe(
      true,
    );
    expect(evaluation.similarity.score).toBeLessThan(50);
  });

  it('includes the ALPHA wrist separation condition', () => {
    const evaluation = evaluatePose(alphaFeatures(), 'ALPHA');
    const gap = evaluation.conditions.find(
      (condition) => condition.id === 'alpha-wrist-gap',
    );
    expect(gap?.passed).toBe(true);
    expect(gap?.requirement).toContain('0.50');
  });
});

describe('poseSimilarity', () => {
  it('scores a matching pose highly and reports a worst condition', () => {
    const similarity = poseSimilarity(betaFeatures(), 'BETA');
    expect(similarity.score).toBeGreaterThanOrEqual(95);
    expect(similarity.score).toBeLessThanOrEqual(100);
    expect(similarity.worst.joint.length).toBeGreaterThan(0);
    expect(similarity.worst.distance).toBeGreaterThanOrEqual(0);
  });

  it('scores an unrelated pose lower', () => {
    const armsDown = makeFeatures({
      left: { wrist: v(0.6, 1.2), elbowAngle: 170 },
      right: { wrist: v(-0.6, 1.2), elbowAngle: 170 },
    });
    const similarity = poseSimilarity(armsDown, 'BETA');
    expect(similarity.score).toBeLessThan(50);
    expect(similarity.worst.hint.length).toBeGreaterThan(0);
  });

  it('returns a 0-100 score for all poses', () => {
    for (const pose of POSE_IDS) {
      const similarity = poseSimilarity(poseFixtures[pose](), pose);
      expect(similarity.score).toBeGreaterThanOrEqual(0);
      expect(similarity.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('thresholds', () => {
  it('exports defaults with strict enter and looser exit values', () => {
    expect(DEFAULT_THRESHOLDS.elbowStraightEnter).toBeGreaterThan(
      DEFAULT_THRESHOLDS.elbowStraightExit,
    );
    expect(DEFAULT_THRESHOLDS.elbowBentEnter).toBeLessThan(
      DEFAULT_THRESHOLDS.elbowBentExit,
    );
  });
});
