import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * Side convention
 * ---------------
 * All math in this file uses RAW MediaPipe image coordinates: x grows to the
 * right of the unmirrored camera image, y grows down. When a person faces the
 * camera, their anatomical LEFT landmarks appear on the RIGHT side of that raw
 * image (larger x). The on-screen preview is mirrored with CSS for the selfie
 * view, but classification never sees the mirror. Side-dependent checks are
 * written against each shoulder's own sign so they stay correct regardless of
 * whether the user's left shoulder is at +x or -x in raw coordinates.
 *
 * Features are expressed in shoulder-width units (SW), with the origin at the
 * mid-shoulder point and y still pointing down.
 */

export type PoseId = 'ALPHA' | 'BETA' | 'GAMMA' | 'DELTA';
export type PoseLabel = PoseId | 'NO_POSE';

export const POSE_IDS: readonly PoseId[] = ['ALPHA', 'BETA', 'GAMMA', 'DELTA'];

/** When several poses match at once, first match in this order wins. */
export const POSE_PRIORITY: readonly PoseId[] = ['DELTA', 'ALPHA', 'GAMMA', 'BETA'];

export const VISIBILITY_THRESHOLD = 0.5;
export const STABLE_RECOGNITION_MS = 300;

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

/** Approximate chin distance below the nose in shoulder-width units. */
const CHIN_OFFSET_SW = 0.1;
/** Raw/debug fallback hip offset when hips are not visible. */
const FALLBACK_HIP_OFFSET_SW = 1.6;
/** Effective hip reference for cropped/seated upper-body framing (waist level). */
const CROPPED_HIP_REF_SW = 1.15;

export interface Vec2 {
  x: number;
  y: number;
}

export interface SideFeatures {
  shoulder: Vec2;
  elbow: Vec2;
  wrist: Vec2;
  hip: Vec2;
  elbowAngle: number;
}

export interface PoseFeatures {
  shoulderWidth: number;
  /** +1 when the anatomical left shoulder is on the +x side of the raw image. */
  leftSideSign: number;
  rightSideSign: number;
  nose: Vec2;
  chinY: number;
  midTorsoY: number;
  /** Raw hip line (real hips when visible, otherwise the legacy 1.6 SW debug fallback). */
  hipY: number;
  /** Effective hip reference used by all gates/scores (1.15 SW when hips are cropped). */
  hipRefY: number;
  left: SideFeatures;
  right: SideFeatures;
  wristVisibility: { left: number; right: number };
  reliability: {
    left: { elbow: boolean; wrist: boolean };
    right: { elbow: boolean; wrist: boolean };
  };
}

/**
 * Enter thresholds are the strict values required to claim a pose. Exit
 * thresholds are looser and are used only while that pose is already active,
 * which produces stickiness without frame-to-frame flicker.
 */
export interface ClassifierThresholds {
  elbowStraightEnter: number;
  elbowStraightExit: number;
  elbowBentEnter: number;
  elbowBentExit: number;

  alphaCrossEnter: number;
  alphaCrossExit: number;
  alphaBandInset: number;
  alphaBandSlack: number;
  alphaWristDistanceEnter: number;
  alphaWristDistanceExit: number;

  betaWristVerticalEnter: number;
  betaWristVerticalExit: number;
  betaWristHorizontalEnter: number;
  betaWristHorizontalExit: number;

  gammaUpAboveNoseEnter: number;
  gammaUpAboveNoseExit: number;
  gammaUpAboveShoulderEnter: number;
  gammaUpAboveShoulderExit: number;
  gammaUpHorizontalEnter: number;
  gammaUpHorizontalExit: number;
  gammaDownBelowHipEnter: number;
  gammaDownBelowHipExit: number;
  gammaDownMidlineEnter: number;
  gammaDownMidlineExit: number;

  deltaWristDistanceEnter: number;
  deltaWristDistanceExit: number;
  deltaWristMidlineEnter: number;
  deltaWristMidlineExit: number;
  deltaBandInset: number;
  deltaBandSlack: number;
  deltaOwnSideEnter: number;
  deltaOwnSideExit: number;
}

export const DEFAULT_THRESHOLDS: ClassifierThresholds = {
  elbowStraightEnter: 150,
  elbowStraightExit: 140,
  elbowBentEnter: 120,
  elbowBentExit: 132,

  alphaCrossEnter: 0.02,
  alphaCrossExit: -0.02,
  alphaBandInset: 0.05,
  alphaBandSlack: 0.1,
  alphaWristDistanceEnter: 0.55,
  alphaWristDistanceExit: 0.48,

  betaWristVerticalEnter: 0.45,
  betaWristVerticalExit: 0.55,
  betaWristHorizontalEnter: 1.0,
  betaWristHorizontalExit: 0.9,

  gammaUpAboveNoseEnter: 0.05,
  gammaUpAboveNoseExit: -0.05,
  gammaUpAboveShoulderEnter: 0.9,
  gammaUpAboveShoulderExit: 0.8,
  gammaUpHorizontalEnter: 0.55,
  gammaUpHorizontalExit: 0.45,
  gammaDownBelowHipEnter: -0.4,
  gammaDownBelowHipExit: -0.5,
  gammaDownMidlineEnter: 0.85,
  gammaDownMidlineExit: 0.95,

  deltaWristDistanceEnter: 0.5,
  deltaWristDistanceExit: 0.62,
  deltaWristMidlineEnter: 0.38,
  deltaWristMidlineExit: 0.48,
  deltaBandInset: 0.05,
  deltaBandSlack: 0.1,
  deltaOwnSideEnter: -0.15,
  deltaOwnSideExit: -0.25,
};

/** Fixed gate-relative similarity rule (SW conditions). */
export const SIMILARITY_SW_MARGIN = 0.25;
export const SIMILARITY_SW_RANGE = 0.55;
/** Fixed gate-relative similarity rule (angle conditions, degrees). */
export const SIMILARITY_ANGLE_MARGIN = 25;
export const SIMILARITY_ANGLE_RANGE = 55;
/** How far outside a band reaches score 0. */
export const SIMILARITY_BAND_OUTSIDE = 0.35;

export function jointAngle(a: Vec2, b: Vec2, c: Vec2): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const lengths = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (lengths < 1e-9) return 180;
  const cosine = clamp((abx * cbx + aby * cby) / lengths, -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * Extracts the classifier feature vector from raw landmarks. Only the torso
 * core (both shoulders) gates the frame; unreliable elbows/wrists are flagged
 * per side so BETA/GAMMA can fall back to arm-segment direction evidence.
 */
export function extractFeatures(
  landmarks: NormalizedLandmark[],
): PoseFeatures | null {
  if (!landmarks || landmarks.length <= RIGHT_HIP) return null;

  const rawLeftShoulder = landmarks[LEFT_SHOULDER];
  const rawRightShoulder = landmarks[RIGHT_SHOULDER];
  if (
    !isReliableLandmark(rawLeftShoulder) ||
    !isReliableLandmark(rawRightShoulder)
  ) {
    return null;
  }

  const rawLeftElbow = landmarks[LEFT_ELBOW];
  const rawRightElbow = landmarks[RIGHT_ELBOW];
  const rawLeftWrist = landmarks[LEFT_WRIST];
  const rawRightWrist = landmarks[RIGHT_WRIST];
  const rawNose = landmarks[NOSE];

  const shoulderWidth = Math.hypot(
    rawLeftShoulder.x - rawRightShoulder.x,
    rawLeftShoulder.y - rawRightShoulder.y,
  );
  if (!Number.isFinite(shoulderWidth) || shoulderWidth < 1e-4) return null;

  const midX = (rawLeftShoulder.x + rawRightShoulder.x) / 2;
  const midY = (rawLeftShoulder.y + rawRightShoulder.y) / 2;
  const leftSideSign = Math.sign(rawLeftShoulder.x - midX) || 1;
  const rightSideSign = Math.sign(rawRightShoulder.x - midX) || -1;

  const normalize = (point: { x: number; y: number }): Vec2 => ({
    x: (point.x - midX) / shoulderWidth,
    y: (point.y - midY) / shoulderWidth,
  });

  const leftHipVisible = isReliableLandmark(landmarks[LEFT_HIP]);
  const rightHipVisible = isReliableLandmark(landmarks[RIGHT_HIP]);
  const hipsVisible = leftHipVisible && rightHipVisible;

  const hipMidY = hipsVisible
    ? (landmarks[LEFT_HIP].y + landmarks[RIGHT_HIP].y) / 2
    : midY + FALLBACK_HIP_OFFSET_SW * shoulderWidth;

  const hipY = (hipMidY - midY) / shoulderWidth;
  const hipRefY = hipsVisible ? hipY : CROPPED_HIP_REF_SW;
  const nose = normalize(rawNose);
  const chinY = nose.y + CHIN_OFFSET_SW;
  const midTorsoY = hipRefY / 2;

  const fallbackHip = (sign: number): Vec2 => ({
    x: sign * 0.5,
    y: hipRefY,
  });

  return {
    shoulderWidth,
    leftSideSign,
    rightSideSign,
    nose,
    chinY,
    midTorsoY,
    hipY,
    hipRefY,
    wristVisibility: {
      left: rawLeftWrist.visibility ?? 0,
      right: rawRightWrist.visibility ?? 0,
    },
    reliability: {
      left: {
        elbow: isReliableLandmark(rawLeftElbow),
        wrist: isReliableLandmark(rawLeftWrist),
      },
      right: {
        elbow: isReliableLandmark(rawRightElbow),
        wrist: isReliableLandmark(rawRightWrist),
      },
    },
    left: {
      shoulder: normalize(rawLeftShoulder),
      elbow: normalize(rawLeftElbow),
      wrist: normalize(rawLeftWrist),
      hip: hipsVisible ? normalize(landmarks[LEFT_HIP]) : fallbackHip(leftSideSign),
      elbowAngle: jointAngle(rawLeftShoulder, rawLeftElbow, rawLeftWrist),
    },
    right: {
      shoulder: normalize(rawRightShoulder),
      elbow: normalize(rawRightElbow),
      wrist: normalize(rawRightWrist),
      hip: hipsVisible
        ? normalize(landmarks[RIGHT_HIP])
        : fallbackHip(rightSideSign),
      elbowAngle: jointAngle(rawRightShoulder, rawRightElbow, rawRightWrist),
    },
  };
}

/** Positive = crossed past the midline to the far side; negative = own side. */
export function wristCrossingOffset(wristX: number, sideSign: number): number {
  return -(wristX * sideSign);
}

/** Wrist-to-wrist distance in shoulder-width units. */
export function wristGap(features: PoseFeatures): number {
  return Math.hypot(
    features.left.wrist.x - features.right.wrist.x,
    features.left.wrist.y - features.right.wrist.y,
  );
}

/** Positive value means the wrist is on its own side of the midline. */
function ownSideAmount(wristX: number, sideSign: number): number {
  return wristX * sideSign;
}

/** Hysteresis for "value must be >= threshold". */
function atLeast(value: number, enter: number, exit: number, active: boolean): boolean {
  return active ? value >= exit : value >= enter;
}

/** Hysteresis for "value must be <= threshold". */
function atMost(value: number, enter: number, exit: number, active: boolean): boolean {
  return active ? value <= exit : value <= enter;
}

/** Hysteresis for a band. The exit band is wider than the enter band. */
function inBand(
  value: number,
  enterMin: number,
  enterMax: number,
  exitMin: number,
  exitMax: number,
  active: boolean,
): boolean {
  return active
    ? value >= exitMin && value <= exitMax
    : value >= enterMin && value <= enterMax;
}

export function matchesPose(
  features: PoseFeatures,
  pose: PoseId,
  active: boolean,
  thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
): boolean {
  const t = thresholds;

  if (pose === 'ALPHA') {
    // Hand separation comes first: gathered hands (DELTA) can overshoot the
    // midline and otherwise look crossed, but an X always has separated hands.
    const leftCrossed = wristCrossingOffset(
      features.left.wrist.x,
      features.leftSideSign,
    );
    const rightCrossed = wristCrossingOffset(
      features.right.wrist.x,
      features.rightSideSign,
    );
    return (
      atLeast(
        wristGap(features),
        t.alphaWristDistanceEnter,
        t.alphaWristDistanceExit,
        active,
      ) &&
      atLeast(leftCrossed, t.alphaCrossEnter, t.alphaCrossExit, active) &&
      atLeast(rightCrossed, t.alphaCrossEnter, t.alphaCrossExit, active) &&
      inBand(
        features.left.wrist.y,
        features.chinY + t.alphaBandInset,
        features.midTorsoY - t.alphaBandInset,
        features.chinY - t.alphaBandSlack,
        features.midTorsoY + t.alphaBandSlack,
        active,
      ) &&
      inBand(
        features.right.wrist.y,
        features.chinY + t.alphaBandInset,
        features.midTorsoY - t.alphaBandInset,
        features.chinY - t.alphaBandSlack,
        features.midTorsoY + t.alphaBandSlack,
        active,
      ) &&
      atMost(
        features.left.elbowAngle,
        t.elbowBentEnter,
        t.elbowBentExit,
        active,
      ) &&
      atMost(
        features.right.elbowAngle,
        t.elbowBentEnter,
        t.elbowBentExit,
        active,
      )
    );
  }

  if (pose === 'BETA') {
    return (
      betaSideMatches(features, 'left', active, t) &&
      betaSideMatches(features, 'right', active, t)
    );
  }

  if (pose === 'GAMMA') {
    return (
      gammaMatches(features, 'left', 'right', active, t) ||
      gammaMatches(features, 'right', 'left', active, t)
    );
  }

  return (
    atMost(
      Math.hypot(
        features.left.wrist.x - features.right.wrist.x,
        features.left.wrist.y - features.right.wrist.y,
      ),
      t.deltaWristDistanceEnter,
      t.deltaWristDistanceExit,
      active,
    ) &&
    atMost(
      Math.abs(features.left.wrist.x),
      t.deltaWristMidlineEnter,
      t.deltaWristMidlineExit,
      active,
    ) &&
    atMost(
      Math.abs(features.right.wrist.x),
      t.deltaWristMidlineEnter,
      t.deltaWristMidlineExit,
      active,
    ) &&
    inBand(
      features.left.wrist.y,
      features.left.shoulder.y + t.deltaBandInset,
      features.hipRefY - t.deltaBandInset,
      features.left.shoulder.y - t.deltaBandSlack,
      features.hipRefY + t.deltaBandSlack,
      active,
    ) &&
    inBand(
      features.right.wrist.y,
      features.right.shoulder.y + t.deltaBandInset,
      features.hipRefY - t.deltaBandInset,
      features.right.shoulder.y - t.deltaBandSlack,
      features.hipRefY + t.deltaBandSlack,
      active,
    ) &&
    atLeast(
      ownSideAmount(features.left.wrist.x, features.leftSideSign),
      t.deltaOwnSideEnter,
      t.deltaOwnSideExit,
      active,
    ) &&
    atLeast(
      ownSideAmount(features.right.wrist.x, features.rightSideSign),
      t.deltaOwnSideEnter,
      t.deltaOwnSideExit,
      active,
    )
  );
}

type SideName = 'left' | 'right';

const BETA_ARM_HEIGHT_SW = 0.35;
const BETA_ARM_REACH_SW = 0.55;
const BETA_ARM_ANGLE_DEG = 30;
const GAMMA_ARM_UP_SW = 0.3;
const GAMMA_ARM_OUT_SW = 0.35;

function betaSideMatches(
  features: PoseFeatures,
  side: SideName,
  active: boolean,
  t: ClassifierThresholds,
): boolean {
  const sideFeatures = features[side];
  if (features.reliability[side].wrist) {
    // Good wrist data always wins; the arm-direction fallback never replaces it.
    return (
      atLeast(
        sideFeatures.elbowAngle,
        t.elbowStraightEnter,
        t.elbowStraightExit,
        active,
      ) &&
      atMost(
        Math.abs(sideFeatures.wrist.y - sideFeatures.shoulder.y),
        t.betaWristVerticalEnter,
        t.betaWristVerticalExit,
        active,
      ) &&
      atLeast(
        Math.abs(sideFeatures.wrist.x - sideFeatures.shoulder.x),
        t.betaWristHorizontalEnter,
        t.betaWristHorizontalExit,
        active,
      )
    );
  }
  return betaArmDirectionMatches(features, side);
}

function betaArmDirectionMatches(
  features: PoseFeatures,
  side: SideName,
): boolean {
  if (!features.reliability[side].elbow) return false;
  const { outwardDx, dy, angleDeg } = armDirection(features, side);
  return (
    Math.abs(dy) <= BETA_ARM_HEIGHT_SW &&
    outwardDx >= BETA_ARM_REACH_SW &&
    angleDeg <= BETA_ARM_ANGLE_DEG
  );
}

function gammaArmDirectionMatches(
  features: PoseFeatures,
  side: SideName,
): boolean {
  if (!features.reliability[side].elbow) return false;
  const sideFeatures = features[side];
  const sideSign =
    side === 'left' ? features.leftSideSign : features.rightSideSign;
  const aboveShoulder = sideFeatures.shoulder.y - sideFeatures.elbow.y;
  const outwardDx =
    (sideFeatures.elbow.x - sideFeatures.shoulder.x) * sideSign;
  return aboveShoulder >= GAMMA_ARM_UP_SW && outwardDx >= GAMMA_ARM_OUT_SW;
}

function armDirection(
  features: PoseFeatures,
  side: SideName,
): {
  outwardDx: number;
  dy: number;
  angleDeg: number;
  aboveShoulder: number;
} {
  const sideFeatures = features[side];
  const sideSign =
    side === 'left' ? features.leftSideSign : features.rightSideSign;
  const outwardDx =
    (sideFeatures.elbow.x - sideFeatures.shoulder.x) * sideSign;
  const dy = sideFeatures.elbow.y - sideFeatures.shoulder.y;
  const angleDeg = (Math.atan2(Math.abs(dy), outwardDx) * 180) / Math.PI;
  return {
    outwardDx,
    dy,
    angleDeg,
    aboveShoulder: sideFeatures.shoulder.y - sideFeatures.elbow.y,
  };
}

function gammaMatches(
  features: PoseFeatures,
  upSide: SideName,
  downSide: SideName,
  active: boolean,
  t: ClassifierThresholds,
): boolean {
  const up = features[upSide];
  const down = features[downSide];
  // "Above nose" / "above shoulder" / "below hip" are positive amounts in the
  // expected direction so the same atLeast hysteresis helper applies.
  const upAboveNose = features.nose.y - up.wrist.y;
  const upAboveShoulder = up.shoulder.y - up.wrist.y;
  const downBelowHip = down.wrist.y - features.hipRefY;

  const upPass = features.reliability[upSide].wrist
    ? (atLeast(
        upAboveNose,
        t.gammaUpAboveNoseEnter,
        t.gammaUpAboveNoseExit,
        active,
      ) ||
        atLeast(
          upAboveShoulder,
          t.gammaUpAboveShoulderEnter,
          t.gammaUpAboveShoulderExit,
          active,
        )) &&
      atLeast(
        Math.abs(up.wrist.x),
        t.gammaUpHorizontalEnter,
        t.gammaUpHorizontalExit,
        active,
      )
    : gammaArmDirectionMatches(features, upSide);

  return (
    upPass &&
    atLeast(
      downBelowHip,
      t.gammaDownBelowHipEnter,
      t.gammaDownBelowHipExit,
      active,
    ) &&
    atMost(
      Math.abs(down.wrist.x),
      t.gammaDownMidlineEnter,
      t.gammaDownMidlineExit,
      active,
    )
  );
}

export function selectPose(
  matches: Record<PoseId, boolean>,
  active: PoseId | null,
): PoseLabel {
  if (active && matches[active]) return active;
  for (const pose of POSE_PRIORITY) {
    if (matches[pose]) return pose;
  }
  return 'NO_POSE';
}

export function classifyPose(
  features: PoseFeatures,
  active: PoseId | null,
  thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
): PoseLabel {
  const matches: Record<PoseId, boolean> = {
    ALPHA: matchesPose(features, 'ALPHA', active === 'ALPHA', thresholds),
    BETA: matchesPose(features, 'BETA', active === 'BETA', thresholds),
    GAMMA: matchesPose(features, 'GAMMA', active === 'GAMMA', thresholds),
    DELTA: matchesPose(features, 'DELTA', active === 'DELTA', thresholds),
  };
  return selectPose(matches, active);
}

export interface PoseConditionInfo {
  id: string;
  name: string;
  joint: string;
  hint: string;
  /** Measured value in this condition's natural units. */
  value: number;
  valueLabel: string;
  requirement: string;
  /** Pass/fail against the strict enter requirement (not hysteresis). */
  passed: boolean;
  /** 1 - distance: 0 is far, 1 is perfect. */
  score: number;
  /** 0 = perfect, 1 = far (kept for compatibility with the older API). */
  distance: number;
}

export interface PoseSimilarity {
  score: number;
  worst: PoseConditionInfo;
}

export interface PoseEvaluation {
  conditions: PoseConditionInfo[];
  similarity: PoseSimilarity;
}

/**
 * Similarity is gate-relative now: each condition's score comes from its own
 * strict enter gate and the fixed rule above. A value exactly on the gate
 * scores 0.6, clearing the gate by the margin scores 1.0, and falling behind
 * the gate by the range scores 0. The overall similarity is the mean of the
 * condition scores. The worst condition (lowest score) supplies the hint.
 */
export function evaluatePose(
  features: PoseFeatures,
  pose: PoseId,
  thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
): PoseEvaluation {
  const conditions = buildConditions(features, pose, thresholds);
  let totalScore = 0;
  let worst = conditions[0];
  for (const condition of conditions) {
    totalScore += condition.score;
    if (condition.score < worst.score) worst = condition;
  }
  const score = Math.round(
    clamp(totalScore / conditions.length, 0, 1) * 100,
  );
  return { conditions, similarity: { score, worst } };
}

export function poseSimilarity(
  features: PoseFeatures,
  pose: PoseId,
  thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
): PoseSimilarity {
  return evaluatePose(features, pose, thresholds).similarity;
}

function buildConditions(
  features: PoseFeatures,
  pose: PoseId,
  t: ClassifierThresholds,
): PoseConditionInfo[] {
  if (pose === 'ALPHA') {
    const gap = wristGap(features);
    const leftCross = wristCrossingOffset(
      features.left.wrist.x,
      features.leftSideSign,
    );
    const rightCross = wristCrossingOffset(
      features.right.wrist.x,
      features.rightSideSign,
    );
    const bandEnterMin = features.chinY + t.alphaBandInset;
    const bandEnterMax = features.midTorsoY - t.alphaBandInset;

    return [
      makeCondition({
        id: 'alpha-wrist-gap',
        name: 'Wrist separation',
        joint: 'Both wrists',
        hint: 'Spread your wrists apart into an X.',
        value: gap,
        valueLabel: sw(gap),
        requirement: geSw(t.alphaWristDistanceEnter),
        passed: gap >= t.alphaWristDistanceEnter,
        score: scoreAtLeast(
          gap,
          t.alphaWristDistanceEnter,
          SIMILARITY_SW_MARGIN,
          SIMILARITY_SW_RANGE,
        ),
      }),
      makeCondition({
        id: 'alpha-left-cross',
        name: 'L wrist crossing',
        joint: 'Left wrist',
        hint: 'Cross your left wrist past the midline.',
        value: leftCross,
        valueLabel: `${fmtSigned(leftCross)} SW`,
        requirement: `≥ ${fmtSigned(t.alphaCrossEnter)} SW`,
        passed: leftCross >= t.alphaCrossEnter,
        score: scoreAtLeast(
          leftCross,
          t.alphaCrossEnter,
          SIMILARITY_SW_MARGIN,
          SIMILARITY_SW_RANGE,
        ),
      }),
      makeCondition({
        id: 'alpha-right-cross',
        name: 'R wrist crossing',
        joint: 'Right wrist',
        hint: 'Cross your right wrist past the midline.',
        value: rightCross,
        valueLabel: `${fmtSigned(rightCross)} SW`,
        requirement: `≥ ${fmtSigned(t.alphaCrossEnter)} SW`,
        passed: rightCross >= t.alphaCrossEnter,
        score: scoreAtLeast(
          rightCross,
          t.alphaCrossEnter,
          SIMILARITY_SW_MARGIN,
          SIMILARITY_SW_RANGE,
        ),
      }),
      bandCondition({
        id: 'alpha-left-band',
        name: 'L wrist height',
        joint: 'Left wrist',
        value: features.left.wrist.y,
        enterMin: bandEnterMin,
        enterMax: bandEnterMax,
      }),
      bandCondition({
        id: 'alpha-right-band',
        name: 'R wrist height',
        joint: 'Right wrist',
        value: features.right.wrist.y,
        enterMin: bandEnterMin,
        enterMax: bandEnterMax,
      }),
      makeCondition({
        id: 'alpha-left-bent',
        name: 'L elbow bend',
        joint: 'Left elbow',
        hint: 'Bend your left elbow more.',
        value: features.left.elbowAngle,
        valueLabel: deg(features.left.elbowAngle),
        requirement: leDeg(t.elbowBentEnter),
        passed: features.left.elbowAngle <= t.elbowBentEnter,
        score: scoreAtMost(
          features.left.elbowAngle,
          t.elbowBentEnter,
          SIMILARITY_ANGLE_MARGIN,
          SIMILARITY_ANGLE_RANGE,
        ),
      }),
      makeCondition({
        id: 'alpha-right-bent',
        name: 'R elbow bend',
        joint: 'Right elbow',
        hint: 'Bend your right elbow more.',
        value: features.right.elbowAngle,
        valueLabel: deg(features.right.elbowAngle),
        requirement: leDeg(t.elbowBentEnter),
        passed: features.right.elbowAngle <= t.elbowBentEnter,
        score: scoreAtMost(
          features.right.elbowAngle,
          t.elbowBentEnter,
          SIMILARITY_ANGLE_MARGIN,
          SIMILARITY_ANGLE_RANGE,
        ),
      }),
    ];
  }

  if (pose === 'BETA') {
    return [
      ...betaConditions(features, 'left', 'L', 'Left', t),
      ...betaConditions(features, 'right', 'R', 'Right', t),
    ];
  }

  if (pose === 'GAMMA') {
    const leftUp = gammaConditions(
      features,
      'left',
      'right',
      'Left',
      'Right',
      t,
    );
    const rightUp = gammaConditions(
      features,
      'right',
      'left',
      'Right',
      'Left',
      t,
    );
    return averageScore(leftUp) >= averageScore(rightUp) ? leftUp : rightUp;
  }

  const gap = wristGap(features);
  const leftMidline = Math.abs(features.left.wrist.x);
  const rightMidline = Math.abs(features.right.wrist.x);
  const leftOwn = ownSideAmount(features.left.wrist.x, features.leftSideSign);
  const rightOwn = ownSideAmount(features.right.wrist.x, features.rightSideSign);
  const bandEnterMin = features.left.shoulder.y + t.deltaBandInset;
  const bandEnterMax = features.hipRefY - t.deltaBandInset;

  return [
    makeCondition({
      id: 'delta-distance',
      name: 'Wrist gap',
      joint: 'Both wrists',
      hint: 'Bring your wrists closer together.',
      value: gap,
      valueLabel: sw(gap),
      requirement: leSw(t.deltaWristDistanceEnter),
      passed: gap <= t.deltaWristDistanceEnter,
      score: scoreAtMost(
        gap,
        t.deltaWristDistanceEnter,
        SIMILARITY_SW_MARGIN,
        SIMILARITY_SW_RANGE,
      ),
    }),
    makeCondition({
      id: 'delta-left-midline',
      name: 'L wrist midline',
      joint: 'Left wrist',
      hint: 'Bring your left wrist toward the midline.',
      value: leftMidline,
      valueLabel: sw(leftMidline),
      requirement: leSw(t.deltaWristMidlineEnter),
      passed: leftMidline <= t.deltaWristMidlineEnter,
      score: scoreAtMost(
        leftMidline,
        t.deltaWristMidlineEnter,
        SIMILARITY_SW_MARGIN,
        SIMILARITY_SW_RANGE,
      ),
    }),
    makeCondition({
      id: 'delta-right-midline',
      name: 'R wrist midline',
      joint: 'Right wrist',
      hint: 'Bring your right wrist toward the midline.',
      value: rightMidline,
      valueLabel: sw(rightMidline),
      requirement: leSw(t.deltaWristMidlineEnter),
      passed: rightMidline <= t.deltaWristMidlineEnter,
      score: scoreAtMost(
        rightMidline,
        t.deltaWristMidlineEnter,
        SIMILARITY_SW_MARGIN,
        SIMILARITY_SW_RANGE,
      ),
    }),
    bandCondition({
      id: 'delta-left-band',
      name: 'L wrist band',
      joint: 'Left wrist',
      value: features.left.wrist.y,
      enterMin: bandEnterMin,
      enterMax: bandEnterMax,
    }),
    bandCondition({
      id: 'delta-right-band',
      name: 'R wrist band',
      joint: 'Right wrist',
      value: features.right.wrist.y,
      enterMin: features.right.shoulder.y + t.deltaBandInset,
      enterMax: bandEnterMax,
    }),
    makeCondition({
      id: 'delta-left-own-side',
      name: 'L wrist own side',
      joint: 'Left wrist',
      hint: 'Keep your left wrist from crossing too far past the midline.',
      value: leftOwn,
      valueLabel: `${fmtSigned(leftOwn)} SW`,
      requirement: `≥ ${fmtSigned(t.deltaOwnSideEnter)} SW`,
      passed: leftOwn >= t.deltaOwnSideEnter,
      score: scoreAtLeast(
        leftOwn,
        t.deltaOwnSideEnter,
        SIMILARITY_SW_MARGIN,
        SIMILARITY_SW_RANGE,
      ),
    }),
    makeCondition({
      id: 'delta-right-own-side',
      name: 'R wrist own side',
      joint: 'Right wrist',
      hint: 'Keep your right wrist from crossing too far past the midline.',
      value: rightOwn,
      valueLabel: `${fmtSigned(rightOwn)} SW`,
      requirement: `≥ ${fmtSigned(t.deltaOwnSideEnter)} SW`,
      passed: rightOwn >= t.deltaOwnSideEnter,
      score: scoreAtLeast(
        rightOwn,
        t.deltaOwnSideEnter,
        SIMILARITY_SW_MARGIN,
        SIMILARITY_SW_RANGE,
      ),
    }),
  ];
}

interface ConditionInput {
  id: string;
  name: string;
  joint: string;
  hint: string;
  value: number;
  valueLabel: string;
  requirement: string;
  passed: boolean;
  score: number;
}

function makeCondition(input: ConditionInput): PoseConditionInfo {
  const score = clamp(input.score, 0, 1);
  return { ...input, score, distance: 1 - score };
}

function betaConditions(
  features: PoseFeatures,
  side: SideName,
  short: string,
  name: string,
  t: ClassifierThresholds,
): PoseConditionInfo[] {
  const sideFeatures = features[side];
  if (features.reliability[side].wrist) {
    return [
      makeCondition({
        id: `beta-${side}-straight`,
        name: `${short} elbow straight`,
        joint: `${name} elbow`,
        hint: `Straighten your ${name.toLowerCase()} elbow.`,
        value: sideFeatures.elbowAngle,
        valueLabel: deg(sideFeatures.elbowAngle),
        requirement: geDeg(t.elbowStraightEnter),
        passed: sideFeatures.elbowAngle >= t.elbowStraightEnter,
        score: scoreAtLeast(
          sideFeatures.elbowAngle,
          t.elbowStraightEnter,
          SIMILARITY_ANGLE_MARGIN,
          SIMILARITY_ANGLE_RANGE,
        ),
      }),
      shoulderHeightCondition({
        id: `beta-${side}-height`,
        name: `${short} wrist height`,
        joint: `${name} wrist`,
        value: sideFeatures.wrist.y - sideFeatures.shoulder.y,
        verticalEnter: t.betaWristVerticalEnter,
      }),
      makeCondition({
        id: `beta-${side}-reach`,
        name: `${short} wrist reach`,
        joint: `${name} wrist`,
        hint: `Reach your ${name.toLowerCase()} arm further out.`,
        value: Math.abs(sideFeatures.wrist.x - sideFeatures.shoulder.x),
        valueLabel: sw(
          Math.abs(sideFeatures.wrist.x - sideFeatures.shoulder.x),
        ),
        requirement: geSw(t.betaWristHorizontalEnter),
        passed:
          Math.abs(sideFeatures.wrist.x - sideFeatures.shoulder.x) >=
          t.betaWristHorizontalEnter,
        score: scoreAtLeast(
          Math.abs(sideFeatures.wrist.x - sideFeatures.shoulder.x),
          t.betaWristHorizontalEnter,
          SIMILARITY_SW_MARGIN,
          SIMILARITY_SW_RANGE,
        ),
      }),
    ];
  }

  const elbowReliable = features.reliability[side].elbow;
  const { outwardDx, dy, angleDeg } = armDirection(features, side);
  const height = Math.abs(dy);
  return [
    makeCondition({
      id: `beta-${side}-arm-height`,
      name: `${short} arm height (arm direction)`,
      joint: `${name} elbow`,
      hint: `Bring your ${name.toLowerCase()} elbow to shoulder height.`,
      value: height,
      valueLabel: sw(height),
      requirement: leSw(BETA_ARM_HEIGHT_SW),
      passed: elbowReliable && height <= BETA_ARM_HEIGHT_SW,
      score: elbowReliable
        ? scoreAtMost(
            height,
            BETA_ARM_HEIGHT_SW,
            SIMILARITY_SW_MARGIN,
            SIMILARITY_SW_RANGE,
          )
        : 0,
    }),
    makeCondition({
      id: `beta-${side}-arm-reach`,
      name: `${short} arm reach (arm direction)`,
      joint: `${name} elbow`,
      hint: `Reach your ${name.toLowerCase()} elbow further out.`,
      value: outwardDx,
      valueLabel: sw(outwardDx),
      requirement: geSw(BETA_ARM_REACH_SW),
      passed: elbowReliable && outwardDx >= BETA_ARM_REACH_SW,
      score: elbowReliable
        ? scoreAtLeast(
            outwardDx,
            BETA_ARM_REACH_SW,
            SIMILARITY_SW_MARGIN,
            SIMILARITY_SW_RANGE,
          )
        : 0,
    }),
    makeCondition({
      id: `beta-${side}-arm-angle`,
      name: `${short} arm angle (arm direction)`,
      joint: `${name} elbow`,
      hint: `Keep your ${name.toLowerCase()} upper arm horizontal.`,
      value: angleDeg,
      valueLabel: deg(angleDeg),
      requirement: leDeg(BETA_ARM_ANGLE_DEG),
      passed: elbowReliable && angleDeg <= BETA_ARM_ANGLE_DEG,
      score: elbowReliable
        ? scoreAtMost(
            angleDeg,
            BETA_ARM_ANGLE_DEG,
            SIMILARITY_ANGLE_MARGIN,
            SIMILARITY_ANGLE_RANGE,
          )
        : 0,
    }),
  ];
}

function gammaConditions(
  features: PoseFeatures,
  upSide: SideName,
  downSide: SideName,
  upName: string,
  downName: string,
  t: ClassifierThresholds,
): PoseConditionInfo[] {
  const up = features[upSide];
  const down = features[downSide];
  const downBelowHip = down.wrist.y - features.hipRefY;
  const downMidline = Math.abs(down.wrist.x);

  const upConditions: PoseConditionInfo[] =
    features.reliability[upSide].wrist
      ? [
          makeCondition({
            id: `gamma-${upSide}-up`,
            name: `${upName} wrist up`,
            joint: `${upName} wrist`,
            hint: `Raise your ${upName.toLowerCase()} wrist higher.`,
            value: features.nose.y - up.wrist.y,
            valueLabel:
              `nose ${fmtSigned(features.nose.y - up.wrist.y)} / ` +
              `shoulder ${fmtSigned(up.shoulder.y - up.wrist.y)} SW`,
            requirement: `nose ≥ ${fmt(t.gammaUpAboveNoseEnter)} or shoulder ≥ ${fmt(t.gammaUpAboveShoulderEnter)} SW`,
            passed:
              features.nose.y - up.wrist.y >= t.gammaUpAboveNoseEnter ||
              up.shoulder.y - up.wrist.y >= t.gammaUpAboveShoulderEnter,
            score: Math.max(
              scoreAtLeast(
                features.nose.y - up.wrist.y,
                t.gammaUpAboveNoseEnter,
                SIMILARITY_SW_MARGIN,
                SIMILARITY_SW_RANGE,
              ),
              scoreAtLeast(
                up.shoulder.y - up.wrist.y,
                t.gammaUpAboveShoulderEnter,
                SIMILARITY_SW_MARGIN,
                SIMILARITY_SW_RANGE,
              ),
            ),
          }),
          makeCondition({
            id: `gamma-${upSide}-out`,
            name: `${upName} wrist out`,
            joint: `${upName} wrist`,
            hint: `Move your ${upName.toLowerCase()} wrist further from the midline.`,
            value: Math.abs(up.wrist.x),
            valueLabel: sw(Math.abs(up.wrist.x)),
            requirement: geSw(t.gammaUpHorizontalEnter),
            passed: Math.abs(up.wrist.x) >= t.gammaUpHorizontalEnter,
            score: scoreAtLeast(
              Math.abs(up.wrist.x),
              t.gammaUpHorizontalEnter,
              SIMILARITY_SW_MARGIN,
              SIMILARITY_SW_RANGE,
            ),
          }),
        ]
      : gammaArmDirectionConditions(features, upSide, upName);

  return [
    ...upConditions,
    makeCondition({
      id: `gamma-${downSide}-down`,
      name: `${downName} wrist down`,
      joint: `${downName} wrist`,
      hint: `Lower your ${downName.toLowerCase()} wrist toward your hip.`,
      value: downBelowHip,
      valueLabel: `${fmtSigned(downBelowHip)} SW`,
      requirement: `≥ ${sw(t.gammaDownBelowHipEnter)}`,
      passed: downBelowHip >= t.gammaDownBelowHipEnter,
      score: scoreAtLeast(
        downBelowHip,
        t.gammaDownBelowHipEnter,
        SIMILARITY_SW_MARGIN,
        SIMILARITY_SW_RANGE,
      ),
    }),
    makeCondition({
      id: `gamma-${downSide}-midline`,
      name: `${downName} wrist midline`,
      joint: `${downName} wrist`,
      hint: `Bring your ${downName.toLowerCase()} wrist closer to the midline.`,
      value: downMidline,
      valueLabel: sw(downMidline),
      requirement: leSw(t.gammaDownMidlineEnter),
      passed: downMidline <= t.gammaDownMidlineEnter,
      score: scoreAtMost(
        downMidline,
        t.gammaDownMidlineEnter,
        SIMILARITY_SW_MARGIN,
        SIMILARITY_SW_RANGE,
      ),
    }),
  ];
}

function gammaArmDirectionConditions(
  features: PoseFeatures,
  side: SideName,
  name: string,
): PoseConditionInfo[] {
  const elbowReliable = features.reliability[side].elbow;
  const { outwardDx, aboveShoulder } = armDirection(features, side);
  return [
    makeCondition({
      id: `gamma-${side}-arm-up`,
      name: `${name} arm up (arm direction)`,
      joint: `${name} elbow`,
      hint: `Raise your ${name.toLowerCase()} elbow higher.`,
      value: aboveShoulder,
      valueLabel: `${fmtSigned(aboveShoulder)} SW`,
      requirement: `≥ ${sw(GAMMA_ARM_UP_SW)}`,
      passed: elbowReliable && aboveShoulder >= GAMMA_ARM_UP_SW,
      score: elbowReliable
        ? scoreAtLeast(
            aboveShoulder,
            GAMMA_ARM_UP_SW,
            SIMILARITY_SW_MARGIN,
            SIMILARITY_SW_RANGE,
          )
        : 0,
    }),
    makeCondition({
      id: `gamma-${side}-arm-out`,
      name: `${name} arm out (arm direction)`,
      joint: `${name} elbow`,
      hint: `Move your ${name.toLowerCase()} elbow further from the midline.`,
      value: outwardDx,
      valueLabel: sw(outwardDx),
      requirement: `≥ ${sw(GAMMA_ARM_OUT_SW)}`,
      passed: elbowReliable && outwardDx >= GAMMA_ARM_OUT_SW,
      score: elbowReliable
        ? scoreAtLeast(
            outwardDx,
            GAMMA_ARM_OUT_SW,
            SIMILARITY_SW_MARGIN,
            SIMILARITY_SW_RANGE,
          )
        : 0,
    }),
  ];
}

function shoulderHeightCondition(input: {
  id: string;
  name: string;
  joint: string;
  value: number;
  verticalEnter: number;
}): PoseConditionInfo {
  const absolute = Math.abs(input.value);
  const direction = input.value > 0 ? 'Raise' : 'Lower';
  return makeCondition({
    id: input.id,
    name: input.name,
    joint: input.joint,
    hint: `${direction} your ${input.joint.toLowerCase()} to shoulder height.`,
    value: absolute,
    valueLabel: sw(absolute),
    requirement: leSw(input.verticalEnter),
    passed: absolute <= input.verticalEnter,
    score: scoreAtMost(
      absolute,
      input.verticalEnter,
      SIMILARITY_SW_MARGIN,
      SIMILARITY_SW_RANGE,
    ),
  });
}

function bandCondition(input: {
  id: string;
  name: string;
  joint: string;
  value: number;
  enterMin: number;
  enterMax: number;
}): PoseConditionInfo {
  const { value, enterMin, enterMax } = input;
  let hint: string;
  if (value < enterMin) {
    hint = `Raise your ${input.joint.toLowerCase()} into the target band.`;
  } else if (value > enterMax) {
    hint = `Lower your ${input.joint.toLowerCase()} into the target band.`;
  } else {
    hint = `Keep your ${input.joint.toLowerCase()} inside the target band.`;
  }
  return makeCondition({
    id: input.id,
    name: input.name,
    joint: input.joint,
    hint,
    value,
    valueLabel: sw(value),
    requirement: `${fmt(enterMin)}..${fmt(enterMax)} SW`,
    passed: value >= enterMin && value <= enterMax,
    score: scoreInBand(value, enterMin, enterMax, SIMILARITY_BAND_OUTSIDE),
  });
}

function scoreAtLeast(
  value: number,
  gate: number,
  margin: number,
  range: number,
): number {
  if (value >= gate + margin) return 1;
  if (value >= gate) return 0.6 + 0.4 * ((value - gate) / margin);
  if (value >= gate - range) {
    return 0.6 * ((value - (gate - range)) / range);
  }
  return 0;
}

function scoreAtMost(
  value: number,
  gate: number,
  margin: number,
  range: number,
): number {
  if (value <= gate - margin) return 1;
  if (value <= gate) return 0.6 + 0.4 * ((gate - value) / margin);
  if (value <= gate + range) {
    return 0.6 * (((gate + range) - value) / range);
  }
  return 0;
}

function scoreInBand(
  value: number,
  min: number,
  max: number,
  outside: number,
): number {
  const width = max - min;
  if (width <= 0) {
    if (value >= min && value <= max) return 0.6;
    const distance =
      value < min ? min - value : value - max;
    return clamp(0.6 * (1 - distance / outside), 0, 0.6);
  }
  const centralMin = min + width * 0.2;
  const centralMax = max - width * 0.2;
  if (value >= centralMin && value <= centralMax) return 1;
  if (value < centralMin && value >= min) {
    return 0.6 + 0.4 * ((value - min) / (centralMin - min));
  }
  if (value > centralMax && value <= max) {
    return 0.6 + 0.4 * ((max - value) / (max - centralMax));
  }
  if (value < min && value >= min - outside) {
    return 0.6 * (1 - (min - value) / outside);
  }
  if (value > max && value <= max + outside) {
    return 0.6 * (1 - (value - max) / outside);
  }
  return 0;
}

function fmt(value: number): string {
  return value.toFixed(2);
}

function fmtSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function sw(value: number): string {
  return `${fmt(value)} SW`;
}

function deg(value: number): string {
  return `${Math.round(value)}°`;
}

function geSw(value: number): string {
  return `≥ ${sw(value)}`;
}

function leSw(value: number): string {
  return `≤ ${sw(value)}`;
}

function geDeg(value: number): string {
  return `≥ ${deg(value)}`;
}

function leDeg(value: number): string {
  return `≤ ${deg(value)}`;
}

function averageScore(conditions: PoseConditionInfo[]): number {
  if (conditions.length === 0) return 0;
  return (
    conditions.reduce((sum, condition) => sum + condition.score, 0) /
    conditions.length
  );
}

function isReliableLandmark(landmark: NormalizedLandmark | undefined): boolean {
  return Boolean(
    landmark &&
      (landmark.visibility ?? 0) >= VISIBILITY_THRESHOLD &&
      landmark.x >= 0 &&
      landmark.x <= 1 &&
      landmark.y >= 0 &&
      landmark.y <= 1,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface Classification {
  label: PoseLabel;
  recognized: boolean;
  stableForMs: number;
  activePose: PoseId | null;
}

export class PoseClassifier {
  thresholds: ClassifierThresholds = { ...DEFAULT_THRESHOLDS };

  private active: PoseId | null = null;
  private candidate: PoseLabel = 'NO_POSE';
  private candidateSince = 0;
  private recognized = false;

  reset(): void {
    this.active = null;
    this.candidate = 'NO_POSE';
    this.candidateSince = 0;
    this.recognized = false;
  }

  /** Clears stickiness and the recognition timer without changing thresholds. */
  resetStability(): void {
    this.reset();
  }

  update(
    landmarks: NormalizedLandmark[] | null,
    timestampMs: number,
  ): Classification {
    return this.updateWithFeatures(
      landmarks ? extractFeatures(landmarks) : null,
      timestampMs,
    );
  }

  updateWithFeatures(
    features: PoseFeatures | null,
    timestampMs: number,
  ): Classification {
    if (!features) {
      this.reset();
      return {
        label: 'NO_POSE',
        recognized: false,
        stableForMs: 0,
        activePose: null,
      };
    }

    const label = classifyPose(features, this.active, this.thresholds);

    if (label !== this.candidate) {
      this.candidate = label;
      this.candidateSince = timestampMs;
    }

    const stableForMs = Math.max(0, timestampMs - this.candidateSince);
    this.recognized =
      label !== 'NO_POSE' && stableForMs >= STABLE_RECOGNITION_MS;
    this.active = label === 'NO_POSE' ? null : label;

    return {
      label,
      recognized: this.recognized,
      stableForMs,
      activePose: this.active,
    };
  }
}
