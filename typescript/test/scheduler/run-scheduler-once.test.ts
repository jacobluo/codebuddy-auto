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

describe('runSchedulerOnce', () => {
  it('reconciles running issues before dispatching new work', async () => {
    const state = createRuntimeState();
    state.running['done-1'] = {
      issue: makeIssue({ id: 'done-1', identifier: '#done-1' }),
      sessionId: 'done-1-turn-1',
      startedAt: '2026-05-19T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-19T00:00:01Z',
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
    });

    expect(result.releasedIssueIds).toEqual(['done-1']);
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
    expect(result.dispatch.dispatchableIssueIds).toEqual([]);
  });
});
