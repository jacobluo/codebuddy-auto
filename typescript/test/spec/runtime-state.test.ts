import { describe, expect, it } from 'vitest';

import { orchestratorRuntimeStateSchema } from '../../src/spec/index.js';
import { createRuntimeState } from '../../src/scheduler/index.js';

describe('orchestratorRuntimeStateSchema', () => {
  it('accepts a minimal runtime state snapshot', () => {
    const parsed = orchestratorRuntimeStateSchema.parse({
      running: {},
      claimed: new Set(['abc']),
      retryAttempts: {},
      runners: {},
      completed: new Set(),
    });

    expect(parsed.claimed.has('abc')).toBe(true);
  });

  it('tracks completed issues and retry attempts in the runtime state factory shape', () => {
    const state = createRuntimeState();

    state.completed.add('done-1');
    state.retryAttempts['retry-1'] = {
      issueId: 'retry-1',
      identifier: '#1',
      mode: 'failure',
      attempt: 2,
      dueAtMs: 5000,
      error: 'turn_failed',
    };

    const parsed = orchestratorRuntimeStateSchema.parse(state);

    expect(parsed.completed.has('done-1')).toBe(true);
    expect(parsed.retryAttempts['retry-1']).toEqual({
      issueId: 'retry-1',
      identifier: '#1',
      mode: 'failure',
      attempt: 2,
      dueAtMs: 5000,
      error: 'turn_failed',
    });
  });

  it('tracks progress metadata and stuck entries in the runtime state factory shape', () => {
    const state = createRuntimeState();

    state.progress['issue-1'] = {
      issueId: 'issue-1',
      identifier: '#1',
      fingerprint: 'fingerprint-1',
      repeatedCount: 2,
      latest: {
        issueId: 'issue-1',
        identifier: '#1',
        headCommit: null,
        statusShort: [],
        untrackedFiles: [],
        trackerState: 'open',
        trackerLabels: ['agent-ready'],
        lastEvent: 'turn_completed',
        fingerprint: 'fingerprint-1',
      },
      stuck: {
        reason: 'no_progress',
        repeatedCount: 2,
        fingerprint: 'fingerprint-1',
      },
    };
    state.stuck['issue-1'] = {
      reason: 'no_progress',
      repeatedCount: 2,
      fingerprint: 'fingerprint-1',
    };

    const parsed = orchestratorRuntimeStateSchema.parse(state);

    expect(parsed.progress['issue-1']?.repeatedCount).toBe(2);
    expect(parsed.stuck['issue-1']?.reason).toBe('no_progress');
  });
});
