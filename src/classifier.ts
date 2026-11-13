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

const REQUIRED_LANDMARKS = [0, 11, 12, 13, 14, 15, 16] as const;
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
/** Fallback hip offset below the shoulders when hips are not visible. */
const FALLBACK_HIP_OFFSET_SW = 1.6;

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
  hipY: number;
  left: SideFeatures;
  right: SideFeatures;
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

  betaWristVerticalEnter: number;
  betaWristVerticalExit: number;
  betaWristHorizontalEnter: number;
  betaWristHorizontalExit: number;

  gammaUpAboveNoseEnter: number;
  gammaUpAboveNoseExit: number;
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
  elbowStraightEnter: 160,
  elbowStraightExit: 150,
  elbowBentEnter: 120,
  elbowBentExit: 132,

  alphaCrossEnter: 0.02,
  alphaCrossExit: -0.02,
  alphaBandInset: 0.05,
  alphaBandSlack: 0.1,

  betaWristVerticalEnter: 0.35,
  betaWristVerticalExit: 0.45,
  betaWristHorizontalEnter: 1.1,
  betaWristHorizontalExit: 1.0,

  gammaUpAboveNoseEnter: 0.05,
  gammaUpAboveNoseExit: -0.05,
  gammaUpHorizontalEnter: 0.7,
  gammaUpHorizontalExit: 0.6,
  gammaDownBelowHipEnter: 0.05,
  gammaDownBelowHipExit: -0.05,
  gammaDownMidlineEnter: 0.5,
  gammaDownMidlineExit: 0.6,

  deltaWristDistanceEnter: 0.35,
  deltaWristDistanceExit: 0.45,
  deltaWristMidlineEnter: 0.3,
  deltaWristMidlineExit: 0.4,
  deltaBandInset: 0.05,
  deltaBandSlack: 0.1,
  deltaOwnSideEnter: 0.02,
  deltaOwnSideExit: -0.02,
};

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
 * Extracts the classifier feature vector from raw landmarks. Returns null when
 * the visibility gate fails, so callers can output NO_POSE instead of guessing.
 */
export function extractFeatures(
  landmarks: NormalizedLandmark[],
): PoseFeatures | null {
  if (!landmarks || landmarks.length <= RIGHT_HIP) return null;

  for (const index of REQUIRED_LANDMARKS) {
    const landmark = landmarks[index];
    if (!landmark || (landmark.visibility ?? 0) < VISIBILITY_THRESHOLD) {
      return null;
    }
  }

  const rawLeftShoulder = landmarks[LEFT_SHOULDER];
  const rawRightShoulder = landmarks[RIGHT_SHOULDER];
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

  const leftHipVisible = isVisible(landmarks[LEFT_HIP]);
  const rightHipVisible = isVisible(landmarks[RIGHT_HIP]);
  const hipsVisible = leftHipVisible && rightHipVisible;

  const hipMidY = hipsVisible
    ? (landmarks[LEFT_HIP].y + landmarks[RIGHT_HIP].y) / 2
    : midY + FALLBACK_HIP_OFFSET_SW * shoulderWidth;

  const hipY = (hipMidY - midY) / shoulderWidth;
  const nose = normalize(rawNose);
  const chinY = nose.y + CHIN_OFFSET_SW;
  const midTorsoY = hipY / 2;

  const fallbackHip = (sign: number): Vec2 => ({
    x: sign * 0.5,
    y: hipY,
  });

  return {
    shoulderWidth,
    leftSideSign,
    rightSideSign,
    nose,
    chinY,
    midTorsoY,
    hipY,
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

/** Positive value means the wrist is crossed past the midline to the far side. */
function crossedAmount(wristX: number, sideSign: number): number {
  return -(wristX * sideSign);
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
    const leftCrossed = crossedAmount(
      features.left.wrist.x,
      features.leftSideSign,
    );
    const rightCrossed = crossedAmount(
      features.right.wrist.x,
      features.rightSideSign,
    );
    return (
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
      atLeast(
        features.left.elbowAngle,
        t.elbowStraightEnter,
        t.elbowStraightExit,
        active,
      ) &&
      atLeast(
        features.right.elbowAngle,
        t.elbowStraightEnter,
        t.elbowStraightExit,
        active,
      ) &&
      atMost(
        Math.abs(features.left.wrist.y - features.left.shoulder.y),
        t.betaWristVerticalEnter,
        t.betaWristVerticalExit,
        active,
      ) &&
      atMost(
        Math.abs(features.right.wrist.y - features.right.shoulder.y),
        t.betaWristVerticalEnter,
        t.betaWristVerticalExit,
        active,
      ) &&
      atLeast(
        Math.abs(features.left.wrist.x - features.left.shoulder.x),
        t.betaWristHorizontalEnter,
        t.betaWristHorizontalExit,
        active,
      ) &&
      atLeast(
        Math.abs(features.right.wrist.x - features.right.shoulder.x),
        t.betaWristHorizontalEnter,
        t.betaWristHorizontalExit,
        active,
      )
    );
  }

  if (pose === 'GAMMA') {
    return (
      gammaMatches(features, features.left, features.right, active, t) ||
      gammaMatches(features, features.right, features.left, active, t)
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
      features.hipY - t.deltaBandInset,
      features.left.shoulder.y - t.deltaBandSlack,
      features.hipY + t.deltaBandSlack,
      active,
    ) &&
    inBand(
      features.right.wrist.y,
      features.right.shoulder.y + t.deltaBandInset,
      features.hipY - t.deltaBandInset,
      features.right.shoulder.y - t.deltaBandSlack,
      features.hipY + t.deltaBandSlack,
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

function gammaMatches(
  features: PoseFeatures,
  up: SideFeatures,
  down: SideFeatures,
  active: boolean,
  t: ClassifierThresholds,
): boolean {
  // "Above nose" / "below hip" are expressed as positive amounts in the
  // expected direction so the same atLeast hysteresis helper applies.
  const upAboveNose = features.nose.y - up.wrist.y;
  const downBelowHip = down.wrist.y - features.hipY;
  return (
    atLeast(upAboveNose, t.gammaUpAboveNoseEnter, t.gammaUpAboveNoseExit, active) &&
    atLeast(
      Math.abs(up.wrist.x),
      t.gammaUpHorizontalEnter,
      t.gammaUpHorizontalExit,
      active,
    ) &&
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
  joint: string;
  hint: string;
  /** 0 = comfortable target, 1 = far from it. */
  distance: number;
}

export interface PoseSimilarity {
  score: number;
  worst: PoseConditionInfo;
}

/**
 * Similarity formula: every pose condition is mapped to a 0-1 distance using a
 * comfortable target and a far fallback. The score is
 *   100 * (1 - average(condition distances)).
 * The worst condition is the one with the largest distance and supplies the
 * single-joint hint.
 */
export function poseSimilarity(
  features: PoseFeatures,
  pose: PoseId,
  thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
): PoseSimilarity {
  const conditions = buildConditions(features, pose, thresholds);
  let total = 0;
  let worst = conditions[0];
  for (const condition of conditions) {
    total += condition.distance;
    if (condition.distance > worst.distance) worst = condition;
  }
  const score = Math.round(
    clamp(1 - total / conditions.length, 0, 1) * 100,
  );
  return { score, worst };
}

function buildConditions(
  features: PoseFeatures,
  pose: PoseId,
  t: ClassifierThresholds,
): PoseConditionInfo[] {
  if (pose === 'ALPHA') {
    const bandComfyMin = features.chinY + 0.15;
    const bandComfyMax = features.midTorsoY - 0.05;
    const bandFarMin = features.chinY - 0.25;
    const bandFarMax = features.midTorsoY + 0.3;
    return [
      {
        id: 'alpha-left-cross',
        joint: 'Left wrist',
        hint: 'Cross your left wrist past the midline.',
        distance: softAbove(
          crossedAmount(features.left.wrist.x, features.leftSideSign),
          t.alphaCrossEnter + 0.23,
          t.alphaCrossEnter - 0.22,
        ),
      },
      {
        id: 'alpha-right-cross',
        joint: 'Right wrist',
        hint: 'Cross your right wrist past the midline.',
        distance: softAbove(
          crossedAmount(features.right.wrist.x, features.rightSideSign),
          t.alphaCrossEnter + 0.23,
          t.alphaCrossEnter - 0.22,
        ),
      },
      bandCondition(
        'alpha-left-band',
        'Left wrist',
        features.left.wrist.y,
        bandComfyMin,
        bandComfyMax,
        bandFarMin,
        bandFarMax,
      ),
      bandCondition(
        'alpha-right-band',
        'Right wrist',
        features.right.wrist.y,
        bandComfyMin,
        bandComfyMax,
        bandFarMin,
        bandFarMax,
      ),
      {
        id: 'alpha-left-bent',
        joint: 'Left elbow',
        hint: 'Bend your left elbow more.',
        distance: softBelow(
          features.left.elbowAngle,
          t.elbowBentEnter - 5,
          t.elbowBentEnter + 55,
        ),
      },
      {
        id: 'alpha-right-bent',
        joint: 'Right elbow',
        hint: 'Bend your right elbow more.',
        distance: softBelow(
          features.right.elbowAngle,
          t.elbowBentEnter - 5,
          t.elbowBentEnter + 55,
        ),
      },
    ];
  }

  if (pose === 'BETA') {
    return [
      {
        id: 'beta-left-straight',
        joint: 'Left elbow',
        hint: 'Straighten your left elbow.',
        distance: softAbove(
          features.left.elbowAngle,
          t.elbowStraightEnter + 5,
          t.elbowStraightEnter - 65,
        ),
      },
      {
        id: 'beta-right-straight',
        joint: 'Right elbow',
        hint: 'Straighten your right elbow.',
        distance: softAbove(
          features.right.elbowAngle,
          t.elbowStraightEnter + 5,
          t.elbowStraightEnter - 65,
        ),
      },
      shoulderHeightCondition(
        'beta-left-height',
        'Left wrist',
        features.left.wrist.y - features.left.shoulder.y,
        t.betaWristVerticalEnter,
      ),
      shoulderHeightCondition(
        'beta-right-height',
        'Right wrist',
        features.right.wrist.y - features.right.shoulder.y,
        t.betaWristVerticalEnter,
      ),
      {
        id: 'beta-left-reach',
        joint: 'Left wrist',
        hint: 'Reach your left arm further out.',
        distance: softAbove(
          Math.abs(features.left.wrist.x - features.left.shoulder.x),
          t.betaWristHorizontalEnter + 0.2,
          t.betaWristHorizontalEnter - 0.5,
        ),
      },
      {
        id: 'beta-right-reach',
        joint: 'Right wrist',
        hint: 'Reach your right arm further out.',
        distance: softAbove(
          Math.abs(features.right.wrist.x - features.right.shoulder.x),
          t.betaWristHorizontalEnter + 0.2,
          t.betaWristHorizontalEnter - 0.5,
        ),
      },
    ];
  }

  if (pose === 'GAMMA') {
    const leftUp = gammaConditions(
      features,
      features.left,
      features.right,
      'Left',
      'Right',
      t,
    );
    const rightUp = gammaConditions(
      features,
      features.right,
      features.left,
      'Right',
      'Left',
      t,
    );
    return averageDistance(leftUp) <= averageDistance(rightUp) ? leftUp : rightUp;
  }

  return [
    {
      id: 'delta-distance',
      joint: 'Both wrists',
      hint: 'Bring your wrists closer together.',
      distance: softBelow(
        Math.hypot(
          features.left.wrist.x - features.right.wrist.x,
          features.left.wrist.y - features.right.wrist.y,
        ),
        t.deltaWristDistanceEnter * 0.57,
        t.deltaWristDistanceEnter * 2.29,
      ),
    },
    {
      id: 'delta-left-midline',
      joint: 'Left wrist',
      hint: 'Bring your left wrist toward the midline.',
      distance: softBelow(
        Math.abs(features.left.wrist.x),
        t.deltaWristMidlineEnter * 0.5,
        t.deltaWristMidlineEnter * 2.33,
      ),
    },
    {
      id: 'delta-right-midline',
      joint: 'Right wrist',
      hint: 'Bring your right wrist toward the midline.',
      distance: softBelow(
        Math.abs(features.right.wrist.x),
        t.deltaWristMidlineEnter * 0.5,
        t.deltaWristMidlineEnter * 2.33,
      ),
    },
    bandCondition(
      'delta-left-band',
      'Left wrist',
      features.left.wrist.y,
      features.left.shoulder.y + 0.05,
      features.hipY - 0.15,
      features.left.shoulder.y - 0.3,
      features.hipY + 0.3,
    ),
    bandCondition(
      'delta-right-band',
      'Right wrist',
      features.right.wrist.y,
      features.right.shoulder.y + 0.05,
      features.hipY - 0.15,
      features.right.shoulder.y - 0.3,
      features.hipY + 0.3,
    ),
    {
      id: 'delta-left-own-side',
      joint: 'Left wrist',
      hint: 'Keep your left wrist on its own side of the midline.',
      distance: softAbove(
        ownSideAmount(features.left.wrist.x, features.leftSideSign),
        0.15,
        -0.2,
      ),
    },
    {
      id: 'delta-right-own-side',
      joint: 'Right wrist',
      hint: 'Keep your right wrist on its own side of the midline.',
      distance: softAbove(
        ownSideAmount(features.right.wrist.x, features.rightSideSign),
        0.15,
        -0.2,
      ),
    },
  ];
}

function gammaConditions(
  features: PoseFeatures,
  up: SideFeatures,
  down: SideFeatures,
  upName: string,
  downName: string,
  t: ClassifierThresholds,
): PoseConditionInfo[] {
  return [
    {
      id: `gamma-${upName.toLowerCase()}-up`,
      joint: `${upName} wrist`,
      hint: `Raise your ${upName.toLowerCase()} wrist above your head.`,
      distance: softAbove(features.nose.y - up.wrist.y, 0.35, -0.25),
    },
    {
      id: `gamma-${upName.toLowerCase()}-out`,
      joint: `${upName} wrist`,
      hint: `Move your ${upName.toLowerCase()} wrist further from the midline.`,
      distance: softAbove(
        Math.abs(up.wrist.x),
        t.gammaUpHorizontalEnter + 0.2,
        t.gammaUpHorizontalEnter - 0.4,
      ),
    },
    {
      id: `gamma-${downName.toLowerCase()}-down`,
      joint: `${downName} wrist`,
      hint: `Lower your ${downName.toLowerCase()} wrist toward your hip.`,
      distance: softAbove(down.wrist.y - features.hipY, 0.35, -0.25),
    },
    {
      id: `gamma-${downName.toLowerCase()}-midline`,
      joint: `${downName} wrist`,
      hint: `Bring your ${downName.toLowerCase()} wrist closer to the midline.`,
      distance: softBelow(
        Math.abs(down.wrist.x),
        t.gammaDownMidlineEnter * 0.6,
        t.gammaDownMidlineEnter * 1.8,
      ),
    },
  ];
}

function shoulderHeightCondition(
  id: string,
  joint: string,
  wristOffsetY: number,
  verticalEnter: number,
): PoseConditionInfo {
  const distance = softBelow(
    Math.abs(wristOffsetY),
    verticalEnter * 0.43,
    verticalEnter * 2.29,
  );
  const direction = wristOffsetY > 0 ? 'Raise' : 'Lower';
  return {
    id,
    joint,
    hint: `${direction} your ${joint.toLowerCase()} to shoulder height.`,
    distance,
  };
}

function bandCondition(
  id: string,
  joint: string,
  value: number,
  comfyMin: number,
  comfyMax: number,
  farMin: number,
  farMax: number,
): PoseConditionInfo {
  const distance = softBand(value, comfyMin, comfyMax, farMin, farMax);
  let hint: string;
  if (value < comfyMin) {
    hint = `Raise your ${joint.toLowerCase()} into the target band.`;
  } else if (value > comfyMax) {
    hint = `Lower your ${joint.toLowerCase()} into the target band.`;
  } else {
    hint = `Keep your ${joint.toLowerCase()} inside the target band.`;
  }
  return { id, joint, hint, distance };
}

function softAbove(value: number, comfortable: number, far: number): number {
  if (value >= comfortable) return 0;
  if (comfortable === far) return 1;
  return clamp((comfortable - value) / (comfortable - far), 0, 1);
}

function softBelow(value: number, comfortable: number, far: number): number {
  if (value <= comfortable) return 0;
  if (far === comfortable) return 1;
  return clamp((value - comfortable) / (far - comfortable), 0, 1);
}

function softBand(
  value: number,
  comfyMin: number,
  comfyMax: number,
  farMin: number,
  farMax: number,
): number {
  if (value < comfyMin) {
    return farMin === comfyMin ? 1 : clamp((comfyMin - value) / (comfyMin - farMin), 0, 1);
  }
  if (value > comfyMax) {
    return farMax === comfyMax ? 1 : clamp((value - comfyMax) / (farMax - comfyMax), 0, 1);
  }
  return 0;
}

function averageDistance(conditions: PoseConditionInfo[]): number {
  if (conditions.length === 0) return 0;
  return conditions.reduce((sum, condition) => sum + condition.distance, 0) / conditions.length;
}

function isVisible(landmark: NormalizedLandmark | undefined): boolean {
  return Boolean(landmark && (landmark.visibility ?? 0) >= VISIBILITY_THRESHOLD);
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
