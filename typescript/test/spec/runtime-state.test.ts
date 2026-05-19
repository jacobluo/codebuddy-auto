import { describe, expect, it } from 'vitest';

import { orchestratorRuntimeStateSchema } from '../../src/spec/index.js';
import { createRuntimeState } from '../../src/scheduler/index.js';

describe('orchestratorRuntimeStateSchema', () => {
  it('accepts a minimal runtime state snapshot', () => {
    const parsed = orchestratorRuntimeStateSchema.parse({
      running: {},
      claimed: new Set(['abc']),
      retryAttempts: {},
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
      attempt: 2,
      dueAtMs: 5000,
      error: 'turn_failed',
    };

    const parsed = orchestratorRuntimeStateSchema.parse(state);

    expect(parsed.completed.has('done-1')).toBe(true);
    expect(parsed.retryAttempts['retry-1']).toEqual({
      issueId: 'retry-1',
      identifier: '#1',
      attempt: 2,
      dueAtMs: 5000,
      error: 'turn_failed',
    });
  });
});
