import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeLogger } from '../../src/logging/index.js';
import { createRuntimeState, runContinuationCycle } from '../../src/scheduler/index.js';
import { DEFAULT_SERVICE_CONFIG, type ServiceConfig } from '../../src/spec/index.js';
import type { Tracker } from '../../src/tracker/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// SDK module mock
//
// `runContinuationCycle` routes to the SDK runner when `worker.kind === 'local'`
// (the default). We mock the SDK so tests don't try to spawn a real CodeBuddy
// CLI subprocess. Each test pushes a queue of messages onto `messageQueues`
// before invoking `runContinuationCycle`; the mock replays them in order via
// async iterator.
//
// Queue semantics (per `query()` call):
//   - if `options.cwd` does not exist → throw (mirrors real spawn failure)
//   - else shift the next queue and yield each message in order
//   - if no queue is queued for this call → yield nothing and return (the
//     runner sees zero events, which surfaces as `unknown_error`)
// ─────────────────────────────────────────────────────────────────────────────

interface QueryCall {
  prompt: string;
  options: Record<string, unknown>;
}

const queryCalls: QueryCall[] = [];
const messageQueues: unknown[][] = [];

vi.mock('@tencent-ai/agent-sdk', async () => {
  const fsModule = await import('node:fs');
  return {
    query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
      queryCalls.push({ prompt, options });
      const cwd = options.cwd;
      if (typeof cwd === 'string' && !fsModule.existsSync(cwd)) {
        return (async function* () {
          throw new Error(`workspace not found: ${cwd}`);
        })();
      }
      const queue = messageQueues.shift() ?? [];
      return (async function* () {
        for (const msg of queue) {
          await Promise.resolve();
          yield msg;
        }
      })();
    },
  };
});

const tempDirs: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-24T00:00:00Z'));
  queryCalls.length = 0;
  messageQueues.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspaceRoot(): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-continuation-'));
  tempDirs.push(workspaceRoot);
  return workspaceRoot;
}

function createConfig(workspaceRoot: string, command: string, overrides: Partial<ServiceConfig['codebuddy']> = {}): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    tracker: {
      ...DEFAULT_SERVICE_CONFIG.tracker,
      kind: 'local',
      apiKey: 'token',
    },
    workspace: {
      ...DEFAULT_SERVICE_CONFIG.workspace,
      root: workspaceRoot,
    },
    codebuddy: {
      ...DEFAULT_SERVICE_CONFIG.codebuddy,
      command,
      ...overrides,
    },
  };
}

function seedRunningState(workspaceRoot: string) {
  const state = createRuntimeState();
  state.running['1'] = {
    issue: {
      id: '1',
      identifier: '#1',
      title: 'Continuation issue',
      description: null,
      priority: null,
      state: 'open',
      branchName: null,
      url: null,
      labels: [],
      blockedBy: [],
      createdAt: null,
      updatedAt: null,
    },
    workspacePath: path.join(workspaceRoot, '_1'),
    sessionId: 'session-1',
    startedAt: '2026-05-24T00:00:00Z',
    turnCount: 1,
    lastEvent: 'turn_completed',
    lastEventAt: '2026-05-24T00:00:01Z',
    secondsRunning: 1,
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      creditCost: 0,
    },
    lastReportedTotals: {
      inputTokens: 10,
      outputTokens: 2,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  };
  state.claimed.add('1');
  state.retryAttempts['1'] = {
    issueId: '1',
    identifier: '#1',
    mode: 'continuation',
    attempt: 1,
    dueAtMs: Date.now() - 1,
    error: 'turn_completed',
  };
  fs.mkdirSync(path.join(workspaceRoot, '_1'), { recursive: true });
  return state;
}

describe('runContinuationCycle', () => {
  it('resumes the existing session, updates runtime state, and schedules the next continuation retry', async () => {
    const workspaceRoot = createWorkspaceRoot();
    // The SDK yields an assistant message (with credit info) followed by a
    // successful result. The runner emits `notification` then `turn_completed`.
    messageQueues.push([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'still working' }],
          usage: { input_tokens: 14, output_tokens: 5 },
          providerData: { rawUsage: { credit: 8 } },
        },
      },
      {
        type: 'result',
        is_error: false,
        duration_ms: 4000,
        num_turns: 2,
        usage: { input_tokens: 14, output_tokens: 5 },
      },
    ]);

    const config = createConfig(workspaceRoot, 'unused-cli-command');
    const state = seedRunningState(workspaceRoot);

    const result = await runContinuationCycle(state, config);

    expect(result.continuedIssueIds).toEqual(['1']);
    expect(state.running['1']).toMatchObject({
      sessionId: 'session-1',
      turnCount: 2,
      lastEvent: 'turn_completed',
      secondsRunning: 5,
      tokenUsage: {
        inputTokens: 14,
        outputTokens: 5,
        totalTokens: 19,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 8,
      },
      lastReportedTotals: {
        inputTokens: 14,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    });
    expect(state.retryAttempts['1']).toEqual({
      issueId: '1',
      identifier: '#1',
      mode: 'continuation',
      attempt: 2,
      dueAtMs: Date.parse('2026-05-24T00:00:00Z') + 1000,
      error: 'turn_completed',
    });

    // Equivalent of the old "args.at(-1) contains continuation prompt" check —
    // assert the SDK was invoked with resume token and continuation prompt.
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]!.options.resume).toBe('session-1');
    expect(queryCalls[0]!.prompt).toContain('This is continuation turn 2.');
  });

  it('schedules a failure retry and logs the retry metadata when continuation needs approval', async () => {
    const workspaceRoot = createWorkspaceRoot();
    // Approval-required surfaces as a permission denial in SDK mode. The
    // runner maps `is_error: true` (not max-turns) → `turn_failed`; the
    // scheduler then classifies it via the retry logic. The test was written
    // when CLI emitted `subtype: 'approval_required'` which the runner mapped
    // to `turn_input_required`. With SDK we model the same logical state via
    // `subtype: 'approval_required'` + `is_error: true` and assert the
    // resulting failure-mode retry entry.
    messageQueues.push([
      {
        type: 'result',
        is_error: true,
        subtype: 'approval_required',
        result: 'approval required',
        permission_denials: [{ kind: 'exec' }],
      },
    ]);

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      child: vi.fn(function child() {
        return {
          info: logger.info,
          error: logger.error,
          child: logger.child,
        };
      }),
    } as unknown as RuntimeLogger;
    const config = createConfig(workspaceRoot, 'unused-cli-command');
    const state = seedRunningState(workspaceRoot);

    const result = await runContinuationCycle(state, config, logger);

    expect(result.continuedIssueIds).toEqual(['1']);
    expect(state.running['1']).toMatchObject({
      turnCount: 2,
      lastEvent: 'turn_failed',
    });
    expect(state.retryAttempts['1']).toMatchObject({
      issueId: '1',
      identifier: '#1',
      mode: 'failure',
      attempt: 1,
      error: 'turn_failed',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        lastEvent: 'turn_failed',
        retryMode: 'failure',
        retryAttempt: 1,
      }),
      'issue_continuation_retry_scheduled',
    );
  });

  it('stops scheduling retries after maxTurns is reached', async () => {
    const workspaceRoot = createWorkspaceRoot();
    messageQueues.push([
      {
        type: 'result',
        is_error: false,
        duration_ms: 1000,
        num_turns: 2,
        usage: { input_tokens: 11, output_tokens: 3 },
      },
    ]);

    const config = {
      ...createConfig(workspaceRoot, 'unused-cli-command'),
      agent: {
        ...DEFAULT_SERVICE_CONFIG.agent,
        maxTurns: 2,
      },
    };
    const state = seedRunningState(workspaceRoot);

    const result = await runContinuationCycle(state, config);

    expect(result.continuedIssueIds).toEqual(['1']);
    // At maxTurns, the runner removes the issue from the running set entirely
    // (see Task 3.4 — issue release on maxTurns).
    expect(state.running['1']).toBeUndefined();
    expect(state.retryAttempts['1']).toBeUndefined();
    expect(state.completed.has('1')).toBe(true);
  });

  it('continues later continuation retries when an earlier attempt throws unexpectedly', async () => {
    const workspaceRoot = createWorkspaceRoot();
    // Issue 1 has a missing workspace → SDK mock throws → runner treats as
    // continuation_failed. Issue 2 has a valid workspace and the SDK yields a
    // successful turn. Only one queue entry needed (issue 2's).
    messageQueues.push([
      {
        type: 'assistant',
        message: {
          usage: { input_tokens: 12, output_tokens: 4 },
          providerData: { rawUsage: { credit: 6 } },
        },
      },
      {
        type: 'result',
        is_error: false,
        duration_ms: 3000,
        num_turns: 2,
        usage: { input_tokens: 12, output_tokens: 4 },
      },
    ]);

    const config = createConfig(workspaceRoot, 'unused-cli-command');
    const state = seedRunningState(workspaceRoot);
    state.running['2'] = {
      issue: {
        id: '2',
        identifier: '#2',
        title: 'Second continuation issue',
        description: null,
        priority: null,
        state: 'open',
        branchName: null,
        url: null,
        labels: [],
        blockedBy: [],
        createdAt: null,
        updatedAt: null,
      },
      workspacePath: path.join(workspaceRoot, '_2'),
      sessionId: 'session-2',
      startedAt: '2026-05-24T00:00:00Z',
      turnCount: 1,
      lastEvent: 'turn_completed',
      lastEventAt: '2026-05-24T00:00:01Z',
      secondsRunning: 1,
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 0,
      },
      lastReportedTotals: {
        inputTokens: 10,
        outputTokens: 2,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    };
    state.claimed.add('2');
    state.retryAttempts['1'] = {
      issueId: '1',
      identifier: '#1',
      mode: 'continuation',
      attempt: 1,
      dueAtMs: Date.now() - 1,
      error: 'turn_completed',
    };
    state.retryAttempts['2'] = {
      issueId: '2',
      identifier: '#2',
      mode: 'continuation',
      attempt: 1,
      dueAtMs: Date.now() - 1,
      error: 'turn_completed',
    };
    fs.mkdirSync(path.join(workspaceRoot, '_2'), { recursive: true });

    // Force issue 1's workspace to a non-existent path so the SDK mock throws.
    const firstRunningEntry = state.running['1'];
    if (!firstRunningEntry) {
      throw new Error('missing running entry for issue 1');
    }
    firstRunningEntry.workspacePath = path.join(workspaceRoot, '_missing-1');

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      child: vi.fn(function child() {
        return {
          info: logger.info,
          error: logger.error,
          child: logger.child,
        };
      }),
    } as unknown as RuntimeLogger;

    const result = await runContinuationCycle(state, config, logger);

    expect(result.continuedIssueIds).toEqual(['1', '2']);
    // Note: the mock throwing surfaces as a `turn_failed` event from inside
    // the runner's async iterator try/catch, not as a thrown promise from
    // runContinuationCycle. So issue 1 stays in `running` with lastEvent
    // 'turn_failed' and a failure-mode retry entry.
    expect(state.running['1']).toMatchObject({
      lastEvent: 'turn_failed',
    });
    expect(state.retryAttempts['1']).toMatchObject({
      issueId: '1',
      identifier: '#1',
      mode: 'failure',
      attempt: 1,
    });
    expect(state.running['2']).toMatchObject({
      turnCount: 2,
      lastEvent: 'turn_completed',
    });
    expect(state.retryAttempts['2']).toMatchObject({
      issueId: '2',
      identifier: '#2',
      mode: 'continuation',
      attempt: 2,
      error: 'turn_completed',
    });
  });

  it('releases an issue before continuation when tracker reports it is no longer active', async () => {
    const workspaceRoot = createWorkspaceRoot();
    // Tracker says issue is closed → runner releases it before calling SDK.
    // No messageQueues push needed (SDK is never invoked).
    const config = createConfig(workspaceRoot, 'unused-cli-command');
    const state = seedRunningState(workspaceRoot);

    const tracker: Tracker = {
      fetchCandidateIssues: async () => [],
      fetchIssuesByStates: async () => [],
      fetchIssueStatesByIds: async (ids) => {
        const map = new Map<string, { id: string; state: string; labels: string[] }>();
        for (const id of ids) {
          map.set(id, { id, state: 'closed', labels: [] });
        }
        return map;
      },
    };

    const result = await runContinuationCycle(state, config, undefined, tracker);

    expect(result.releasedIssueIds).toEqual(['1']);
    expect(result.continuedIssueIds).toEqual([]);
    expect(state.running['1']).toBeUndefined();
    expect(state.retryAttempts['1']).toBeUndefined();
    expect(state.claimed.has('1')).toBe(false);
    expect(state.completed.has('1')).toBe(true);
    // SDK was never invoked
    expect(queryCalls).toEqual([]);
  });
});
