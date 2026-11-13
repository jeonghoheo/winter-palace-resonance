import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  type Vec2,
} from './classifier';
import {
  hasCalibration,
  medianOf,
  thresholdsFromCalibration,
  type CalibrationData,
  type CalibrationPoseValues,
} from './calibration';

const v = (x: number, y: number): Vec2 => ({ x, y });

function makeValues(
  overrides: Partial<CalibrationPoseValues> = {},
): CalibrationPoseValues {
  return {
    elbowAngleLeft: 170,
    elbowAngleRight: 170,
    leftShoulder: v(0.5, 0),
    rightShoulder: v(-0.5, 0),
    leftElbow: v(0.5, 0.5),
    rightElbow: v(-0.5, 0.5),
    leftWrist: v(1.6, 0),
    rightWrist: v(-1.6, 0),
    nose: v(0, -0.5),
    chinY: -0.4,
    midTorsoY: 0.75,
    hipY: 1.5,
    leftSideSign: 1,
    rightSideSign: -1,
    wristDistance: 0.2,
    ...overrides,
  };
}

function makeData(
  values: Partial<Record<'ALPHA' | 'BETA' | 'GAMMA' | 'DELTA', Partial<CalibrationPoseValues>>>,
): CalibrationData {
  return {
    version: 1,
    createdAt: '2026-11-13T00:00:00.000Z',
    neutral: makeValues(),
    poses: {
      ALPHA: makeValues(values.ALPHA),
      BETA: makeValues(values.BETA),
      GAMMA: makeValues(values.GAMMA),
      DELTA: makeValues(values.DELTA),
    },
  };
}

describe('medianOf', () => {
  it('handles odd and even sample counts', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('thresholdsFromCalibration', () => {
  it('returns defaults without calibration data', () => {
    expect(thresholdsFromCalibration(null)).toEqual(DEFAULT_THRESHOLDS);
  });

  it('clamps every adjusted threshold to +/-20% of its default', () => {
    const data = makeData({
      BETA: {
        elbowAngleLeft: 100,
        elbowAngleRight: 100,
        leftWrist: v(10, 5),
        rightWrist: v(-10, -5),
      },
      ALPHA: { elbowAngleLeft: 180, elbowAngleRight: 180 },
      GAMMA: { leftWrist: v(5, -1) },
      DELTA: { wristDistance: 5, leftWrist: v(5, 0.4) },
    });
    const thresholds = thresholdsFromCalibration(data);

    expect(thresholds.elbowStraightEnter).toBeCloseTo(128, 6);
    expect(thresholds.elbowStraightExit).toBeCloseTo(118, 6);
    expect(thresholds.elbowBentEnter).toBeCloseTo(144, 6);
    expect(thresholds.elbowBentExit).toBeCloseTo(156, 6);
    expect(thresholds.betaWristVerticalEnter).toBeCloseTo(0.42, 6);
    expect(thresholds.betaWristHorizontalEnter).toBeCloseTo(1.32, 6);
    expect(thresholds.gammaUpHorizontalEnter).toBeCloseTo(0.84, 6);
    expect(thresholds.deltaWristDistanceEnter).toBeCloseTo(0.42, 6);
    expect(thresholds.deltaWristMidlineEnter).toBeCloseTo(0.36, 6);
  });

  it('moves thresholds toward realistic measured values', () => {
    const data = makeData({
      BETA: {
        elbowAngleLeft: 150,
        elbowAngleRight: 155,
        leftWrist: v(1.5, 0.3),
        rightWrist: v(-1.5, 0.25),
      },
      ALPHA: { elbowAngleLeft: 110, elbowAngleRight: 125 },
      DELTA: {
        wristDistance: 0.32,
        leftWrist: v(0.28, 0.4),
        rightWrist: v(-0.1, 0.4),
      },
    });
    const thresholds = thresholdsFromCalibration(data);

    expect(thresholds.elbowStraightEnter).toBeCloseTo(145, 6);
    expect(thresholds.elbowStraightExit).toBeCloseTo(135, 6);
    expect(thresholds.elbowBentEnter).toBeCloseTo(130, 6);
    expect(thresholds.betaWristVerticalEnter).toBeCloseTo(0.35, 6);
    expect(thresholds.betaWristHorizontalEnter).toBeCloseTo(0.95, 6);
    expect(thresholds.deltaWristDistanceEnter).toBeCloseTo(0.37, 6);
    expect(thresholds.deltaWristMidlineEnter).toBeCloseTo(0.33, 6);
  });
});

describe('hasCalibration', () => {
  it('requires data for all four poses', () => {
    const data = makeData({});
    expect(hasCalibration(data)).toBe(true);
    delete data.poses.DELTA;
    expect(hasCalibration(data)).toBe(false);
    expect(hasCalibration(null)).toBe(false);
  });
});
