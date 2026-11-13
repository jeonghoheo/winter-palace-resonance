import { describe, expect, it } from 'vitest';
import { RecognitionTest } from './testMode';

describe('RecognitionTest', () => {
  it('builds 20 interleaved trials per pose for ALL', () => {
    const test = new RecognitionTest();
    test.start('ALL', 0);
    const update = test.update('NO_POSE', false, false, 100);
    expect(update.totalTrials).toBe(80);
    expect(update.target).toBe('ALPHA');
  });

  it('records a recognized target and computes a summary', () => {
    const test = new RecognitionTest();
    test.start('ALPHA', 0);
    const update = test.update('ALPHA', true, true, 100);
    expect(update.lastResult?.success).toBe(true);
    expect(update.lastResult?.recognitionMs).toBe(100);

    const summaries = test.getSummaries();
    expect(summaries.ALPHA.trials).toBe(1);
    expect(summaries.ALPHA.successes).toBe(1);
    expect(summaries.ALPHA.successRate).toBe(100);
    expect(summaries.ALPHA.averageRecognitionMs).toBe(100);
    expect(summaries.BETA.trials).toBe(0);
  });

  it('pauses the trial timer while features are missing', () => {
    const test = new RecognitionTest();
    test.start('ALPHA', 0);
    const paused = test.update('NO_POSE', false, false, 1000);
    expect(paused.paused).toBe(true);
    expect(paused.progress).toBe(0);

    const resumed = test.update('ALPHA', false, true, 1100);
    expect(resumed.paused).toBe(false);
    expect(resumed.progress).toBeCloseTo(100 / 3000, 6);
  });

  it('times out after 3s of active trial time', () => {
    const test = new RecognitionTest();
    test.start('ALPHA', 0);
    let update = test.update('ALPHA', false, true, 0);
    for (let tick = 1; tick <= 30; tick += 1) {
      update = test.update('ALPHA', false, true, tick * 100);
    }
    expect(update.state).toBe('between');
    expect(update.lastResult?.success).toBe(false);
    expect(update.lastResult?.recognitionMs).toBeNull();
    expect(test.getSummaries().ALPHA.successes).toBe(0);
  });

  it('starts the next trial after the between-trial delay', () => {
    const test = new RecognitionTest();
    let starts = 0;
    test.onTrialStart = () => {
      starts += 1;
    };
    test.start('ALPHA', 0);
    expect(starts).toBe(1);

    test.update('ALPHA', true, true, 100);
    let update = test.update('ALPHA', true, true, 200);
    for (let tick = 0; tick < 7; tick += 1) {
      update = test.update('NO_POSE', false, true, 300 + tick * 100);
    }
    expect(starts).toBe(2);
    expect(update.trialNumber).toBe(2);
  });
});
