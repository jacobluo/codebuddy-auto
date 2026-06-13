import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeState, runContinuationCycle } from '../../src/scheduler/index.js';
import { DEFAULT_SERVICE_CONFIG, type Issue, type ServiceConfig } from '../../src/spec/index.js';
import type { Tracker } from '../../src/tracker/index.js';

const runnerMocks = vi.hoisted(() => ({
  buildCodebuddyCommand: vi.fn(),
  runCodebuddyTurn: vi.fn(),
  updateTokenUsage: vi.fn(),
}));

vi.mock('../../src/runner/index.js', () => ({
  buildCodebuddyCommand: runnerMocks.buildCodebuddyCommand,
  runCodebuddyTurn: runnerMocks.runCodebuddyTurn,
  updateTokenUsage: runnerMocks.updateTokenUsage,
}));

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'ssh-max-1',
    identifier: '#ssh-max-1',
    title: 'SSH max turns',
    description: 'Reach max turns without handoff',
    priority: null,
    state: 'open',
    branchName: null,
    url: null,
    labels: ['agent-ready'],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeConfig(): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    worker: {
      ...DEFAULT_SERVICE_CONFIG.worker,
      kind: 'ssh',
      sshHost: 'remote.example',
    },
    tracker: {
      ...DEFAULT_SERVICE_CONFIG.tracker,
      finishLabel: 'agent-finish',
    },
    agent: {
      ...DEFAULT_SERVICE_CONFIG.agent,
      maxTurns: 2,
      noProgressThreshold: 2,
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

describe('runContinuationCycle', () => {
  beforeEach(() => {
    runnerMocks.buildCodebuddyCommand.mockReturnValue({
      command: 'node',
      args: [],
      cwd: '/tmp/ssh-max-1',
    });
    runnerMocks.runCodebuddyTurn.mockResolvedValue({
      exitCode: 0,
      events: [
        {
          event: 'turn_completed',
          payload: {
            durationMs: 25,
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
          },
        },
      ],
    });
    runnerMocks.updateTokenUsage.mockReturnValue({
      totals: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 0,
      },
      lastReportedTotals: {
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    });
  });

  it('releases at maxTurns without applying finish label', async () => {
    const state = createRuntimeState();
    const issue = makeIssue();
    state.running[issue.id] = {
      issue,
      workspacePath: '/tmp/ssh-max-1',
      sessionId: 'ssh-session-1',
      startedAt: '2026-06-13T00:00:00.000Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-06-13T00:00:01.000Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add(issue.id);
    state.retryAttempts[issue.id] = {
      issueId: issue.id,
      identifier: issue.identifier,
      mode: 'continuation',
      attempt: 1,
      dueAtMs: Date.now() - 1,
      error: 'turn_completed',
    };

    const addedLabels: string[] = [];
    const tracker: Tracker = {
      async fetchCandidateIssues() {
        return [];
      },
      async fetchIssuesByStates() {
        return [];
      },
      async fetchIssueStatesByIds(ids) {
        return new Map(ids.map((id) => [id, { id, state: 'open', labels: ['agent-ready'] }]));
      },
      async addLabel(_issueId, label) {
        addedLabels.push(label);
      },
      getFinishLabel() {
        return 'agent-finish';
      },
    };

    const result = await runContinuationCycle(state, makeConfig(), undefined, tracker);

    expect(result.continuedIssueIds).toEqual([issue.id]);
    expect(addedLabels).toEqual([]);
    expect(state.running[issue.id]).toBeUndefined();
    expect(state.retryAttempts[issue.id]).toBeUndefined();
    expect(state.claimed.has(issue.id)).toBe(false);
    expect(state.completed.has(issue.id)).toBe(false);
    expect(state.stuck[issue.id]?.reason).toBe('max_turns_reached');
  });

  it('marks an SSH continuation issue stuck after repeated no-progress fingerprints', async () => {
    const state = createRuntimeState();
    const issue = makeIssue({ id: 'ssh-stuck-1', identifier: '#ssh-stuck-1' });
    state.running[issue.id] = {
      issue,
      workspacePath: '/tmp/ssh-stuck-1',
      sessionId: 'ssh-session-stuck',
      startedAt: '2026-06-13T00:00:00.000Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-06-13T00:00:01.000Z',
      ...makeRuntimeMetrics(),
    };
    state.claimed.add(issue.id);
    state.retryAttempts[issue.id] = {
      issueId: issue.id,
      identifier: issue.identifier,
      mode: 'continuation',
      attempt: 1,
      dueAtMs: Date.now() - 1,
      error: 'turn_completed',
    };

    const tracker: Tracker = {
      async fetchCandidateIssues() {
        return [];
      },
      async fetchIssuesByStates() {
        return [];
      },
      async fetchIssueStatesByIds(ids) {
        return new Map(ids.map((id) => [id, { id, state: 'open', labels: ['agent-ready'] }]));
      },
      getFinishLabel() {
        return 'agent-finish';
      },
    };
    const config = {
      ...makeConfig(),
      agent: {
        ...makeConfig().agent,
        maxTurns: 5,
        noProgressThreshold: 2,
      },
    };

    await runContinuationCycle(state, config, undefined, tracker);
    expect(state.progress[issue.id]?.repeatedCount).toBe(1);
    expect(state.stuck[issue.id]).toBeUndefined();

    state.retryAttempts[issue.id] = {
      issueId: issue.id,
      identifier: issue.identifier,
      mode: 'continuation',
      attempt: 2,
      dueAtMs: Date.now() - 1,
      error: 'turn_completed',
    };

    await runContinuationCycle(state, config, undefined, tracker);

    expect(state.stuck[issue.id]?.reason).toBe('no_progress');
    expect(state.progress[issue.id]?.repeatedCount).toBe(2);
    expect(state.running[issue.id]).toBeUndefined();
    expect(state.retryAttempts[issue.id]).toBeUndefined();
    expect(state.claimed.has(issue.id)).toBe(false);
    expect(state.completed.has(issue.id)).toBe(false);
  });
});
