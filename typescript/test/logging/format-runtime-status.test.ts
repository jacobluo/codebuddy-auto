import { describe, expect, it } from 'vitest';

import { formatRuntimeStatus } from '../../src/logging/index.js';
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

describe('formatRuntimeStatus', () => {
  it('prints a readable summary of running and retrying entries', () => {
    const state = createRuntimeState();
    state.running['1'] = {
      issue: makeIssue({ id: '1', identifier: '#1', title: 'First' }),
      workspacePath: '/tmp/1',
      sessionId: 'session-1',
      startedAt: '2026-05-20T00:00:00Z',
      turnCount: 2,
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
    state.retryAttempts['2'] = {
      issueId: '2',
      identifier: '#2',
      mode: 'failure',
      attempt: 3,
      dueAtMs: 200,
      error: 'turn_failed',
    };
    state.claimed.add('1');
    state.claimed.add('2');
    state.completed.add('3');

    const rendered = formatRuntimeStatus({
      generatedAt: '2026-05-20T00:02:00Z',
      counts: {
        running: 1,
        retrying: 1,
        claimed: 2,
        completed: 1,
      },
      cleanedWorkspaceIssueIds: ['1'],
      totals: {
        secondsRunning: 3,
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
        creditCost: 12.5,
      },
      running: [{
        issueId: '1',
        identifier: '#1',
        title: 'First',
        sessionId: 'session-1',
        turnCount: 2,
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
      }],
      retrying: [{
        issueId: '2',
        identifier: '#2',
        mode: 'failure',
        attempt: 3,
        dueAtMs: 200,
        error: 'turn_failed',
      }],
      completedIssueIds: ['3'],
    });

    expect(rendered).toContain('counts: running=1 retrying=1 claimed=2 completed=1');
    expect(rendered).toContain('totals: seconds=3 input=10 output=4 total=14 cacheCreate=2 cacheRead=1 credit=12.5');
    expect(rendered).toContain('running: #1 turn=2 session=session-1 event=turn_completed seconds=3 tokens=14 credit=12.5');
    expect(rendered).toContain('retrying: #2 mode=failure attempt=3 dueAtMs=200 error=turn_failed');
    expect(rendered).toContain('completed: 3');
    expect(rendered).toContain('cleanedWorkspaces: 1');
  });

  it('prints empty sections explicitly', () => {
    const rendered = formatRuntimeStatus({
      generatedAt: '2026-05-20T00:03:00Z',
      counts: {
        running: 0,
        retrying: 0,
        claimed: 0,
        completed: 0,
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
      completedIssueIds: [],
    });

    expect(rendered).toContain('running: none');
    expect(rendered).toContain('retrying: none');
    expect(rendered).toContain('completed: none');
    expect(rendered).toContain('cleanedWorkspaces: none');
  });
});
