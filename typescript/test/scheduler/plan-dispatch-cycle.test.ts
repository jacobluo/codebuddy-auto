import { describe, expect, it } from 'vitest';

import { planDispatchCycle, createRuntimeState } from '../../src/scheduler/index.js';
import { DEFAULT_SERVICE_CONFIG, type Issue } from '../../src/spec/index.js';

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

describe('planDispatchCycle', () => {
  it('computes available slots from running state', () => {
    const state = createRuntimeState();
    state.running.one = {
      issue: makeIssue({ id: '1' }),
      workspacePath: '/tmp/1',
      sessionId: null,
      startedAt: '2026-05-18T00:00:00Z',
      turnCount: 0,
      lastEvent: null,
      lastEventAt: null,
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

    const plan = planDispatchCycle(
      state,
      [makeIssue({ id: '2', identifier: '#2' })],
      {
        ...DEFAULT_SERVICE_CONFIG,
        agent: {
          ...DEFAULT_SERVICE_CONFIG.agent,
          maxConcurrentAgents: 2,
        },
      },
    );

    expect(plan.availableSlots).toBe(1);
    expect(plan.dispatchableIssues).toHaveLength(1);
  });

  it('filters out claimed issues through the dispatch plan', () => {
    const state = createRuntimeState();
    state.claimed.add('2');

    const plan = planDispatchCycle(
      state,
      [
        makeIssue({ id: '1', identifier: '#1' }),
        makeIssue({ id: '2', identifier: '#2' }),
      ],
      DEFAULT_SERVICE_CONFIG,
    );

    expect(plan.dispatchableIssues.map((issue) => issue.id)).toEqual(['1']);
  });

  it('filters out stuck issues through the dispatch plan', () => {
    const state = createRuntimeState();
    state.stuck['2'] = {
      reason: 'no_progress',
      repeatedCount: 2,
      fingerprint: 'same',
    };

    const plan = planDispatchCycle(
      state,
      [
        makeIssue({ id: '1', identifier: '#1' }),
        makeIssue({ id: '2', identifier: '#2' }),
      ],
      DEFAULT_SERVICE_CONFIG,
    );

    expect(plan.dispatchableIssues.map((issue) => issue.id)).toEqual(['1']);
  });


  it('applies per-state concurrency caps from running issue state counts', () => {
    const state = createRuntimeState();
    state.running.openOne = {
      issue: makeIssue({ id: 'open-0', identifier: '#open-0', state: 'open' }),
      workspacePath: '/tmp/open-0',
      sessionId: 'session-open',
      startedAt: '2026-05-18T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-18T00:00:01Z',
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

    const plan = planDispatchCycle(
      state,
      [
        makeIssue({ id: 'open-1', identifier: '#open-1', state: 'open', priority: 1 }),
        makeIssue({ id: 'todo-1', identifier: '#todo-1', state: 'todo', priority: 2 }),
      ],
      {
        ...DEFAULT_SERVICE_CONFIG,
        tracker: {
          ...DEFAULT_SERVICE_CONFIG.tracker,
          activeStates: ['open', 'todo'],
        },
        agent: {
          ...DEFAULT_SERVICE_CONFIG.agent,
          maxConcurrentAgents: 3,
          maxConcurrentAgentsByState: {
            open: 1,
            todo: 2,
          },
        },
      },
    );

    expect(plan.availableSlots).toBe(2);
    expect(plan.dispatchableIssues.map((issue) => issue.id)).toEqual(['todo-1']);
  });
});
