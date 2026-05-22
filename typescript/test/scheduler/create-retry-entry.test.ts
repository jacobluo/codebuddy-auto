import { describe, expect, it } from 'vitest';

import { createRetryEntry } from '../../src/scheduler/index.js';

describe('createRetryEntry', () => {
  it('uses a fixed delay for normal continuation retries', () => {
    expect(
      createRetryEntry({
        issueId: '1',
        identifier: '#1',
        previousAttempt: 0,
        reason: 'turn_completed',
        nowMs: 100,
        maxRetryBackoffMs: 300_000,
      }),
    ).toEqual({
      issueId: '1',
      identifier: '#1',
      mode: 'continuation',
      attempt: 1,
      dueAtMs: 1_100,
      error: 'turn_completed',
    });
  });

  it('uses exponential backoff for failure retries', () => {
    expect(
      createRetryEntry({
        issueId: '2',
        identifier: '#2',
        previousAttempt: 2,
        reason: 'turn_failed',
        nowMs: 500,
        maxRetryBackoffMs: 300_000,
      }),
    ).toEqual({
      issueId: '2',
      identifier: '#2',
      mode: 'failure',
      attempt: 3,
      dueAtMs: 40_500,
      error: 'turn_failed',
    });
  });

  it('caps failure backoff at the configured maximum', () => {
    expect(
      createRetryEntry({
        issueId: '3',
        identifier: '#3',
        previousAttempt: 10,
        reason: 'turn_timed_out',
        nowMs: 0,
        maxRetryBackoffMs: 30_000,
      }),
    ).toEqual({
      issueId: '3',
      identifier: '#3',
      mode: 'failure',
      attempt: 11,
      dueAtMs: 30_000,
      error: 'turn_timed_out',
    });
  });
});
