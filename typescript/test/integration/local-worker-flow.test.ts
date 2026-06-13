import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRuntimeState, runSchedulerOnce } from '../../src/scheduler/index.js';
import type { Issue, ServiceConfig } from '../../src/spec/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';
import type { Tracker } from '../../src/tracker/index.js';
import { LocalTracker } from '../../src/tracker/index.js';
import { createWorkerHandleStore } from '../../src/worker/index.js';
import { resolveWorkspacePath } from '../../src/workspace/index.js';
import {
  assistantText,
  createFakeSdk,
  resultError,
  resultSuccess,
  systemInit,
  type ScenarioPlan,
} from '../worker/fake-sdk.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    identifier: '#1',
    title: 'Offline integration issue',
    description: 'Exercise the local worker flow.',
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

function writeIssue(rootDir: string, issue: Issue): void {
  fs.writeFileSync(path.join(rootDir, `${issue.id}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8');
}

function makeConfig(workspaceRoot: string, overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    ...overrides,
    tracker: {
      ...DEFAULT_SERVICE_CONFIG.tracker,
      activeStates: ['open'],
      terminalStates: ['closed'],
      finishLabel: 'agent-finish',
      ...overrides.tracker,
    },
    workspace: {
      ...DEFAULT_SERVICE_CONFIG.workspace,
      root: workspaceRoot,
      sourceRoot: workspaceRoot,
      ...overrides.workspace,
    },
    agent: {
      ...DEFAULT_SERVICE_CONFIG.agent,
      maxConcurrentAgents: 1,
      maxTurns: 3,
      maxRetryBackoffMs: 1_000,
      ...overrides.agent,
    },
    codebuddy: {
      ...DEFAULT_SERVICE_CONFIG.codebuddy,
      turnTimeoutMs: 1_000,
      ...overrides.codebuddy,
    },
    worker: {
      ...DEFAULT_SERVICE_CONFIG.worker,
      kind: 'local',
      ...overrides.worker,
    },
  };
}

function createSessionFactory(plan: ScenarioPlan): {
  fake: ReturnType<typeof createFakeSdk>;
  createSession: ReturnType<typeof createFakeSdk>['createSession'];
} {
  const fake = createFakeSdk(plan);
  return {
    fake,
    createSession: (options) => fake.createSession(options),
  };
}

interface MutableTracker extends Tracker {
  readonly addedLabels: string[];
}

function makeMutableTracker(issue: Issue): MutableTracker {
  let currentIssue = issue;
  const addedLabels: string[] = [];

  return {
    get addedLabels() {
      return addedLabels;
    },
    async fetchCandidateIssues() {
      return currentIssue.state === 'open' && !currentIssue.labels.includes('agent-finish')
        ? [currentIssue]
        : [];
    },
    async fetchIssuesByStates(states) {
      return states.includes(currentIssue.state) ? [currentIssue] : [];
    },
    async fetchIssueStatesByIds(issueIds) {
      if (!issueIds.includes(currentIssue.id)) {
        return new Map();
      }
      return new Map([
        [currentIssue.id, {
          id: currentIssue.id,
          state: currentIssue.state,
          labels: currentIssue.labels,
        }],
      ]);
    },
    async addLabel(issueId, label) {
      if (issueId !== currentIssue.id) {
        return;
      }
      addedLabels.push(label);
      currentIssue = {
        ...currentIssue,
        labels: currentIssue.labels.includes(label)
          ? currentIssue.labels
          : [...currentIssue.labels, label],
      };
    },
    getFinishLabel() {
      return 'agent-finish';
    },
  };
}

function makeMutableTrackerPool(issues: Issue[]): MutableTracker {
  const issueMap = new Map<string, Issue>(issues.map((issue) => [issue.id, issue]));
  const addedLabels: string[] = [];

  return {
    get addedLabels() {
      return addedLabels;
    },
    async fetchCandidateIssues() {
      return issues.filter((issue) => issueMap.get(issue.id)?.state === 'open'
        && !issueMap.get(issue.id)?.labels.includes('agent-finish'));
    },
    async fetchIssuesByStates(states) {
      return issues.filter((issue) => {
        const current = issueMap.get(issue.id);
        return current ? states.includes(current.state) : false;
      });
    },
    async fetchIssueStatesByIds(issueIds) {
      const m = new Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>();
      for (const id of issueIds) {
        const issue = issueMap.get(id);
        if (!issue) {
          continue;
        }
        m.set(id, { id, state: issue.state, labels: issue.labels });
      }
      return m;
    },
    async addLabel(issueId, label) {
      const issue = issueMap.get(issueId);
      if (!issue) {
        return;
      }
      addedLabels.push(label);
      issueMap.set(issueId, {
        ...issue,
        labels: issue.labels.includes(label)
          ? issue.labels
          : [...issue.labels, label],
      });
      const updatedIssue = issueMap.get(issueId);
      const issueIndex = issues.findIndex((entry) => entry.id === issue.id);
      if (updatedIssue && issueIndex >= 0) {
        issues[issueIndex] = updatedIssue;
      }
    },
    getFinishLabel() {
      return 'agent-finish';
    },
  };
}

describe('local worker integration flow', () => {
  it('dispatches a local issue from LocalTracker through the worker and records completion', async () => {
    const issuesRoot = makeTempDir('cb-integration-issues-');
    const workspaceRoot = makeTempDir('cb-integration-workspaces-');
    const issue = makeIssue({ labels: ['agent-ready', 'agent-finish'] });
    writeIssue(issuesRoot, issue);

    const tracker = new LocalTracker({ rootDir: issuesRoot, activeStates: ['open'] });
    const config = makeConfig(workspaceRoot);
    const state = createRuntimeState();
    const handleStore = createWorkerHandleStore();
    const { fake, createSession } = createSessionFactory({
      sessionId: 'sess-local-success',
      turns: [
        {
          messages: [
            systemInit('sess-local-success'),
            assistantText('sess-local-success', 'done'),
            resultSuccess('sess-local-success'),
          ],
        },
      ],
    });

    const result = await runSchedulerOnce(state, tracker, config, {
      workerHandleStore: handleStore,
      createSession,
    });

    expect(result.dispatch.dispatchableIssueIds).toEqual([issue.id]);
    expect(result.dispatch.claimedIssueIds).toEqual([issue.id]);
    expect(result.dispatch.workerPromises).toHaveLength(1);
    expect(state.running[issue.id]).toBeDefined();

    await Promise.all(result.dispatch.workerPromises ?? []);

    expect(fake.sessions).toHaveLength(1);
    expect(fake.sessions[0]?.sentMessages[0]).toContain('Offline integration issue');
    expect(state.running[issue.id]).toBeUndefined();
    expect(state.claimed.has(issue.id)).toBe(false);
    expect(state.completed.has(issue.id)).toBe(true);
    expect(handleStore.get(issue.id)).toBeUndefined();
    expect(fs.existsSync(resolveWorkspacePath(workspaceRoot, issue.identifier))).toBe(true);
  });

  it('releases a failed local worker claim so the next scheduler tick can retry the issue', async () => {
    const workspaceRoot = makeTempDir('cb-integration-retry-workspaces-');
    const issue = makeIssue({ id: 'issue-retry', identifier: '#retry' });
    const tracker = makeMutableTracker(issue);
    const config = makeConfig(workspaceRoot, {
      agent: {
        ...DEFAULT_SERVICE_CONFIG.agent,
        maxConcurrentAgents: 1,
        maxTurns: 1,
        maxRetryBackoffMs: 1_000,
      },
    });
    const state = createRuntimeState();
    const handleStore = createWorkerHandleStore();
    const first = createSessionFactory({
      sessionId: 'sess-fail',
      turns: [
        {
          messages: [
            systemInit('sess-fail'),
            assistantText('sess-fail', 'not done'),
            resultError('sess-fail', { errors: ['boom'] }),
          ],
        },
      ],
    });

    const failedRun = await runSchedulerOnce(state, tracker, config, {
      workerHandleStore: handleStore,
      createSession: first.createSession,
    });

    await Promise.all(failedRun.dispatch.workerPromises ?? []);

    expect(state.running[issue.id]).toBeUndefined();
    expect(state.claimed.has(issue.id)).toBe(false);
    expect(state.completed.has(issue.id)).toBe(false);

    const second = createSessionFactory({
      sessionId: 'sess-retry',
      turns: [
        {
          messages: [
            systemInit('sess-retry'),
            assistantText('sess-retry', 'done on retry'),
            resultSuccess('sess-retry'),
          ],
        },
      ],
    });

    const retryRun = await runSchedulerOnce(state, tracker, config, {
      workerHandleStore: handleStore,
      createSession: second.createSession,
    });

    expect(retryRun.dispatch.dispatchableIssueIds).toEqual([issue.id]);
    await Promise.all(retryRun.dispatch.workerPromises ?? []);

    expect(second.fake.sessions).toHaveLength(1);
    expect(tracker.addedLabels).toEqual([]);
    expect(state.completed.has(issue.id)).toBe(false);
    expect(state.stuck[issue.id]?.reason).toBe('max_turns_reached');
    expect(state.claimed.has(issue.id)).toBe(false);
  });

  it('continues a local worker across turns until the finish label is observed', async () => {
    const workspaceRoot = makeTempDir('cb-integration-multiturn-workspaces-');
    const issue = makeIssue({ id: 'issue-multiturn', identifier: '#multi' });
    let snapshotFetches = 0;
    const tracker: MutableTracker = {
      addedLabels: [],
      async fetchCandidateIssues() {
        return [issue];
      },
      async fetchIssuesByStates(states) {
        return states.includes(issue.state) ? [issue] : [];
      },
      async fetchIssueStatesByIds(issueIds) {
        if (!issueIds.includes(issue.id)) {
          return new Map();
        }
        snapshotFetches += 1;
        return new Map([
          [issue.id, {
            id: issue.id,
            state: issue.state,
            labels: snapshotFetches >= 2 ? ['agent-ready', 'agent-finish'] : ['agent-ready'],
          }],
        ]);
      },
      async addLabel(_issueId, label) {
        this.addedLabels.push(label);
      },
      getFinishLabel() {
        return 'agent-finish';
      },
    };
    const config = makeConfig(workspaceRoot, {
      agent: {
        ...DEFAULT_SERVICE_CONFIG.agent,
        maxConcurrentAgents: 1,
        maxTurns: 3,
        maxRetryBackoffMs: 1_000,
      },
    });
    const state = createRuntimeState();
    const handleStore = createWorkerHandleStore();
    const { fake, createSession } = createSessionFactory({
      sessionId: 'sess-multiturn',
      turns: [
        {
          messages: [
            systemInit('sess-multiturn'),
            assistantText('sess-multiturn', 'first checkpoint'),
            resultSuccess('sess-multiturn'),
          ],
        },
        {
          messages: [
            assistantText('sess-multiturn', 'finished'),
            resultSuccess('sess-multiturn'),
          ],
        },
      ],
    });

    const result = await runSchedulerOnce(state, tracker, config, {
      workerHandleStore: handleStore,
      createSession,
    });

    expect(result.dispatch.dispatchableIssueIds).toEqual([issue.id]);
    expect(result.dispatch.workerPromises).toHaveLength(1);

    await Promise.all(result.dispatch.workerPromises ?? []);

    expect(fake.sessions).toHaveLength(1);
    expect(fake.sessions[0]?.sentMessages).toHaveLength(2);
    expect(fake.sessions[0]?.sentMessages[0]).toContain('Offline integration issue');
    expect(fake.sessions[0]?.sentMessages[1]).toContain('This is continuation turn 2');
    expect(snapshotFetches).toBe(2);
    expect(tracker.addedLabels).toEqual([]);
    expect(state.running[issue.id]).toBeUndefined();
    expect(state.completed.has(issue.id)).toBe(true);
    expect(state.claimed.has(issue.id)).toBe(false);
    expect(handleStore.get(issue.id)).toBeUndefined();
  });

  it('marks a local issue stuck after repeated no-progress fingerprints', async () => {
    const workspaceRoot = makeTempDir('cb-integration-stuck-workspaces-');
    const issue = makeIssue({ id: 'issue-stuck', identifier: '#stuck' });
    const tracker = makeMutableTracker(issue);
    const config = makeConfig(workspaceRoot, {
      agent: {
        ...DEFAULT_SERVICE_CONFIG.agent,
        maxConcurrentAgents: 1,
        maxTurns: 5,
        maxRetryBackoffMs: 1_000,
        noProgressThreshold: 2,
      },
    });
    const state = createRuntimeState();
    const handleStore = createWorkerHandleStore();
    const { fake, createSession } = createSessionFactory({
      sessionId: 'sess-stuck',
      turns: [
        {
          messages: [
            systemInit('sess-stuck'),
            assistantText('sess-stuck', 'first checkpoint'),
            resultSuccess('sess-stuck'),
          ],
        },
        {
          messages: [
            assistantText('sess-stuck', 'same state'),
            resultSuccess('sess-stuck'),
          ],
        },
        {
          messages: [
            assistantText('sess-stuck', 'should not run'),
            resultSuccess('sess-stuck'),
          ],
        },
      ],
    });

    const result = await runSchedulerOnce(state, tracker, config, {
      workerHandleStore: handleStore,
      createSession,
    });

    await Promise.all(result.dispatch.workerPromises ?? []);

    expect(fake.sessions[0]?.sentMessages).toHaveLength(2);
    expect(state.stuck[issue.id]?.reason).toBe('no_progress');
    expect(state.progress[issue.id]?.repeatedCount).toBe(2);
    expect(state.running[issue.id]).toBeUndefined();
    expect(state.completed.has(issue.id)).toBe(false);
    expect(state.claimed.has(issue.id)).toBe(false);
    expect(tracker.addedLabels).toEqual([]);
  });

  it('uses reloaded maxTurns at the next local worker turn boundary', async () => {
    const workspaceRoot = makeTempDir('cb-integration-reload-workspaces-');
    const issue = makeIssue({ id: 'issue-reload', identifier: '#reload' });
    const tracker = makeMutableTracker(issue);
    const initialConfig = makeConfig(workspaceRoot, {
      agent: {
        ...DEFAULT_SERVICE_CONFIG.agent,
        maxConcurrentAgents: 1,
        maxTurns: 3,
        maxRetryBackoffMs: 1_000,
      },
    });
    let liveConfig = initialConfig;
    const state = createRuntimeState();
    const handleStore = createWorkerHandleStore();
    const { fake, createSession } = createSessionFactory({
      sessionId: 'sess-reload',
      turns: [
        {
          messages: [
            systemInit('sess-reload'),
            assistantText('sess-reload', 'first turn'),
            resultSuccess('sess-reload'),
          ],
        },
        {
          messages: [
            assistantText('sess-reload', 'should not be sent'),
            resultSuccess('sess-reload'),
          ],
        },
      ],
    });

    const result = await runSchedulerOnce(state, tracker, initialConfig, {
      workerHandleStore: handleStore,
      createSession,
      getConfig: () => liveConfig,
    });

    liveConfig = makeConfig(workspaceRoot, {
      agent: {
        ...DEFAULT_SERVICE_CONFIG.agent,
        maxConcurrentAgents: 1,
        maxTurns: 1,
        maxRetryBackoffMs: 1_000,
      },
    });

    await Promise.all(result.dispatch.workerPromises ?? []);

    expect(fake.sessions).toHaveLength(1);
    expect(fake.sessions[0]?.sentMessages).toHaveLength(1);
    expect(tracker.addedLabels).toEqual([]);
    expect(state.completed.has(issue.id)).toBe(false);
    expect(state.stuck[issue.id]?.reason).toBe('max_turns_reached');
    expect(state.claimed.has(issue.id)).toBe(false);
  });

  it('dispatches at most maxConcurrentAgents issues per tick for local mode', async () => {
    const workspaceRoot = makeTempDir('cb-integration-concurrency-workspaces-');
    const issues = [
      makeIssue({ id: 'concurrent-1', identifier: '#c1', title: 'First issue', labels: ['agent-ready'] }),
      makeIssue({ id: 'concurrent-2', identifier: '#c2', title: 'Second issue', labels: ['agent-ready'] }),
    ];
    const tracker = makeMutableTrackerPool(issues);
    const config = makeConfig(workspaceRoot, {
      agent: {
        ...DEFAULT_SERVICE_CONFIG.agent,
        maxConcurrentAgents: 1,
        maxTurns: 1,
        maxRetryBackoffMs: 1_000,
      },
    });
    const state = createRuntimeState();
    const handleStore = createWorkerHandleStore();

    const firstSessionFactory = createSessionFactory({
      sessionId: 'sess-concurrency-a',
      turns: [
        {
          messages: [
            systemInit('sess-concurrency-a'),
            assistantText('sess-concurrency-a', 'a'),
            resultSuccess('sess-concurrency-a'),
          ],
        },
      ],
    });
    const secondSessionFactory = createSessionFactory({
      sessionId: 'sess-concurrency-b',
      turns: [
        {
          messages: [
            systemInit('sess-concurrency-b'),
            assistantText('sess-concurrency-b', 'b'),
            resultSuccess('sess-concurrency-b'),
          ],
        },
      ],
    });
    const plans = [firstSessionFactory, secondSessionFactory];
    let sessionCursor = 0;
    const createSession = (options: Parameters<typeof firstSessionFactory.createSession>[0]) => {
      const factory = plans[sessionCursor];
      if (!factory) {
        throw new Error(`Unexpected session factory index ${sessionCursor}`);
      }
      sessionCursor += 1;
      return factory.createSession(options);
    };

    const firstTick = await runSchedulerOnce(state, tracker, config, {
      workerHandleStore: handleStore,
      createSession,
    });

    expect(firstTick.dispatch.dispatchableIssueIds).toHaveLength(1);
    expect(firstTick.dispatch.workerPromises).toHaveLength(1);
    expect(Object.keys(state.running)).toHaveLength(1);

    const remainingTick = await runSchedulerOnce(state, tracker, config, {
      workerHandleStore: handleStore,
      createSession,
    });

    expect(remainingTick.dispatch.dispatchableIssueIds).toHaveLength(0);
    expect(remainingTick.dispatch.workerPromises).toHaveLength(0);

    await Promise.all(firstTick.dispatch.workerPromises ?? []);

    const secondTick = await runSchedulerOnce(state, tracker, config, {
      workerHandleStore: handleStore,
      createSession,
    });

    expect(secondTick.dispatch.dispatchableIssueIds).toHaveLength(1);
    expect(secondTick.dispatch.workerPromises).toHaveLength(1);
    await Promise.all(secondTick.dispatch.workerPromises ?? []);

    expect(firstSessionFactory.fake.sessions).toHaveLength(1);
    expect(secondSessionFactory.fake.sessions).toHaveLength(1);
    expect(state.completed.has('concurrent-1')).toBe(false);
    expect(state.completed.has('concurrent-2')).toBe(false);
    expect(state.stuck['concurrent-1']?.reason).toBe('max_turns_reached');
    expect(state.stuck['concurrent-2']?.reason).toBe('max_turns_reached');
    expect(state.claimed.has('concurrent-1')).toBe(false);
    expect(state.claimed.has('concurrent-2')).toBe(false);
  });
});
