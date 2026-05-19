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
    completed: new Set(),
  };
}

describe('reconcileRuntimeState', () => {
  it('releases running issues that moved into a terminal state', () => {
    const state = createState();
    state.running['1'] = {
      issue: makeIssue({ id: '1', identifier: '#1' }),
      sessionId: '1-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
    };
    state.claimed.add('1');

    const result = reconcileRuntimeState(state, new Map([
      ['1', { id: '1', state: 'closed', labels: ['done'] }],
    ]), ['closed']);

    expect(result.releasedIssueIds).toEqual(['1']);
    expect(state.running['1']).toBeUndefined();
    expect(state.claimed.has('1')).toBe(false);
    expect(state.completed.has('1')).toBe(true);
  });

  it('keeps active running issues claimed', () => {
    const state = createState();
    state.running['2'] = {
      issue: makeIssue({ id: '2', identifier: '#2' }),
      sessionId: '2-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
    };
    state.claimed.add('2');

    const result = reconcileRuntimeState(state, new Map([
      ['2', { id: '2', state: 'open', labels: [] }],
    ]), ['closed']);

    expect(result.releasedIssueIds).toEqual([]);
    expect(state.running['2']).toBeDefined();
    expect(state.claimed.has('2')).toBe(true);
  });

  it('releases running issues missing from the latest tracker snapshot', () => {
    const state = createState();
    state.running['3'] = {
      issue: makeIssue({ id: '3', identifier: '#3' }),
      sessionId: '3-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
    };
    state.claimed.add('3');

    const result = reconcileRuntimeState(state, new Map(), ['closed']);

    expect(result.releasedIssueIds).toEqual(['3']);
    expect(state.running['3']).toBeUndefined();
    expect(state.claimed.has('3')).toBe(false);
    expect(state.completed.has('3')).toBe(true);
  });
});
