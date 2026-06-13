import { describe, expect, it } from 'vitest';

import { reconcileRuntimeState } from '../../src/scheduler/index.js';
import type { Issue, OrchestratorRuntimeState } from '../../src/spec/index.js';

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

function createState(): OrchestratorRuntimeState {
  return {
    running: {},
    claimed: new Set(),
    retryAttempts: {},
    runners: {},
    completed: new Set(),
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

describe('reconcileRuntimeState', () => {
  it('releases running issues that moved into a terminal state and marks them for cleanup', () => {
    const state = createState();
    state.running['1'] = {
      issue: makeIssue({ id: '1', identifier: '#1' }),
      workspacePath: '/tmp/1',
      sessionId: '1-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('1');

    const result = reconcileRuntimeState(state, new Map([
      ['1', { id: '1', state: 'closed', labels: ['done'] }],
    ]), ['closed']);

    expect(result.releasedIssueIds).toEqual(['1']);
    expect(result.releasedIssues).toEqual([
      {
        issueId: '1',
        identifier: '#1',
        workspacePath: '/tmp/1',
        cleanupWorkspace: true,
      },
    ]);
    expect(state.running['1']).toBeUndefined();
    expect(state.claimed.has('1')).toBe(false);
    expect(state.completed.has('1')).toBe(true);
  });

  it('keeps active running issues claimed', () => {
    const state = createState();
    state.running['2'] = {
      issue: makeIssue({ id: '2', identifier: '#2' }),
      workspacePath: '/tmp/2',
      sessionId: '2-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('2');

    const result = reconcileRuntimeState(state, new Map([
      ['2', { id: '2', state: 'open', labels: [] }],
    ]), ['closed']);

    expect(result.releasedIssueIds).toEqual([]);
    expect(result.releasedIssues).toEqual([]);
    expect(state.running['2']).toBeDefined();
    expect(state.claimed.has('2')).toBe(true);
  });

  it('releases active running issues that have the finish label', () => {
    const state = createState();
    state.running['finish-1'] = {
      issue: makeIssue({ id: 'finish-1', identifier: '#finish-1' }),
      workspacePath: '/tmp/finish-1',
      sessionId: 'finish-1-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('finish-1');

    const result = reconcileRuntimeState(state, new Map([
      ['finish-1', { id: 'finish-1', state: 'open', labels: ['agent-finish'] }],
    ]), ['closed'], undefined, undefined, 'agent-finish');

    expect(result.releasedIssueIds).toEqual(['finish-1']);
    expect(result.releasedIssues).toEqual([
      {
        issueId: 'finish-1',
        identifier: '#finish-1',
        workspacePath: '/tmp/finish-1',
        cleanupWorkspace: false,
      },
    ]);
    expect(state.running['finish-1']).toBeUndefined();
    expect(state.claimed.has('finish-1')).toBe(false);
    expect(state.completed.has('finish-1')).toBe(true);
  });

  it('releases running issues missing from the latest tracker snapshot without cleanup', () => {
    const state = createState();
    state.running['3'] = {
      issue: makeIssue({ id: '3', identifier: '#3' }),
      workspacePath: '/tmp/3',
      sessionId: '3-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('3');

    const result = reconcileRuntimeState(state, new Map(), ['closed']);

    expect(result.releasedIssueIds).toEqual(['3']);
    expect(result.releasedIssues).toEqual([
      {
        issueId: '3',
        identifier: '#3',
        workspacePath: '/tmp/3',
        cleanupWorkspace: false,
      },
    ]);
    expect(state.running['3']).toBeUndefined();
    expect(state.claimed.has('3')).toBe(false);
    expect(state.completed.has('3')).toBe(true);
  });

  it('clears retry bookkeeping when a running issue is released', () => {
    const state = createState();
    state.running['4'] = {
      issue: makeIssue({ id: '4', identifier: '#4' }),
      workspacePath: '/tmp/4',
      sessionId: '4-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('4');
    state.retryAttempts['4'] = {
      issueId: '4',
      identifier: '#4',
      mode: 'failure',
      attempt: 2,
      dueAtMs: 1234,
      error: 'turn_failed',
    };

    reconcileRuntimeState(state, new Map([
      ['4', { id: '4', state: 'closed', labels: ['done'] }],
    ]), ['closed']);

    expect(state.retryAttempts['4']).toBeUndefined();
  });
});

describe('reconcileRuntimeState — local worker graceful exit (§5.3)', () => {
  it('sets gracefulExitRequested instead of deleting running when a WorkerHandle is registered', async () => {
    const { createWorkerHandleStore } = await import('../../src/worker/index.js');
    const state = createState();
    state.running['cont-1'] = {
      issue: makeIssue({ id: 'cont-1', identifier: '#cont-1', state: 'open' }),
      workspacePath: '/tmp/ws',
      sessionId: 's1',
      startedAt: '2026-05-31T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-31T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('cont-1');
    state.runners['cont-1'] = {
      issueId: 'cont-1',
      sessionId: 's1',
      startedAt: '2026-05-31T00:00:00Z',
      turnCount: 1,
      gracefulExitRequested: false,
    };

    const handleStore = createWorkerHandleStore();
    handleStore.register('cont-1', state.runners['cont-1']);

    const result = reconcileRuntimeState(
      state,
      new Map([['cont-1', { id: 'cont-1', state: 'closed', labels: [] }]]),
      ['closed'],
      undefined,
      handleStore,
    );

    // Worker is still alive; reconcile cooperatively asks it to exit and
    // does NOT delete the running entry.
    expect(result.gracefulExitRequestedIssueIds).toEqual(['cont-1']);
    expect(result.releasedIssueIds).toEqual([]);
    expect(state.running['cont-1']).toBeDefined();
    expect(handleStore.get('cont-1')?.gracefulExitRequested).toBe(true);
  });

  it('still deletes running when no WorkerHandle is registered (SSH / legacy path)', () => {
    const state = createState();
    state.running['ssh-1'] = {
      issue: makeIssue({ id: 'ssh-1', identifier: '#ssh-1', state: 'open' }),
      workspacePath: '/tmp/ws',
      sessionId: 's1',
      startedAt: '2026-05-31T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-31T00:00:01Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add('ssh-1');

    const result = reconcileRuntimeState(
      state,
      new Map([['ssh-1', { id: 'ssh-1', state: 'closed', labels: [] }]]),
      ['closed'],
    );

    expect(result.releasedIssueIds).toEqual(['ssh-1']);
    expect(result.gracefulExitRequestedIssueIds).toEqual([]);
    expect(state.running['ssh-1']).toBeUndefined();
  });
});
