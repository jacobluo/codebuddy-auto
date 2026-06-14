/**
 * Local-mode dispatch tests — exercise `runDispatchCycle` through its new
 * `localDeps` path that uses `dispatchLocalIssue` + `runIssueWorker`. The
 * legacy SDK-via-`runCodebuddyTurn` path stays covered by the original
 * `run-dispatch-cycle.test.ts`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Issue, ServiceConfig } from '../../src/spec/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';
import { createRuntimeState, runDispatchCycle } from '../../src/scheduler/index.js';
import type {
  TranscriptEvent,
  TranscriptEventInput,
  TranscriptSession,
  TranscriptSessionInput,
  TranscriptStore,
} from '../../src/transcript/index.js';
import type { Tracker } from '../../src/tracker/index.js';
import { createWorkerHandleStore } from '../../src/worker/index.js';
import {
  assistantText,
  createFakeSdk,
  resultSuccess,
  systemInit,
  type ScenarioPlan,
} from '../worker/fake-sdk.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeWorkspaceRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-local-dispatch-'));
  tempDirs.push(root);
  return root;
}

function makeConfig(workspaceRoot: string): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    workspace: { ...DEFAULT_SERVICE_CONFIG.workspace, root: workspaceRoot, sourceRoot: workspaceRoot },
    agent: { ...DEFAULT_SERVICE_CONFIG.agent, maxTurns: 1, maxConcurrentAgents: 5 },
  };
}

function makeStubTracker(issue: Issue): Tracker {
  let snapshot = { id: issue.id, state: issue.state, labels: issue.labels };
  return {
    async fetchCandidateIssues() {
      return [issue];
    },
    async fetchIssuesByStates() {
      return [];
    },
    async fetchIssueStatesByIds(ids) {
      const m = new Map<string, { id: string; state: string; labels: string[] }>();
      for (const id of ids) {
        if (id === issue.id) m.set(id, snapshot);
      }
      return m;
    },
    async addLabel(_id, label) {
      snapshot = { ...snapshot, labels: [...snapshot.labels, label] };
    },
    getFinishLabel() {
      return 'agent-finish';
    },
  };
}

function createRecordingTranscriptStore(): {
  store: TranscriptStore;
  events: TranscriptEvent[];
} {
  const sessions: TranscriptSession[] = [];
  const events: TranscriptEvent[] = [];
  return {
    events,
    store: {
      recordSession(input: TranscriptSessionInput): TranscriptSession {
        const now = '2026-05-31T00:00:00.000Z';
        const session = {
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
        const event = {
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
      listHistoricalIssues() {
        return [];
      },
      hasIssueHistory() {
        return false;
      },
      getLatestDashboardEventId() {
        return 0;
      },
      getNextTurnIndex(issueId: string) {
        const turnIndexes = events
          .filter((event) => event.issueId === issueId && event.turnIndex !== undefined)
          .map((event) => event.turnIndex ?? 0);
        return Math.max(0, ...turnIndexes) + 1;
      },
      close() {
        return;
      },
    },
  };
}

describe('runDispatchCycle — local mode (§5.5)', () => {
  it('does NOT spawn a second worker for an already-running issue', async () => {
    const workspaceRoot = makeWorkspaceRoot();
    const issue: Issue = {
      id: 'iss-1',
      identifier: '#iss-1',
      title: 'Already running',
      description: 'desc',
      priority: null,
      state: 'open',
      branchName: null,
      url: null,
      labels: ['agent-ready'],
      blockedBy: [],
      createdAt: null,
      updatedAt: null,
    };
    const tracker = makeStubTracker(issue);

    const config = makeConfig(workspaceRoot);
    const state = createRuntimeState();
    const handleStore = createWorkerHandleStore();

    const plan: ScenarioPlan = {
      sessionId: 'sess-1',
      turns: [
        { messages: [systemInit('sess-1'), assistantText('sess-1', 'turn1'), resultSuccess('sess-1')] },
      ],
    };
    const sessionsCreated: number[] = [];
    let nextId = 0;
    const fake = createFakeSdk(plan);
    const createSession = (opts: Parameters<typeof fake.createSession>[0]) => {
      sessionsCreated.push(++nextId);
      return fake.createSession(opts);
    };

    const r1 = await runDispatchCycle(
      state,
      tracker,
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      { handleStore, createSession },
    );
    expect(r1.dispatchableIssueIds).toEqual([issue.id]);
    expect(r1.workerPromises).toHaveLength(1);
    expect(state.running[issue.id]).toBeDefined();

    const r2 = await runDispatchCycle(
      state,
      tracker,
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      { handleStore, createSession },
    );
    expect(r2.dispatchableIssueIds).toEqual([]);
    expect(r2.workerPromises).toEqual([]);

    await Promise.all(r1.workerPromises ?? []);
    expect(sessionsCreated).toEqual([1]);
  });

  it('passes transcript storage into the local SDK worker', async () => {
    const workspaceRoot = makeWorkspaceRoot();
    const issue: Issue = {
      id: 'iss-transcript',
      identifier: '#iss-transcript',
      title: 'Record transcript',
      description: 'desc',
      priority: null,
      state: 'open',
      branchName: null,
      url: null,
      labels: ['agent-ready'],
      blockedBy: [],
      createdAt: null,
      updatedAt: null,
    };
    const transcript = createRecordingTranscriptStore();
    const config = makeConfig(workspaceRoot);
    const state = createRuntimeState();
    const handleStore = createWorkerHandleStore();
    const fake = createFakeSdk({
      sessionId: 'sess-transcript',
      turns: [
        { messages: [systemInit('sess-transcript'), assistantText('sess-transcript', 'stored'), resultSuccess('sess-transcript')] },
      ],
    });

    const result = await runDispatchCycle(
      state,
      makeStubTracker(issue),
      config,
      'Prompt for {{ issue.identifier }}',
      undefined,
      undefined,
      undefined,
      {
        handleStore,
        createSession: (opts) => fake.createSession(opts),
        transcriptStore: transcript.store,
      },
    );

    await Promise.all(result.workerPromises ?? []);
    expect(transcript.events.map((event) => event.eventType)).toContain('prompt');
    expect(transcript.events.map((event) => event.text)).toContain('stored');
  });
});
