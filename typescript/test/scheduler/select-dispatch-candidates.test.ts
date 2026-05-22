import { describe, expect, it } from 'vitest';

import type { Issue } from '../../src/spec/index.js';
import { selectDispatchCandidates } from '../../src/scheduler/index.js';

function makeIssue(overrides: Partial<Issue>): Issue {
  return {
    id: '1',
    identifier: 'ABC-1',
    title: 'Test issue',
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

describe('selectDispatchCandidates', () => {
  it('sorts by priority then creation time', () => {
    const issues = [
      makeIssue({ id: '2', identifier: 'ABC-2', priority: 2, createdAt: '2026-05-18T12:00:00Z' }),
      makeIssue({ id: '1', identifier: 'ABC-1', priority: 1, createdAt: '2026-05-18T13:00:00Z' }),
      makeIssue({ id: '3', identifier: 'ABC-3', priority: 1, createdAt: '2026-05-18T11:00:00Z' }),
    ];

    const selected = selectDispatchCandidates({
      issues,
      activeStates: ['open'],
      terminalStates: ['closed'],
      runningIssueIds: new Set(),
      claimedIssueIds: new Set(),
      maxConcurrentAgents: 10,
      runningCount: 0,
    });

    expect(selected.map((issue) => issue.id)).toEqual(['3', '1', '2']);
  });

  it('excludes running, claimed, terminal, and blocked todo issues', () => {
    const issues = [
      makeIssue({ id: 'running' }),
      makeIssue({ id: 'claimed' }),
      makeIssue({ id: 'closed', state: 'closed' }),
      makeIssue({
        id: 'blocked',
        state: 'Todo',
        blockedBy: [{ id: 'x', identifier: '#2', state: 'open' }],
      }),
      makeIssue({ id: 'ready', state: 'Todo', blockedBy: [{ id: 'x', identifier: '#2', state: 'closed' }] }),
    ];

    const selected = selectDispatchCandidates({
      issues,
      activeStates: ['open', 'todo'],
      terminalStates: ['closed'],
      runningIssueIds: new Set(['running']),
      claimedIssueIds: new Set(['claimed']),
      maxConcurrentAgents: 10,
      runningCount: 0,
    });

    expect(selected.map((issue) => issue.id)).toEqual(['ready']);
  });

  it('respects remaining concurrency slots', () => {
    const issues = [
      makeIssue({ id: '1' }),
      makeIssue({ id: '2' }),
      makeIssue({ id: '3' }),
    ];

    const selected = selectDispatchCandidates({
      issues,
      activeStates: ['open'],
      terminalStates: ['closed'],
      runningIssueIds: new Set(),
      claimedIssueIds: new Set(),
      maxConcurrentAgents: 3,
      runningCount: 2,
    });

    expect(selected).toHaveLength(1);
  });

  it('does not redispatch issues with pending retry entries', () => {
    const selected = selectDispatchCandidates({
      issues: [makeIssue({ id: 'retrying', identifier: 'ABC-9' })],
      activeStates: ['open'],
      terminalStates: ['closed'],
      runningIssueIds: new Set(),
      claimedIssueIds: new Set(['retrying']),
      maxConcurrentAgents: 10,
      runningCount: 0,
    });

    expect(selected).toEqual([]);
  });
});
