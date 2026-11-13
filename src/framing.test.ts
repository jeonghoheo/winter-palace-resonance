import { describe, expect, it } from 'vitest';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { detectFramingWarning } from './framing';

function makeLandmarks(): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from(
    { length: 33 },
    () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }),
  );
  const set = (
    index: number,
    x: number,
    y: number,
    visibility = 1,
  ): void => {
    landmarks[index] = { x, y, z: 0, visibility };
  };
  set(0, 0.5, 0.3);
  set(11, 0.6, 0.4);
  set(12, 0.4, 0.4);
  set(15, 0.7, 0.55);
  set(16, 0.3, 0.55);
  return landmarks;
}

describe('detectFramingWarning', () => {
  it('returns null when both wrists are comfortably in frame', () => {
    expect(detectFramingWarning(makeLandmarks())).toBeNull();
  });

  it('names the anatomical left hand when it is near the raw right edge', () => {
    const landmarks = makeLandmarks();
    landmarks[15] = { ...landmarks[15], x: 0.97 };
    expect(detectFramingWarning(landmarks)).toBe(
      'Your left hand is out of frame — step back.',
    );
  });

  it('names the anatomical right hand when it is near the top edge', () => {
    const landmarks = makeLandmarks();
    landmarks[16] = { ...landmarks[16], y: 0.02 };
    expect(detectFramingWarning(landmarks)).toBe(
      'Your right hand is out of frame — step back.',
    );
  });

  it('reports both hands when both are out', () => {
    const landmarks = makeLandmarks();
    landmarks[15] = { ...landmarks[15], visibility: 0.2 };
    landmarks[16] = { ...landmarks[16], x: 0.99 };
    expect(detectFramingWarning(landmarks)).toBe(
      'Both hands are out of frame — step back.',
    );
  });

  it('does not warn when the upper body itself is not tracked', () => {
    const landmarks = makeLandmarks();
    landmarks[0] = { ...landmarks[0], visibility: 0.1 };
    landmarks[15] = { ...landmarks[15], x: 0.99 };
    expect(detectFramingWarning(landmarks)).toBeNull();
    expect(detectFramingWarning(null)).toBeNull();
  });
});
