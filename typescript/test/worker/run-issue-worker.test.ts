/**
 * Tests for `runIssueWorker` — the per-issue long-lived async worker.
 *
 * Each test drives the worker against a `FakeSdk` ScenarioPlan and asserts
 * the observable side-effects: turn count, applied labels, runtime state
 * mutations, and final session disposal.
 *
 * Naming: scenario IDs map to tasks.md §3.1–§3.10.
 */

import { describe, expect, it } from 'vitest';

import type { Issue, ServiceConfig } from '../../src/spec/index.js';
import type { Tracker } from '../../src/tracker/index.js';
import { runIssueWorker, type IssueWorkerDeps } from '../../src/worker/run-issue-worker.js';
import { createWorkerHandleStore } from '../../src/worker/worker-handle-store.js';
import {
  assistantText,
  createFakeSdk,
  resultSuccess,
  systemInit,
  type ScenarioPlan,
} from './fake-sdk.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-6',
    identifier: '#6',
    title: '调整 README',
    description: 'Make README minimal',
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

interface MockTrackerOptions {
  /** Per-call sequence of label sets observed by `fetchIssueStatesByIds`. */
  stateSequence?: Array<{ state: string; labels: string[] }>;
  finishLabel?: string;
}

function makeTracker(opts: MockTrackerOptions = {}): {
  tracker: Tracker;
  addedLabels: string[];
  fetchCalls: number;
} {
  const sequence = opts.stateSequence ?? [{ state: 'open', labels: ['agent-ready'] }];
  let cursor = 0;
  const addedLabels: string[] = [];
  let fetchCalls = 0;

  const tracker: Tracker = {
    async fetchCandidateIssues() {
      return [];
    },
    async fetchIssuesByStates() {
      return [];
    },
    async fetchIssueStatesByIds(ids) {
      fetchCalls += 1;
      const next = sequence[Math.min(cursor, sequence.length - 1)] ?? sequence[sequence.length - 1]!;
      cursor += 1;
      const map = new Map<string, { id: string; state: string; labels: string[] }>();
      for (const id of ids) {
        map.set(id, { id, state: next.state, labels: next.labels });
      }
      return map;
    },
    async addLabel(_issueId, label) {
      addedLabels.push(label);
    },
    getFinishLabel() {
      return opts.finishLabel ?? 'agent-finish';
    },
  };

  return {
    tracker,
    get addedLabels() {
      return addedLabels;
    },
    get fetchCalls() {
      return fetchCalls;
    },
  } as unknown as { tracker: Tracker; addedLabels: string[]; fetchCalls: number };
}

function makeConfig(overrides: Partial<ServiceConfig['agent']> = {}): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    agent: { ...DEFAULT_SERVICE_CONFIG.agent, ...overrides },
    tracker: { ...DEFAULT_SERVICE_CONFIG.tracker, finishLabel: 'agent-finish' },
  };
}

function withFake(plan: ScenarioPlan): IssueWorkerDeps['createSession'] {
  const fake = createFakeSdk(plan);
  return (options) => fake.createSession(options);
}

describe('runIssueWorker — happy path (3.1)', () => {
  it('agent applies finish_label by turn 5; worker exits without safety-net label', async () => {
    const issue = makeIssue();
    const config = makeConfig({ maxTurns: 20 });
    const store = createWorkerHandleStore();
    const trackerHelper = makeTracker({
      stateSequence: [
        // After turn 1 (re-check before turn 2): still open, no finish label yet
        { state: 'open', labels: ['agent-ready'] },
        // After turn 2
        { state: 'open', labels: ['agent-ready'] },
        // After turn 3
        { state: 'open', labels: ['agent-ready'] },
        // After turn 4
        { state: 'open', labels: ['agent-ready'] },
        // After turn 5 → agent has applied finish_label
        { state: 'open', labels: ['agent-ready', 'agent-finish'] },
      ],
    });

    const plan: ScenarioPlan = {
      sessionId: 'sess-happy',
      turns: Array.from({ length: 5 }, (_, i) => ({
        messages: [
          ...(i === 0 ? [systemInit('sess-happy')] : []),
          assistantText('sess-happy', `turn ${i + 1}`),
          resultSuccess('sess-happy'),
        ],
      })),
    };

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: withFake(plan),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('finish_label_observed');
    expect(result.turnCount).toBe(5);
    // No safety-net label applied (agent did the handoff itself)
    expect(trackerHelper.addedLabels).toEqual([]);
    // Handle removed
    expect(store.get(issue.id)).toBeUndefined();
  });
});

describe('runIssueWorker — max turns (3.3)', () => {
  it('reaches maxTurns without finish_label; worker applies safety-net agent-finish and exits', async () => {
    const issue = makeIssue();
    const maxTurns = 3;
    const config = makeConfig({ maxTurns });
    const store = createWorkerHandleStore();
    const trackerHelper = makeTracker({
      stateSequence: [
        { state: 'open', labels: ['agent-ready'] },
        { state: 'open', labels: ['agent-ready'] },
        { state: 'open', labels: ['agent-ready'] },
      ],
    });

    const plan: ScenarioPlan = {
      sessionId: 'sess-max',
      turns: Array.from({ length: maxTurns }, (_, i) => ({
        messages: [
          ...(i === 0 ? [systemInit('sess-max')] : []),
          assistantText('sess-max', `turn ${i + 1}`),
          resultSuccess('sess-max'),
        ],
      })),
    };

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: withFake(plan),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('max_turns_reached');
    expect(result.turnCount).toBe(maxTurns);
    expect(trackerHelper.addedLabels).toEqual(['agent-finish']);
    expect(store.get(issue.id)).toBeUndefined();
  });
});

describe('runIssueWorker — graceful exit on terminal (3.4)', () => {
  it('issue moves to terminal mid-flight: worker breaks at next turn boundary, no safety-net label', async () => {
    const issue = makeIssue();
    const config = makeConfig({ maxTurns: 20 });
    const store = createWorkerHandleStore();
    const trackerHelper = makeTracker({
      stateSequence: [
        // After turn 1 → still open
        { state: 'open', labels: ['agent-ready'] },
        // After turn 2 → human closed it
        { state: 'closed', labels: [] },
      ],
    });

    const plan: ScenarioPlan = {
      sessionId: 'sess-term',
      turns: Array.from({ length: 5 }, (_, i) => ({
        messages: [
          ...(i === 0 ? [systemInit('sess-term')] : []),
          assistantText('sess-term', `turn ${i + 1}`),
          resultSuccess('sess-term'),
        ],
      })),
    };

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: withFake(plan),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('issue_inactive');
    expect(result.turnCount).toBe(2);
    expect(trackerHelper.addedLabels).toEqual([]);
    expect(store.get(issue.id)).toBeUndefined();
  });

  it('reconcile flips gracefulExitRequested mid-flight: worker exits at next turn boundary', async () => {
    const issue = makeIssue();
    const config = makeConfig({ maxTurns: 20 });
    const store = createWorkerHandleStore();

    // Tracker stays "active" — exit must come from the cooperative flag.
    const trackerHelper = makeTracker({
      stateSequence: [
        { state: 'open', labels: ['agent-ready'] },
        { state: 'open', labels: ['agent-ready'] },
        { state: 'open', labels: ['agent-ready'] },
      ],
    });

    const plan: ScenarioPlan = {
      sessionId: 'sess-graceful',
      turns: [
        {
          messages: [
            systemInit('sess-graceful'),
            assistantText('sess-graceful', 'turn 1'),
            resultSuccess('sess-graceful'),
          ],
        },
        // After turn 1 the test will flip gracefulExitRequested via a tracker
        // hook; we still pre-plan turn 2 in case the worker mistakenly runs it.
        {
          messages: [assistantText('sess-graceful', 'turn 2'), resultSuccess('sess-graceful')],
        },
      ],
    };

    // Wrap the tracker so when its `fetchIssueStatesByIds` returns we set
    // gracefulExitRequested before the worker reads it.
    const wrapped: Tracker = {
      ...trackerHelper.tracker,
      async fetchIssueStatesByIds(ids: string[]) {
        const result = await trackerHelper.tracker.fetchIssueStatesByIds(ids);
        store.requestGracefulExit(issue.id);
        return result;
      },
    };

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: wrapped,
      handleStore: store,
      createSession: withFake(plan),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('graceful_exit_requested');
    expect(result.turnCount).toBe(1);
    expect(trackerHelper.addedLabels).toEqual([]);
    expect(store.get(issue.id)).toBeUndefined();
  });
});

describe('runIssueWorker — stream error (3.5)', () => {
  it('result is_error mid-loop: emits turn_failed and exits without retry', async () => {
    const issue = makeIssue();
    const config = makeConfig({ maxTurns: 20 });
    const store = createWorkerHandleStore();
    const trackerHelper = makeTracker();

    const plan: ScenarioPlan = {
      sessionId: 'sess-err',
      turns: [
        {
          messages: [
            systemInit('sess-err'),
            assistantText('sess-err', 'attempt'),
            // result with is_error true → maps to turn_failed
            {
              type: 'result',
              subtype: 'error_during_execution',
              uuid: 'r-1',
              session_id: 'sess-err',
              duration_ms: 5,
              duration_api_ms: 5,
              is_error: true,
              num_turns: 1,
              total_cost_usd: 0,
              usage: {},
              permission_denials: [],
              errors: ['boom'],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          ],
        },
      ],
    };

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: withFake(plan),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('turn_failed');
    expect(result.errorMessage).toContain('boom');
    expect(result.turnCount).toBe(1);
    // No safety-net label
    expect(trackerHelper.addedLabels).toEqual([]);
    expect(store.get(issue.id)).toBeUndefined();
  });

  it('thrown error during stream(): emits turn_failed and exits', async () => {
    const issue = makeIssue();
    const config = makeConfig({ maxTurns: 20 });
    const store = createWorkerHandleStore();
    const trackerHelper = makeTracker();

    const plan: ScenarioPlan = {
      sessionId: 'sess-throw',
      turns: [
        {
          messages: [systemInit('sess-throw'), assistantText('sess-throw', 'before crash')],
          errorAfterMessages: new Error('stream pipe broken'),
        },
      ],
    };

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: withFake(plan),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('turn_failed');
    expect(result.errorMessage).toMatch(/stream pipe broken/);
    expect(store.get(issue.id)).toBeUndefined();
  });
});

describe('runIssueWorker — wall-clock timeout (3.6)', () => {
  it('turn exceeds turnTimeoutMs: aborts, emits turn_timed_out, exits', async () => {
    const issue = makeIssue();
    const config = makeConfig({ maxTurns: 20 });
    // Per-turn timeout effectively immediate.
    config.codebuddy = { ...config.codebuddy, turnTimeoutMs: 10 };
    const store = createWorkerHandleStore();
    const trackerHelper = makeTracker();

    const plan: ScenarioPlan = {
      sessionId: 'sess-timeout',
      turns: [
        {
          messages: [systemInit('sess-timeout'), assistantText('sess-timeout', 'starting')],
          hangAfterMessages: true,
        },
      ],
    };

    const start = Date.now();
    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: withFake(plan),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });
    const elapsed = Date.now() - start;

    expect(result.exitReason).toBe('turn_timed_out');
    expect(elapsed).toBeLessThan(2000); // sanity: didn't actually hang
    expect(trackerHelper.addedLabels).toEqual([]);
    expect(store.get(issue.id)).toBeUndefined();
  });
});

describe('runIssueWorker — external abort (3.7)', () => {
  it('SIGINT-style abort mid-turn: classifies as aborted, closes session', async () => {
    const issue = makeIssue();
    const config = makeConfig({ maxTurns: 20 });
    config.codebuddy = { ...config.codebuddy, turnTimeoutMs: 0 };
    const store = createWorkerHandleStore();
    const trackerHelper = makeTracker();

    const externalAbort = new AbortController();
    const plan: ScenarioPlan = {
      sessionId: 'sess-abort',
      turns: [
        {
          messages: [systemInit('sess-abort'), assistantText('sess-abort', 'mid')],
          hangAfterMessages: true,
        },
      ],
    };

    // Trigger the external abort shortly after the worker starts streaming.
    setTimeout(() => externalAbort.abort(), 30);

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: withFake(plan),
      abortController: externalAbort,
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('aborted');
    expect(store.get(issue.id)).toBeUndefined();
  });
});

describe('runIssueWorker — startup_failed (3.8)', () => {
  it('connect() throws: emits startup_failed, never enters loop, releases handle', async () => {
    const issue = makeIssue();
    const config = makeConfig({ maxTurns: 20 });
    const store = createWorkerHandleStore();
    const trackerHelper = makeTracker();

    const plan: ScenarioPlan = {
      sessionId: 'sess-conn',
      connectError: new Error('cli launch failed: ENOENT'),
      turns: [],
    };

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: withFake(plan),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('startup_failed');
    expect(result.errorMessage).toMatch(/cli launch failed/);
    expect(result.turnCount).toBe(0);
    expect(trackerHelper.addedLabels).toEqual([]);
    expect(store.get(issue.id)).toBeUndefined();
  });
});

describe('runIssueWorker — concurrent dispatch (3.9)', () => {
  it('three issues run three workers in parallel with distinct sessionIds, no cross-talk', async () => {
    const config = makeConfig({ maxTurns: 1 });
    const store = createWorkerHandleStore();

    function setup(label: string, finishOnTurn1: boolean) {
      const issue = makeIssue({ id: `issue-${label}`, identifier: `#${label}`, title: `T-${label}` });
      const tracker = makeTracker({
        finishLabel: 'agent-finish',
        stateSequence: finishOnTurn1
          ? [{ state: 'open', labels: ['agent-ready', 'agent-finish'] }]
          : [{ state: 'open', labels: ['agent-ready'] }],
      });
      const plan: ScenarioPlan = {
        sessionId: `sess-${label}`,
        turns: [
          {
            messages: [
              systemInit(`sess-${label}`),
              assistantText(`sess-${label}`, `${label}-turn1`),
              resultSuccess(`sess-${label}`),
            ],
          },
        ],
      };
      return { issue, tracker, plan };
    }

    const a = setup('a', true);
    const b = setup('b', true);
    const c = setup('c', false); // c will hit max_turns=1 and apply safety-net label

    const [ra, rb, rc] = await Promise.all([
      runIssueWorker({
        issue: a.issue,
        workspacePath: '/tmp/fake/a',
        config,
        tracker: a.tracker.tracker,
        handleStore: store,
        createSession: withFake(a.plan),
        now: () => new Date('2026-05-31T00:00:00.000Z'),
      }),
      runIssueWorker({
        issue: b.issue,
        workspacePath: '/tmp/fake/b',
        config,
        tracker: b.tracker.tracker,
        handleStore: store,
        createSession: withFake(b.plan),
        now: () => new Date('2026-05-31T00:00:00.000Z'),
      }),
      runIssueWorker({
        issue: c.issue,
        workspacePath: '/tmp/fake/c',
        config,
        tracker: c.tracker.tracker,
        handleStore: store,
        createSession: withFake(c.plan),
        now: () => new Date('2026-05-31T00:00:00.000Z'),
      }),
    ]);

    expect(ra.sessionId).toBe('sess-a');
    expect(rb.sessionId).toBe('sess-b');
    expect(rc.sessionId).toBe('sess-c');
    expect(new Set([ra.sessionId, rb.sessionId, rc.sessionId]).size).toBe(3);

    expect(ra.exitReason).toBe('finish_label_observed');
    expect(rb.exitReason).toBe('finish_label_observed');
    expect(rc.exitReason).toBe('max_turns_reached');

    expect(a.tracker.addedLabels).toEqual([]);
    expect(b.tracker.addedLabels).toEqual([]);
    expect(c.tracker.addedLabels).toEqual(['agent-finish']);

    expect(store.get(a.issue.id)).toBeUndefined();
    expect(store.get(b.issue.id)).toBeUndefined();
    expect(store.get(c.issue.id)).toBeUndefined();
  });
});

describe('runIssueWorker — config reload (3.10)', () => {
  it('worker reads new agent.maxTurns at next turn boundary', async () => {
    const issue = makeIssue();
    // Initial config: maxTurns 5; we will lower to 2 after turn 1.
    const initialConfig = makeConfig({ maxTurns: 5 });
    let liveConfig: ServiceConfig = initialConfig;
    const store = createWorkerHandleStore();

    const trackerHelper = makeTracker({
      stateSequence: Array.from({ length: 5 }, () => ({
        state: 'open',
        labels: ['agent-ready'],
      })),
    });

    const plan: ScenarioPlan = {
      sessionId: 'sess-reload',
      turns: Array.from({ length: 5 }, (_, i) => ({
        messages: [
          ...(i === 0 ? [systemInit('sess-reload')] : []),
          assistantText('sess-reload', `turn ${i + 1}`),
          resultSuccess('sess-reload'),
        ],
      })),
    };

    // After we observe one tracker fetch (= turn 1 boundary), reload to maxTurns=2.
    let originalFetch = trackerHelper.tracker.fetchIssueStatesByIds;
    trackerHelper.tracker.fetchIssueStatesByIds = async (ids: string[]) => {
      const r = await originalFetch.call(trackerHelper.tracker, ids);
      // Reload after turn 1's re-check returns.
      liveConfig = { ...liveConfig, agent: { ...liveConfig.agent, maxTurns: 2 } };
      return r;
    };

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      // initial config snapshot (used for non-mutable fields)
      config: initialConfig,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: withFake(plan),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
      getConfig: () => liveConfig,
    });

    expect(result.exitReason).toBe('max_turns_reached');
    expect(result.turnCount).toBe(2);
    expect(trackerHelper.addedLabels).toEqual(['agent-finish']);
    expect(store.get(issue.id)).toBeUndefined();
  });
});
