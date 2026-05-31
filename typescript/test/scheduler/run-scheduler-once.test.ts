import { describe, expect, it } from 'vitest';

import { createRuntimeState, runSchedulerOnce } from '../../src/scheduler/index.js';
import type { Issue, ServiceConfig } from '../../src/spec/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';
import type { Tracker } from '../../src/tracker/index.js';

function makeIssue(overrides: Partial<Issue>): Issue {
  return {
    id: '1',
    identifier: '#1',
    title: 'Issue',
    description: null,
    priority: null,
    state: 'open',
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

class StubTracker implements Tracker {
  constructor(
    private readonly candidates: Issue[],
    private readonly snapshots: Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>,
  ) {}

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.candidates;
  }

  async fetchIssuesByStates(): Promise<Issue[]> {
    return [];
  }

  async fetchIssueStatesByIds(): Promise<Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>> {
    return this.snapshots;
  }
}

function makeConfig(): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    tracker: {
      ...DEFAULT_SERVICE_CONFIG.tracker,
      apiKey: 'token',
      kind: 'local',
    },
  };
}

/**
 * SSH-mode config — continuation cycle is only invoked when
 * `worker.kind === 'ssh'`. Tests asserting continuation behaviour use this.
 */
function makeSshConfig(): ServiceConfig {
  const base = makeConfig();
  return {
    ...base,
    worker: {
      ...base.worker,
      kind: 'ssh',
      sshHost: 'remote.example',
    },
  };
}

function makeRuntimeMetrics() {
  return {
    secondsRunning: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      creditCost: 0,
    },
    lastReportedTotals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  };
}

describe('runSchedulerOnce', () => {
  it('reconciles running issues before dispatching new work', async () => {
    const state = createRuntimeState();
    state.running['done-1'] = {
      issue: makeIssue({ id: 'done-1', identifier: '#done-1' }),
      workspacePath: '/tmp/done-1',
      sessionId: 'done-1-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('done-1');

    const tracker = new StubTracker(
      [makeIssue({ id: 'fresh-1', identifier: '#fresh-1' })],
      new Map([
        ['done-1', { id: 'done-1', state: 'closed', labels: ['done'] }],
      ]),
    );

    const result = await runSchedulerOnce(state, tracker, makeConfig(), {
      runDispatchCycle: async () => ({
        availableSlots: 10,
        dispatchableIssueIds: ['fresh-1'],
        claimedIssueIds: ['fresh-1'],
      }),
      removeWorkspace: async () => ({ workspacePath: '/tmp/done-1', removed: true }),
    });

    expect(result.releasedIssueIds).toEqual(['done-1']);
    expect(result.cleanedWorkspaceIssueIds).toEqual(['done-1']);
    expect(result.continuedIssueIds).toEqual([]);
    expect(result.dispatch.dispatchableIssueIds).toEqual(['fresh-1']);
    expect(state.completed.has('done-1')).toBe(true);
  });

  it('skips reconciliation lookup when nothing is running', async () => {
    const tracker = new StubTracker([], new Map());
    const state = createRuntimeState();

    const result = await runSchedulerOnce(state, tracker, makeConfig(), {
      runDispatchCycle: async () => ({
        availableSlots: 10,
        dispatchableIssueIds: [],
        claimedIssueIds: [],
      }),
    });

    expect(result.releasedIssueIds).toEqual([]);
    expect(result.cleanedWorkspaceIssueIds).toEqual([]);
    expect(result.continuedIssueIds).toEqual([]);
    expect(result.dispatch.dispatchableIssueIds).toEqual([]);
  });

  it('continues dispatch when reconciliation lookup fails', async () => {
    const state = createRuntimeState();
    state.running['stuck-1'] = {
      issue: makeIssue({ id: 'stuck-1', identifier: '#stuck-1' }),
      workspacePath: '/tmp/stuck-1',
      sessionId: 'stuck-1-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('stuck-1');

    const tracker: Tracker = {
      async fetchCandidateIssues() {
        return [makeIssue({ id: 'fresh-2', identifier: '#fresh-2' })];
      },
      async fetchIssuesByStates() {
        return [];
      },
      async fetchIssueStatesByIds() {
        throw new Error('tracker refresh failed');
      },
    };

    const result = await runSchedulerOnce(state, tracker, makeConfig(), {
      runDispatchCycle: async () => ({
        availableSlots: 10,
        dispatchableIssueIds: ['fresh-2'],
        claimedIssueIds: ['fresh-2', 'stuck-1'],
      }),
    });

    expect(result.releasedIssueIds).toEqual([]);
    expect(result.cleanedWorkspaceIssueIds).toEqual([]);
    expect(result.continuedIssueIds).toEqual([]);
    expect(result.dispatch.dispatchableIssueIds).toEqual(['fresh-2']);
    expect(state.running['stuck-1']).toBeDefined();
  });


  it('continues continuation retries when workspace cleanup fails during reconciliation', async () => {
    const state = createRuntimeState();
    state.running['done-2'] = {
      issue: makeIssue({ id: 'done-2', identifier: '#done-2', state: 'open' }),
      workspacePath: '/tmp/done-2',
      sessionId: 'done-2-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('done-2');
    state.running['cont-2'] = {
      issue: makeIssue({ id: 'cont-2', identifier: '#cont-2', state: 'open' }),
      workspacePath: '/tmp/cont-2',
      sessionId: 'cont-2-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('cont-2');
    state.retryAttempts['cont-2'] = {
      issueId: 'cont-2',
      identifier: '#cont-2',
      mode: 'continuation',
      attempt: 1,
      dueAtMs: Date.now() - 1,
      error: 'turn_completed',
    };

    const tracker = new StubTracker(
      [],
      new Map([
        ['done-2', { id: 'done-2', state: 'closed', labels: ['done'] }],
        ['cont-2', { id: 'cont-2', state: 'open', labels: [] }],
      ]),
    );

    const result = await runSchedulerOnce(state, tracker, makeSshConfig(), {
      removeWorkspace: async () => {
        throw new Error('cleanup failed');
      },
      runContinuationCycle: async () => ({
        continuedIssueIds: ['cont-2'],
        releasedIssueIds: [],
      }),
      runDispatchCycle: async () => ({
        availableSlots: 9,
        dispatchableIssueIds: [],
        claimedIssueIds: ['cont-2'],
      }),
    });

    expect(result.releasedIssueIds).toEqual(['done-2']);
    expect(result.cleanedWorkspaceIssueIds).toEqual([]);
    expect(result.reconciliationError).toBe('cleanup failed');
    expect(result.continuedIssueIds).toEqual(['cont-2']);
    expect(result.dispatch.dispatchableIssueIds).toEqual([]);
    expect(state.completed.has('done-2')).toBe(true);
    expect(state.running['cont-2']).toBeDefined();
  });

  it('continues cleaning later released workspaces after an earlier cleanup failure', async () => {
    const state = createRuntimeState();
    state.running['done-3a'] = {
      issue: makeIssue({ id: 'done-3a', identifier: '#done-3a', state: 'open' }),
      workspacePath: '/tmp/done-3a',
      sessionId: 'done-3a-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.running['done-3b'] = {
      issue: makeIssue({ id: 'done-3b', identifier: '#done-3b', state: 'open' }),
      workspacePath: '/tmp/done-3b',
      sessionId: 'done-3b-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('done-3a');
    state.claimed.add('done-3b');

    const tracker = new StubTracker(
      [],
      new Map([
        ['done-3a', { id: 'done-3a', state: 'closed', labels: ['done'] }],
        ['done-3b', { id: 'done-3b', state: 'closed', labels: ['done'] }],
      ]),
    );

    const removedIdentifiers: string[] = [];
    const result = await runSchedulerOnce(state, tracker, makeConfig(), {
      removeWorkspace: async (_root, identifier) => {
        removedIdentifiers.push(identifier);
        if (identifier === '#done-3a') {
          throw new Error('cleanup failed');
        }

        return { workspacePath: `/tmp/${identifier.slice(1)}`, removed: true };
      },
      runDispatchCycle: async () => ({
        availableSlots: 10,
        dispatchableIssueIds: [],
        claimedIssueIds: [],
      }),
    });

    expect(removedIdentifiers).toEqual(['#done-3a', '#done-3b']);
    expect(result.releasedIssueIds).toEqual(['done-3a', 'done-3b']);
    expect(result.cleanedWorkspaceIssueIds).toEqual(['done-3b']);
    expect(result.reconciliationError).toBe('cleanup failed');
    expect(state.completed.has('done-3a')).toBe(true);
    expect(state.completed.has('done-3b')).toBe(true);
  });

  it('releases retry entries whose due time has passed so they can be dispatched again', async () => {
    const state = createRuntimeState();
    state.claimed.add('retry-1');
    state.retryAttempts['retry-1'] = {
      issueId: 'retry-1',
      identifier: '#retry-1',
      mode: 'failure',
      attempt: 1,
      dueAtMs: Date.now() - 1,
      error: 'turn_failed',
    };

    const tracker = new StubTracker(
      [makeIssue({ id: 'retry-1', identifier: '#retry-1' })],
      new Map(),
    );

    const result = await runSchedulerOnce(state, tracker, makeConfig(), {
      runDispatchCycle: async () => ({
        availableSlots: 10,
        dispatchableIssueIds: ['retry-1'],
        claimedIssueIds: ['retry-1'],
      }),
    });

    expect(result.cleanedWorkspaceIssueIds).toEqual([]);
    expect(result.continuedIssueIds).toEqual([]);
    expect(result.dispatch.dispatchableIssueIds).toEqual(['retry-1']);
    expect(state.retryAttempts['retry-1']).toBeUndefined();
    expect(state.claimed.has('retry-1')).toBe(false);
  });

  it('keeps retry-pending issues claimed until their due time arrives', async () => {
    const state = createRuntimeState();
    state.claimed.add('retry-2');
    state.retryAttempts['retry-2'] = {
      issueId: 'retry-2',
      identifier: '#retry-2',
      mode: 'failure',
      attempt: 1,
      dueAtMs: Date.now() + 60_000,
      error: 'turn_failed',
    };

    const tracker = new StubTracker(
      [makeIssue({ id: 'retry-2', identifier: '#retry-2' })],
      new Map(),
    );

    const result = await runSchedulerOnce(state, tracker, makeConfig(), {
      runDispatchCycle: async () => ({
        availableSlots: 10,
        dispatchableIssueIds: [],
        claimedIssueIds: ['retry-2'],
      }),
    });

    expect(result.cleanedWorkspaceIssueIds).toEqual([]);
    expect(result.continuedIssueIds).toEqual([]);
    expect(result.dispatch.dispatchableIssueIds).toEqual([]);
    expect(state.retryAttempts['retry-2']).toBeDefined();
    expect(state.claimed.has('retry-2')).toBe(true);
  });

  it('drops stale retry claims when the tracker no longer returns that issue', async () => {
    const state = createRuntimeState();
    state.claimed.add('retry-3');
    state.retryAttempts['retry-3'] = {
      issueId: 'retry-3',
      identifier: '#retry-3',
      mode: 'failure',
      attempt: 1,
      dueAtMs: Date.now() - 1,
      error: 'turn_failed',
    };

    const tracker = new StubTracker([], new Map());

    const result = await runSchedulerOnce(state, tracker, makeConfig(), {
      runDispatchCycle: async () => ({
        availableSlots: 10,
        dispatchableIssueIds: [],
        claimedIssueIds: [],
      }),
    });

    expect(result.cleanedWorkspaceIssueIds).toEqual([]);
    expect(result.continuedIssueIds).toEqual([]);
    expect(result.dispatch.dispatchableIssueIds).toEqual([]);
    expect(state.retryAttempts['retry-3']).toBeUndefined();
    expect(state.claimed.has('retry-3')).toBe(false);
  });

  it('surfaces dispatch errors after retry release has already happened', async () => {
    const state = createRuntimeState();
    state.claimed.add('retry-4');
    state.retryAttempts['retry-4'] = {
      issueId: 'retry-4',
      identifier: '#retry-4',
      mode: 'failure',
      attempt: 1,
      dueAtMs: Date.now() - 1,
      error: 'turn_failed',
    };

    const tracker = new StubTracker([], new Map());

    await expect(
      runSchedulerOnce(state, tracker, makeConfig(), {
        runDispatchCycle: async () => {
          throw new Error('dispatch failed');
        },
      }),
    ).rejects.toThrow('dispatch failed');

    expect(state.retryAttempts['retry-4']).toBeUndefined();
    expect(state.claimed.has('retry-4')).toBe(false);
  });

  it('runs continuation retries for active running issues before fresh dispatch', async () => {
    const state = createRuntimeState();
    state.running['cont-1'] = {
      issue: makeIssue({ id: 'cont-1', identifier: '#cont-1' }),
      workspacePath: '/tmp/cont-1',
      sessionId: 'session-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('cont-1');
    state.retryAttempts['cont-1'] = {
      issueId: 'cont-1',
      identifier: '#cont-1',
      mode: 'continuation',
      attempt: 1,
      dueAtMs: Date.now() - 1,
      error: 'turn_completed',
    };

    const tracker = new StubTracker([], new Map([
      ['cont-1', { id: 'cont-1', state: 'open', labels: [] }],
    ]));

    const runContinuationCycle = async () => ({
      continuedIssueIds: ['cont-1'],
      releasedIssueIds: [],
    });

    const result = await runSchedulerOnce(state, tracker, makeSshConfig(), {
      runContinuationCycle,
      runDispatchCycle: async () => ({
        availableSlots: 9,
        dispatchableIssueIds: [],
        claimedIssueIds: ['cont-1'],
      }),
    });

    expect(result.releasedIssueIds).toEqual([]);
    expect(result.cleanedWorkspaceIssueIds).toEqual([]);
    expect(result.continuedIssueIds).toEqual(['cont-1']);
    expect(result.dispatch.claimedIssueIds).toEqual(['cont-1']);
  });
});
