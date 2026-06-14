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
import type {
  TranscriptEvent,
  TranscriptEventInput,
  TranscriptSession,
  TranscriptSessionInput,
  TranscriptStore,
} from '../../src/transcript/index.js';
import type { Tracker } from '../../src/tracker/index.js';
import { runIssueWorker, type IssueWorkerDeps } from '../../src/worker/run-issue-worker.js';
import { createWorkerHandleStore } from '../../src/worker/worker-handle-store.js';
import {
  assistantText,
  assistantToolUse,
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

function createRecordingTranscriptStore(): {
  store: TranscriptStore;
  sessions: TranscriptSession[];
  events: TranscriptEvent[];
} {
  const sessions: TranscriptSession[] = [];
  const events: TranscriptEvent[] = [];
  const store: TranscriptStore = {
    recordSession(input: TranscriptSessionInput): TranscriptSession {
      const now = '2026-05-31T00:00:00.000Z';
      const session: TranscriptSession = {
        id: sessions.length + 1,
        issueId: input.issueId,
        issueTitle: input.issueTitle,
        workspacePath: input.workspacePath,
        provider: input.provider,
        sdkSessionId: input.sdkSessionId,
        status: input.status ?? 'running',
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      };
      sessions.push(session);
      return session;
    },
    recordEvent(input: TranscriptEventInput): TranscriptEvent {
      const event: TranscriptEvent = {
        id: events.length + 1,
        sessionId: input.sessionId,
        issueId: input.issueId,
        turnIndex: input.turnIndex,
        sequence: input.sequence,
        role: input.role,
        eventType: input.eventType,
        text: input.text,
        payload: input.payload,
        createdAt: '2026-05-31T00:00:00.000Z',
      };
      events.push(event);
      return event;
    },
    listEvents(issueId: string): TranscriptEvent[] {
      return events.filter((event) => event.issueId === issueId);
    },
    recordDashboardEvent(input) {
      return input;
    },
    listDashboardEvents() {
      return [];
    },
    getLatestDashboardEventId() {
      return 0;
    },
    close() {
      return;
    },
  };
  return { store, sessions, events };
}

describe('runIssueWorker — happy path (3.1)', () => {
  it('records initial and continuation prompts plus SDK messages to transcript storage', async () => {
    const issue = makeIssue();
    const config = makeConfig({ maxTurns: 3 });
    const store = createWorkerHandleStore();
    const transcript = createRecordingTranscriptStore();
    const trackerHelper = makeTracker({
      stateSequence: [
        { state: 'open', labels: ['agent-ready'] },
        { state: 'open', labels: ['agent-ready', 'agent-finish'] },
      ],
    });
    const plan: ScenarioPlan = {
      sessionId: 'sess-transcript',
      turns: [
        {
          messages: [
            systemInit('sess-transcript'),
            assistantText('sess-transcript', 'turn one answer'),
            resultSuccess('sess-transcript', 111),
          ],
        },
        {
          messages: [
            assistantText('sess-transcript', 'turn two answer'),
            resultSuccess('sess-transcript', 222),
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
      initialPrompt: 'custom first prompt',
      transcriptStore: transcript.store,
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('finish_label_observed');
    expect(transcript.sessions).toMatchObject([
      {
        issueId: issue.id,
        issueTitle: issue.title,
        workspacePath: '/tmp/fake/issue-6',
        provider: 'sdk',
        sdkSessionId: 'sess-transcript',
      },
    ]);
    expect(transcript.events.map((event) => [event.turnIndex, event.role, event.eventType, event.text])).toEqual([
      [1, 'user', 'prompt', expect.stringContaining('custom first prompt')],
      [1, 'runtime', 'session_started', undefined],
      [1, 'assistant', 'message', 'turn one answer'],
      [1, 'result', 'turn_completed', undefined],
      [2, 'user', 'prompt', expect.stringContaining('continuation turn 2')],
      [2, 'assistant', 'message', 'turn two answer'],
      [2, 'result', 'turn_completed', undefined],
    ]);
  });

  it('does not persist SDK assistant messages without display text', async () => {
    const issue = makeIssue();
    const transcript = createRecordingTranscriptStore();
    const trackerHelper = makeTracker({
      stateSequence: [
        { state: 'open', labels: ['agent-ready'] },
        { state: 'open', labels: ['agent-ready', 'agent-finish'] },
      ],
    });

    await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config: makeConfig({ maxTurns: 1 }),
      tracker: trackerHelper.tracker,
      handleStore: createWorkerHandleStore(),
      createSession: withFake({
        sessionId: 'sess-empty-message',
        turns: [
          {
            messages: [
              systemInit('sess-empty-message'),
              assistantToolUse('sess-empty-message', 'Read', { file_path: 'README.md' }),
              assistantText('sess-empty-message', 'Visible worker answer'),
              resultSuccess('sess-empty-message'),
            ],
          },
        ],
      }),
      initialPrompt: 'custom first prompt',
      transcriptStore: transcript.store,
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(transcript.events.filter((event) => event.role === 'assistant').map((event) => event.text)).toEqual([
      'Visible worker answer',
    ]);
  });

  it('records SDK failure and timeout terminal events to transcript storage', async () => {
    const issue = makeIssue();
    const failureTranscript = createRecordingTranscriptStore();
    const failureResult = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config: makeConfig({ maxTurns: 2 }),
      tracker: makeTracker().tracker,
      handleStore: createWorkerHandleStore(),
      createSession: withFake({
        sessionId: 'sess-fail',
        turns: [{ messages: [{ ...resultSuccess('sess-fail'), is_error: true, subtype: 'error_during_execution', errors: ['tool failed'] }] }],
      }),
      transcriptStore: failureTranscript.store,
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(failureResult.exitReason).toBe('turn_failed');
    expect(failureTranscript.events.at(-1)).toMatchObject({
      role: 'error',
      eventType: 'turn_failed',
      text: 'tool failed',
    });

    const timeoutTranscript = createRecordingTranscriptStore();
    const timeoutResult = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config: { ...makeConfig({ maxTurns: 2 }), codebuddy: { ...DEFAULT_SERVICE_CONFIG.codebuddy, turnTimeoutMs: 10 } },
      tracker: makeTracker().tracker,
      handleStore: createWorkerHandleStore(),
      createSession: withFake({
        sessionId: 'sess-timeout',
        turns: [{ messages: [systemInit('sess-timeout'), assistantText('sess-timeout', 'still running')], hangAfterMessages: true }],
      }),
      transcriptStore: timeoutTranscript.store,
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(timeoutResult.exitReason).toBe('turn_timed_out');
    expect(timeoutTranscript.events.at(-1)).toMatchObject({
      role: 'error',
      eventType: 'turn_timed_out',
      payload: { timeoutMs: 10 },
    });
  });

  it('classifies transcript write failures as current-turn failures', async () => {
    const issue = makeIssue();
    const store = createRecordingTranscriptStore();
    store.store.recordEvent = () => {
      throw new Error('sqlite is read-only');
    };
    const workerEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config: makeConfig({ maxTurns: 2 }),
      tracker: makeTracker().tracker,
      handleStore: createWorkerHandleStore(),
      createSession: withFake({
        sessionId: 'sess-write-fail',
        turns: [{ messages: [systemInit('sess-write-fail'), resultSuccess('sess-write-fail')] }],
      }),
      transcriptStore: store.store,
      onWorkerEvent: (event) => workerEvents.push(event),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('turn_failed');
    expect(result.errorMessage).toContain('transcript write failed: sqlite is read-only');
    expect(workerEvents.at(-1)).toMatchObject({
      event: 'turn_failed',
      payload: { message: 'transcript write failed: sqlite is read-only' },
    });
  });

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
    const fake = createFakeSdk(plan);

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: (options) => fake.createSession(options),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('finish_label_observed');
    expect(result.turnCount).toBe(5);
    // No safety-net label applied (agent did the handoff itself)
    expect(trackerHelper.addedLabels).toEqual([]);
    expect(fake.sessions[0]?.closed).toBe(true);
    // Handle removed
    expect(store.get(issue.id)).toBeUndefined();
  });
});

describe('runIssueWorker — max turns (3.3)', () => {
  it('reaches maxTurns without finish_label; worker exits without applying finish label', async () => {
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
    const fake = createFakeSdk(plan);

    const result = await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: (options) => fake.createSession(options),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
    });

    expect(result.exitReason).toBe('max_turns_reached');
    expect(result.turnCount).toBe(maxTurns);
    expect(trackerHelper.addedLabels).toEqual([]);
    expect(fake.sessions[0]?.closed).toBe(true);
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
    const c = setup('c', false); // c will hit max_turns=1 without handoff

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
    expect(c.tracker.addedLabels).toEqual([]);

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
    expect(trackerHelper.addedLabels).toEqual([]);
    expect(store.get(issue.id)).toBeUndefined();
  });
});

describe('runIssueWorker — prompt template (4.2 + 4.3)', () => {
  it('initial prompt is sent verbatim with the checkpoint reminder appended; continuation guidance is sent on turn 2 and does NOT contain the original prompt', async () => {
    const issue = makeIssue();
    const config = makeConfig({ maxTurns: 20 });
    const store = createWorkerHandleStore();

    const trackerHelper = makeTracker({
      stateSequence: [
        { state: 'open', labels: ['agent-ready'] }, // after turn 1
        { state: 'open', labels: ['agent-ready', 'agent-finish'] }, // after turn 2 → exit
      ],
    });

    const fake = createFakeSdk({
      sessionId: 'sess-prompt',
      turns: [
        { messages: [systemInit('sess-prompt'), assistantText('sess-prompt', 'turn1'), resultSuccess('sess-prompt')] },
        { messages: [assistantText('sess-prompt', 'turn2'), resultSuccess('sess-prompt')] },
      ],
    });

    const initialPrompt = 'You are working on #6: 调整 README. Goals: commit, push, PR, agent-finish.';

    await runIssueWorker({
      issue,
      workspacePath: '/tmp/fake/issue-6',
      config,
      tracker: trackerHelper.tracker,
      handleStore: store,
      createSession: (opts) => fake.createSession(opts),
      now: () => new Date('2026-05-31T00:00:00.000Z'),
      initialPrompt,
    });

    const sent = fake.sessions[0]!.sentMessages;
    expect(sent).toHaveLength(2);

    // Turn 1: full task prompt + suffix
    expect(sent[0]).toContain(initialPrompt);
    expect(sent[0]).toContain('turn_completed');
    expect(sent[0]).toContain('checkpoint');

    // Turn 2: continuation guidance only — task prompt MUST NOT be resent
    expect(sent[1]).not.toContain(initialPrompt);
    expect(sent[1]).toMatch(/continuation turn 2/);
    expect(sent[1]).toMatch(/Keep going until ALL of those goals are met/);
  });
});
