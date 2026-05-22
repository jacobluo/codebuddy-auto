import { describe, expect, it } from 'vitest';

import { createRuntimeSnapshot } from '../../src/logging/index.js';
import { createRuntimeState } from '../../src/scheduler/index.js';
import type { Issue } from '../../src/spec/index.js';

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

describe('createRuntimeSnapshot', () => {
  it('summarizes running, retrying, claimed, and completed issues', () => {
    const state = createRuntimeState();
    state.running['1'] = {
      issue: makeIssue({ id: '1', identifier: '#1', title: 'Running issue' }),
      workspacePath: '/tmp/1',
      sessionId: '1-turn-1',
      startedAt: '2026-05-20T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-20T00:01:00Z',
      secondsRunning: 3,
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
        creditCost: 12.5,
      },
      lastReportedTotals: {
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
      },
    };
    state.claimed.add('1');
    state.claimed.add('2');
    state.retryAttempts['2'] = {
      issueId: '2',
      identifier: '#2',
      mode: 'failure',
      attempt: 2,
      dueAtMs: 1234,
      error: 'turn_failed',
    };
    state.completed.add('3');

    const snapshot = createRuntimeSnapshot(state, '2026-05-20T00:02:00Z');

    expect(snapshot).toEqual({
      generatedAt: '2026-05-20T00:02:00Z',
      counts: {
        claimed: 2,
        completed: 1,
        retrying: 1,
        running: 1,
      },
      cleanedWorkspaceIssueIds: [],
      totals: {
        secondsRunning: 3,
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
        creditCost: 12.5,
      },
      running: [
        {
          issueId: '1',
          identifier: '#1',
          title: 'Running issue',
          sessionId: '1-turn-1',
          turnCount: 1,
          lastEvent: 'turn_completed',
          lastEventAt: '2026-05-20T00:01:00Z',
          secondsRunning: 3,
          tokenUsage: {
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14,
            cacheCreationInputTokens: 2,
            cacheReadInputTokens: 1,
            creditCost: 12.5,
          },
        },
      ],
      retrying: [
        {
          issueId: '2',
          identifier: '#2',
          mode: 'failure',
          attempt: 2,
          dueAtMs: 1234,
          error: 'turn_failed',
        },
      ],
      completedIssueIds: ['3'],
    });
  });

  it('sorts completed ids and handles empty runtime sections', () => {
    const state = createRuntimeState();
    state.completed.add('z');
    state.completed.add('a');

    const snapshot = createRuntimeSnapshot(state, '2026-05-20T00:03:00Z');

    expect(snapshot).toEqual({
      generatedAt: '2026-05-20T00:03:00Z',
      counts: {
        running: 0,
        retrying: 0,
        claimed: 0,
        completed: 2,
      },
      cleanedWorkspaceIssueIds: [],
      totals: {
        secondsRunning: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 0,
      },
      running: [],
      retrying: [],
      completedIssueIds: ['a', 'z'],
    });
  });

  it('sorts retrying entries by due time and running entries by identifier', () => {
    const state = createRuntimeState();
    state.running['b'] = {
      issue: makeIssue({ id: 'b', identifier: '#2', title: 'Second' }),
      workspacePath: '/tmp/b',
      sessionId: 'b-turn-1',
      startedAt: '2026-05-20T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-20T00:00:01Z',
      secondsRunning: 1,
      tokenUsage: {
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 2,
      },
      lastReportedTotals: {
        inputTokens: 4,
        outputTokens: 2,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    };
    state.running['a'] = {
      issue: makeIssue({ id: 'a', identifier: '#1', title: 'First' }),
      workspacePath: '/tmp/a',
      sessionId: 'a-turn-1',
      startedAt: '2026-05-20T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-20T00:00:01Z',
      secondsRunning: 2,
      tokenUsage: {
        inputTokens: 6,
        outputTokens: 3,
        totalTokens: 9,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 4,
      },
      lastReportedTotals: {
        inputTokens: 6,
        outputTokens: 3,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    };
    state.retryAttempts['late'] = {
      issueId: 'late',
      identifier: '#late',
      mode: 'failure',
      attempt: 1,
      dueAtMs: 200,
      error: 'turn_failed',
    };
    state.retryAttempts['early'] = {
      issueId: 'early',
      identifier: '#early',
      mode: 'failure',
      attempt: 2,
      dueAtMs: 100,
      error: 'turn_timed_out',
    };

    const snapshot = createRuntimeSnapshot(state, '2026-05-20T00:04:00Z');

    expect(snapshot.running.map((entry) => entry.identifier)).toEqual(['#1', '#2']);
    expect(snapshot.retrying.map((entry) => entry.issueId)).toEqual(['early', 'late']);
    expect(snapshot.totals).toEqual({
      secondsRunning: 3,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      creditCost: 6,
    });
  });
});
