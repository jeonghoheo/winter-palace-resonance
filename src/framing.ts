import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export const FRAMING_EDGE_MARGIN = 0.05;
export const FRAMING_VISIBILITY_THRESHOLD = 0.5;

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

/**
 * Returns a framing warning when the upper body is tracked but a wrist is
 * missing, low-visibility, or within 5% of a frame edge. Sides use anatomical
 * names (MediaPipe left = the player's left); in the mirrored preview that
 * hand appears on the player's left side, so the message reads correctly.
 */
export function detectFramingWarning(
  landmarks: NormalizedLandmark[] | null,
): string | null {
  if (!landmarks || landmarks.length <= RIGHT_WRIST) return null;

  const upperBodyTracked =
    isVisible(landmarks[NOSE]) &&
    isVisible(landmarks[LEFT_SHOULDER]) &&
    isVisible(landmarks[RIGHT_SHOULDER]);
  if (!upperBodyTracked) return null;

  const leftOut = isWristOut(landmarks[LEFT_WRIST]);
  const rightOut = isWristOut(landmarks[RIGHT_WRIST]);

  if (leftOut && rightOut) {
    return 'Both hands are out of frame — step back.';
  }
  if (leftOut) {
    return 'Your left hand is out of frame — step back.';
  }
  if (rightOut) {
    return 'Your right hand is out of frame — step back.';
  }
  return null;
}

function isWristOut(landmark: NormalizedLandmark | undefined): boolean {
  if (!landmark) return true;
  if ((landmark.visibility ?? 0) < FRAMING_VISIBILITY_THRESHOLD) return true;
  return (
    landmark.x <= FRAMING_EDGE_MARGIN ||
    landmark.x >= 1 - FRAMING_EDGE_MARGIN ||
    landmark.y <= FRAMING_EDGE_MARGIN ||
    landmark.y >= 1 - FRAMING_EDGE_MARGIN
  );
}

function isVisible(landmark: NormalizedLandmark | undefined): boolean {
  return Boolean(
    landmark &&
      (landmark.visibility ?? 0) >= FRAMING_VISIBILITY_THRESHOLD,
  );
}
