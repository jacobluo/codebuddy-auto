import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEventBus, createServerStateController, startStatusServer } from '../../src/logging/index.js';
import { DEFAULT_SERVICE_CONFIG, type Issue, type OrchestratorRuntimeState } from '../../src/spec/index.js';
import {
  type DashboardEventLogEntry,
  type DashboardEventLogInput,
  type HistoricalIssueSummary,
  createDisabledTranscriptStore,
  type TranscriptEvent,
  type TranscriptEventInput,
  type TranscriptSession,
  type TranscriptSessionInput,
  type TranscriptStore,
} from '../../src/transcript/index.js';
import type { Tracker } from '../../src/tracker/index.js';

class NoopTracker implements Tracker {
  async fetchCandidateIssues(): Promise<Issue[]> {
    return [];
  }

  async fetchIssuesByStates(): Promise<Issue[]> {
    return [];
  }

  async fetchIssueStatesByIds(): Promise<Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>> {
    return new Map();
  }
}

function createState(): OrchestratorRuntimeState {
  return {
    running: {},
    claimed: new Set(),
    retryAttempts: {},
    runners: {},
    completed: new Set(),
    progress: {},
    stuck: {},
  };
}

function createSnapshot() {
  return {
    generatedAt: '2026-05-23T00:00:02Z',
    counts: { running: 1, retrying: 0, claimed: 0, completed: 0 },
    running: [
      {
        issueId: '1',
        identifier: '#1',
        title: 'Issue One',
        sessionId: 'session-1',
        turnCount: 1,
        lastEvent: 'turn_completed',
        lastEventAt: '2026-05-23T00:00:01Z',
        secondsRunning: 1,
        workspacePath: '/tmp/_1',
        tokenUsage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          creditCost: 0,
        },
      },
    ],
    retrying: [],
    progress: [],
    stuck: [],
    totals: {
      secondsRunning: 1,
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      creditCost: 0,
    },
    cleanedWorkspaceIssueIds: [],
    completedIssueIds: [],
  };
}

function createController() {
  const state = createState();
  state.running['1'] = {
    issue: {
      id: '1',
      identifier: '#1',
      title: 'Issue One',
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
    workspacePath: '/tmp/_1',
    sessionId: 'session-1',
    startedAt: '2026-05-23T00:00:00Z',
    turnCount: 1,
    lastEvent: 'turn_completed',
    lastEventAt: '2026-05-23T00:00:01Z',
    secondsRunning: 1,
    tokenUsage: {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      creditCost: 0,
    },
    lastReportedTotals: {
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  };

  const snapshot = createSnapshot();
  const controller = createServerStateController({
    state,
    config: DEFAULT_SERVICE_CONFIG,
    tracker: new NoopTracker(),
    getSnapshotJson: () => JSON.stringify(snapshot),
    getIssueJson: (identifier) =>
      identifier === '#1'
        ? JSON.stringify({ issueIdentifier: '#1', status: 'running', workspace: { path: '/tmp/_1' } })
        : identifier === '1'
          ? JSON.stringify({ issueId: '1', issueIdentifier: '#1', status: 'running', workspace: { path: '/tmp/_1' } })
        : null,
  });

  return {
    controller,
    snapshot,
  };
}

function createTranscriptStoreFixture(): TranscriptStore {
  const sessions: TranscriptSession[] = [];
  const events: TranscriptEvent[] = [];
  const dashboardEvents: DashboardEventLogEntry[] = [];
  const store: TranscriptStore = {
    recordSession(input: TranscriptSessionInput): TranscriptSession {
      const now = '2026-05-23T00:00:00.000Z';
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
        createdAt: `2026-05-23T00:00:0${events.length}.000Z`,
      };
      events.push(event);
      return event;
    },
    listEvents(issueId: string, options = {}): TranscriptEvent[] {
      const after = options.after ?? 0;
      const limit = options.limit ?? 200;
      return events.filter((event) => event.issueId === issueId && event.id > after).slice(0, limit);
    },
    recordDashboardEvent(input: DashboardEventLogInput): DashboardEventLogEntry {
      const event = { ...input };
      dashboardEvents.push(event);
      return event;
    },
    listDashboardEvents(options = {}): DashboardEventLogEntry[] {
      const after = options.after ?? 0;
      const limit = options.limit ?? 200;
      return dashboardEvents
        .filter((event) => event.id > after && (!options.issueId || event.issueId === options.issueId))
        .slice(0, limit);
    },
    listHistoricalIssues(options = {}): HistoricalIssueSummary[] {
      const after = options.after ?? 0;
      const limit = options.limit ?? 50;
      const issueIds = new Set<string>();
      for (const session of sessions) {
        issueIds.add(session.issueId);
      }
      for (const event of events) {
        issueIds.add(event.issueId);
      }
      for (const event of dashboardEvents) {
        if (event.issueId) {
          issueIds.add(event.issueId);
        }
      }

      return [...issueIds].map((issueId): HistoricalIssueSummary => {
        const issueSessions = sessions.filter((session) => session.issueId === issueId);
        const issueEvents = events.filter((event) => event.issueId === issueId);
        const issueDashboardEvents = dashboardEvents.filter((event) => event.issueId === issueId);
        const timestamps = [
          ...issueSessions.map((session) => session.updatedAt),
          ...issueEvents.map((event) => event.createdAt),
          ...issueDashboardEvents.map((event) => event.timestamp),
        ].sort();
        const title = issueSessions.at(-1)?.issueTitle ?? `#${issueId}`;
        return {
          issueId,
          identifier: `#${issueId}`,
          title,
          lastObservedAt: timestamps.at(-1) ?? '1970-01-01T00:00:00.000Z',
          sessionCount: issueSessions.length,
          transcriptEventCount: issueEvents.length,
          dashboardEventCount: issueDashboardEvents.length,
          source: issueSessions.length > 0 || issueEvents.length > 0 ? 'transcript' : 'dashboard_event',
        };
      })
        .sort((left, right) => right.lastObservedAt.localeCompare(left.lastObservedAt) || left.issueId.localeCompare(right.issueId))
        .slice(after, after + limit);
    },
    hasIssueHistory(issueId: string): boolean {
      return sessions.some((session) => session.issueId === issueId)
        || events.some((event) => event.issueId === issueId)
        || dashboardEvents.some((event) => event.issueId === issueId);
    },
    getLatestDashboardEventId(): number {
      return dashboardEvents.at(-1)?.id ?? 0;
    },
    getNextTurnIndex(issueId: string): number {
      const turnIndexes = events
        .filter((event) => event.issueId === issueId && event.turnIndex !== undefined)
        .map((event) => event.turnIndex ?? 0);
      return Math.max(0, ...turnIndexes) + 1;
    },
    close() {
      return;
    },
  };

  const session = store.recordSession({
    issueId: '1',
    issueTitle: 'Issue One',
    workspacePath: '/tmp/_1',
    provider: 'sdk',
  });
  store.recordEvent({
    sessionId: session.id,
    issueId: '1',
    turnIndex: 1,
    sequence: 1,
    role: 'user',
    eventType: 'prompt',
    text: 'first',
    payload: { prompt: 'first' },
  });
  store.recordEvent({
    sessionId: session.id,
    issueId: '1',
    turnIndex: 1,
    sequence: 2,
    role: 'assistant',
    eventType: 'message',
    text: 'second',
    payload: { type: 'assistant' },
  });
  store.recordEvent({
    sessionId: session.id,
    issueId: '1',
    turnIndex: 2,
    sequence: 1,
    role: 'result',
    eventType: 'turn_completed',
    payload: { durationMs: 12 },
  });
  store.recordDashboardEvent({
    id: 7,
    type: 'issue_event',
    issueId: '1',
    timestamp: '2026-05-23T00:00:07.000Z',
    payload: { event: 'tool_call', tool: 'read_file' },
  });
  store.recordDashboardEvent({
    id: 8,
    type: 'issue_event',
    issueId: '1',
    timestamp: '2026-05-23T00:00:08.000Z',
    payload: { event: 'tool_result', ok: true },
  });

  const historicalSession = store.recordSession({
    issueId: '4',
    issueTitle: '历史任务',
    workspacePath: '/tmp/_4',
    provider: 'sdk',
  });
  store.recordEvent({
    sessionId: historicalSession.id,
    issueId: '4',
    turnIndex: 1,
    sequence: 1,
    role: 'assistant',
    eventType: 'message',
    text: '历史 transcript',
    payload: { type: 'assistant' },
  });
  store.recordDashboardEvent({
    id: 9,
    type: 'issue_event',
    issueId: '4',
    timestamp: '2026-05-23T00:00:09.000Z',
    payload: { event: 'turn_completed' },
  });
  return store;
}

async function createDashboardFixture(): Promise<() => Promise<void>> {
  const dashboardRoot = fileURLToPath(new URL('../../dist/dashboard', import.meta.url));
  await rm(dashboardRoot, { recursive: true, force: true });
  await mkdir(path.join(dashboardRoot, 'assets'), { recursive: true });
  await writeFile(
    path.join(dashboardRoot, 'index.html'),
    '<!doctype html><html lang="en"><body><div id="root">fixture shell</div><script type="module" src="/assets/app.js"></script></body></html>',
    'utf8',
  );
  await writeFile(path.join(dashboardRoot, 'assets/app.js'), 'console.log("fixture asset");', 'utf8');

  return async () => {
    await rm(dashboardRoot, { recursive: true, force: true });
  };
}

async function removeDashboardFixture(): Promise<void> {
  const dashboardRoot = fileURLToPath(new URL('../../dist/dashboard', import.meta.url));
  await rm(dashboardRoot, { recursive: true, force: true });
}

function createSseReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async next(): Promise<Record<string, string>> {
      while (!buffer.includes('\n\n')) {
        const result = await reader.read();
        if (result.done) {
          throw new Error('expected SSE event before stream closed');
        }
        buffer += decoder.decode(result.value, { stream: true });
      }

      const separatorIndex = buffer.indexOf('\n\n');
      const chunk = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const fields: Record<string, string> = {};
      for (const line of chunk.split('\n')) {
        if (!line || line.startsWith(':')) {
          continue;
        }

        const [name, ...rest] = line.split(':');
        if (!name) {
          continue;
        }
        fields[name] = rest.join(':').trimStart();
      }

      return fields;
    },
    async close(): Promise<void> {
      await reader.cancel();
    },
  };
}

describe('startStatusServer', () => {
  it('reports a clear error when the configured dashboard port is already in use', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();

    const firstServer = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
    );

    try {
      const address = firstServer.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }
      const port = Number.parseInt(new URL(address).port, 10);

      await expect(startStatusServer(
        {
          ...DEFAULT_SERVICE_CONFIG,
          server: {
            host: '127.0.0.1',
            port,
          },
        },
        controller,
      )).rejects.toThrow(`dashboard server port 127.0.0.1:${port} is already in use`);
    } finally {
      await firstServer.close();
      await cleanupFixture();
    }
  });

  it('serves the dashboard SPA shell and static assets from disk', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();

    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const dashboardResponse = await fetch(address);
      expect(dashboardResponse.status).toBe(200);
      expect(dashboardResponse.headers.get('content-type')).toContain('text/html');
      const dashboardHtml = await dashboardResponse.text();
      expect(dashboardHtml).toContain('fixture shell');
      expect(dashboardHtml).toContain('/assets/app.js');

      const assetResponse = await fetch(`${address}/assets/app.js`);
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get('content-type')).toContain('javascript');
      expect(await assetResponse.text()).toContain('fixture asset');
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });

  it('returns clear errors when dashboard assets are missing', async () => {
    await removeDashboardFixture();
    const { controller } = createController();

    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const shellResponse = await fetch(address);
      expect(shellResponse.status).toBe(503);
      await expect(shellResponse.json()).resolves.toEqual({
        error: {
          code: 'dashboard_assets_missing',
          message: 'dashboard frontend assets are missing; run the dashboard build first',
        },
      });

      const assetResponse = await fetch(`${address}/assets/missing.js`);
      expect(assetResponse.status).toBe(404);
      await expect(assetResponse.json()).resolves.toEqual({
        error: {
          code: 'not_found',
          message: 'unsupported route: /assets/missing.js',
        },
      });
    } finally {
      await server.close();
      await removeDashboardFixture();
    }
  });

  it('serves bootstrap, state, issue, and refresh endpoints for the dashboard SPA', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller, snapshot } = createController();

    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const bootstrapResponse = await fetch(`${address}/api/v1/dashboard/bootstrap`);
      expect(bootstrapResponse.status).toBe(200);
      expect(await bootstrapResponse.json()).toEqual({
        config: {
          tracker: {
            kind: 'cnb',
            projectSlug: 'repo/demo',
          },
          polling: {
            intervalMs: 30000,
          },
          agent: {
            maxConcurrentAgents: 10,
            maxTurns: 20,
          },
          worker: {
            kind: 'local',
          },
          workspace: {
            mode: 'directory',
          },
        },
        repoUrl: 'https://cnb.cool/repo/demo',
        serverTime: expect.any(String),
        snapshot,
      });

      const stateResponse = await fetch(`${address}/api/v1/state`);
      expect(stateResponse.status).toBe(200);
      expect(await stateResponse.json()).toEqual(snapshot);

      const issueResponse = await fetch(`${address}/api/v1/%231`);
      expect(issueResponse.status).toBe(200);
      expect(await issueResponse.json()).toEqual({ issueIdentifier: '#1', status: 'running', workspace: { path: '/tmp/_1' } });

      const missingResponse = await fetch(`${address}/api/v1/%23missing`);
      expect(missingResponse.status).toBe(404);

      const refreshPromise = controller.waitForNextRefresh();
      const refreshResponse = await fetch(`${address}/api/v1/refresh`, { method: 'POST' });
      expect(refreshResponse.status).toBe(202);
      expect(await refreshResponse.json()).toEqual({
        queued: true,
        requestedAt: expect.any(String),
        operations: ['poll', 'reconcile'],
      });
      await refreshPromise;
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });

  it('serves paginated issue transcript events from the transcript store', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();
    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
      undefined,
      createTranscriptStoreFixture(),
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const response = await fetch(`${address}/api/v1/issues/1/transcript?after=1&limit=1`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        issueId: '1',
        events: [
          {
            id: 2,
            sessionId: 1,
            issueId: '1',
            turnIndex: 1,
            sequence: 2,
            role: 'assistant',
            eventType: 'message',
            text: 'second',
            payload: { type: 'assistant' },
            createdAt: '2026-05-23T00:00:01.000Z',
          },
        ],
        nextAfter: 2,
      });
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });

  it('serves historical issue summaries from the transcript store', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();
    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
      undefined,
      createTranscriptStoreFixture(),
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const response = await fetch(`${address}/api/v1/issues/history?limit=1`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        issues: [
          {
            issueId: '4',
            identifier: '#4',
            title: '历史任务',
            lastObservedAt: '2026-05-23T00:00:09.000Z',
            sessionCount: 1,
            transcriptEventCount: 1,
            dashboardEventCount: 1,
            source: 'transcript',
          },
        ],
        nextAfter: 1,
      });
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });

  it('serves transcripts for historical issues absent from the runtime snapshot', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();
    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
      undefined,
      createTranscriptStoreFixture(),
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const response = await fetch(`${address}/api/v1/issues/4/transcript`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        issueId: '4',
        events: [
          {
            issueId: '4',
            role: 'assistant',
            eventType: 'message',
            text: '历史 transcript',
          },
        ],
      });
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });

  it('returns explicit transcript errors for unknown issues and disabled storage', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();
    const config = {
      ...DEFAULT_SERVICE_CONFIG,
      server: {
        host: '127.0.0.1',
        port: 0,
      },
    };
    const enabledServer = await startStatusServer(config, controller, undefined, createTranscriptStoreFixture());
    const disabledServer = await startStatusServer(config, controller, undefined, createDisabledTranscriptStore());

    try {
      const enabledAddress = enabledServer.address();
      const disabledAddress = disabledServer.address();
      if (!enabledAddress || !disabledAddress) {
        throw new Error('expected bound status server addresses');
      }

      const missingResponse = await fetch(`${enabledAddress}/api/v1/issues/missing/transcript`);
      expect(missingResponse.status).toBe(404);
      await expect(missingResponse.json()).resolves.toEqual({
        error: {
          code: 'transcript_not_found',
          message: 'unknown transcript issue: missing',
        },
      });

      const disabledResponse = await fetch(`${disabledAddress}/api/v1/issues/1/transcript`);
      expect(disabledResponse.status).toBe(503);
      await expect(disabledResponse.json()).resolves.toEqual({
        error: {
          code: 'transcript_unavailable',
          message: 'transcript store is disabled',
        },
      });

      const historyResponse = await fetch(`${disabledAddress}/api/v1/issues/history`);
      expect(historyResponse.status).toBe(503);
      await expect(historyResponse.json()).resolves.toEqual({
        error: {
          code: 'issue_history_unavailable',
          message: 'transcript store is disabled',
        },
      });
    } finally {
      await enabledServer.close();
      await disabledServer.close();
      await cleanupFixture();
    }
  });

  it('serves persisted dashboard event history with cursor and issue filters', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();
    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
      undefined,
      createTranscriptStoreFixture(),
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const response = await fetch(`${address}/api/v1/events/history?issueId=1&after=7&limit=1`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        events: [
          {
            id: 8,
            type: 'issue_event',
            issueId: '1',
            timestamp: '2026-05-23T00:00:08.000Z',
            payload: { event: 'tool_result', ok: true },
          },
        ],
        nextAfter: 8,
      });
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });

  it('returns explicit dashboard event history errors when storage is disabled', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();
    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
      undefined,
      createDisabledTranscriptStore(),
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const response = await fetch(`${address}/api/v1/events/history?issueId=1`);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'event_history_unavailable',
          message: 'transcript store is disabled',
        },
      });
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });

  it('emits the stable dashboard SSE envelope for snapshot and live events', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller, snapshot } = createController();
    const eventBus = createEventBus();

    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
      eventBus,
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const sseResponse = await fetch(`${address}/api/v1/events`);
      expect(sseResponse.status).toBe(200);
      if (!sseResponse.body) {
        throw new Error('expected SSE body');
      }

      const sse = createSseReader(sseResponse.body);
      const snapshotEvent = await sse.next();
      expect(snapshotEvent.event).toBe('state_snapshot');
      if (!snapshotEvent.data) {
        throw new Error('expected state snapshot payload');
      }
      expect(JSON.parse(snapshotEvent.data)).toEqual({
        type: 'state_snapshot',
        timestamp: snapshot.generatedAt,
        payload: snapshot,
      });

      eventBus.emit({
        type: 'issue_event',
        issueId: '1',
        timestamp: '2026-05-23T00:00:03Z',
        payload: {
          event: 'tool_call',
          tool: 'read_file',
        },
      });

      const issueEvent = await sse.next();
      expect(issueEvent.id).toBe('1');
      expect(issueEvent.event).toBe('issue_event');
      if (!issueEvent.data) {
        throw new Error('expected issue event payload');
      }
      expect(JSON.parse(issueEvent.data)).toEqual({
        id: 1,
        type: 'issue_event',
        issueId: '1',
        timestamp: '2026-05-23T00:00:03Z',
        payload: {
          event: 'tool_call',
          tool: 'read_file',
        },
      });

      await sse.close();
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });

  it('filters SSE live events by issueId query parameter', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();
    const eventBus = createEventBus();

    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
      eventBus,
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const sseResponse = await fetch(`${address}/api/v1/events?issueId=1`);
      expect(sseResponse.status).toBe(200);
      if (!sseResponse.body) {
        throw new Error('expected SSE body');
      }

      const sse = createSseReader(sseResponse.body);
      eventBus.emit({
        type: 'issue_event',
        issueId: '2',
        timestamp: '2026-05-23T00:00:03Z',
        payload: { event: 'ignored' },
      });
      eventBus.emit({
        type: 'state_snapshot',
        timestamp: '2026-05-23T00:00:04Z',
        payload: { generatedAt: '2026-05-23T00:00:04Z' },
      });
      eventBus.emit({
        type: 'issue_event',
        issueId: '1',
        timestamp: '2026-05-23T00:00:05Z',
        payload: { event: 'included' },
      });

      const issueEvent = await sse.next();
      expect(issueEvent.event).toBe('issue_event');
      if (!issueEvent.data) {
        throw new Error('expected issue event payload');
      }
      expect(JSON.parse(issueEvent.data)).toEqual({
        id: 3,
        type: 'issue_event',
        issueId: '1',
        timestamp: '2026-05-23T00:00:05Z',
        payload: { event: 'included' },
      });

      await sse.close();
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });

  it('streams progress-gate issue events over SSE', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();
    const eventBus = createEventBus();

    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
      eventBus,
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const sseResponse = await fetch(`${address}/api/v1/events?issueId=1`);
      expect(sseResponse.status).toBe(200);
      if (!sseResponse.body) {
        throw new Error('expected SSE body');
      }

      const sse = createSseReader(sseResponse.body);
      eventBus.emit({
        type: 'issue_event',
        issueId: '1',
        timestamp: '2026-05-23T00:00:05Z',
        payload: {
          event: 'progress_fingerprint_recorded',
          repeatedCount: 2,
          stuck: false,
        },
      });
      eventBus.emit({
        type: 'issue_event',
        issueId: '1',
        timestamp: '2026-05-23T00:00:06Z',
        payload: {
          event: 'issue_stuck',
          reason: 'no_progress',
          repeatedCount: 3,
        },
      });

      const progressEvent = await sse.next();
      expect(progressEvent.event).toBe('issue_event');
      if (!progressEvent.data) {
        throw new Error('expected progress event payload');
      }
      expect(JSON.parse(progressEvent.data)).toEqual({
        id: 1,
        type: 'issue_event',
        issueId: '1',
        timestamp: '2026-05-23T00:00:05Z',
        payload: {
          event: 'progress_fingerprint_recorded',
          repeatedCount: 2,
          stuck: false,
        },
      });

      const stuckEvent = await sse.next();
      expect(stuckEvent.event).toBe('issue_event');
      if (!stuckEvent.data) {
        throw new Error('expected stuck event payload');
      }
      expect(JSON.parse(stuckEvent.data)).toEqual({
        id: 2,
        type: 'issue_event',
        issueId: '1',
        timestamp: '2026-05-23T00:00:06Z',
        payload: {
          event: 'issue_stuck',
          reason: 'no_progress',
          repeatedCount: 3,
        },
      });

      await sse.close();
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });

  it('replays SSE history after Last-Event-ID without sending the initial snapshot', async () => {
    const cleanupFixture = await createDashboardFixture();
    const { controller } = createController();
    const eventBus = createEventBus();

    eventBus.emit({
      type: 'issue_event',
      issueId: '1',
      timestamp: '2026-05-23T00:00:03Z',
      payload: { event: 'old' },
    });
    eventBus.emit({
      type: 'issue_event',
      issueId: '1',
      timestamp: '2026-05-23T00:00:04Z',
      payload: { event: 'replay-me' },
    });

    const server = await startStatusServer(
      {
        ...DEFAULT_SERVICE_CONFIG,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
      },
      controller,
      eventBus,
    );

    try {
      const address = server.address();
      if (!address) {
        throw new Error('expected bound status server address');
      }

      const sseResponse = await fetch(`${address}/api/v1/events`, {
        headers: {
          'Last-Event-ID': '1',
        },
      });
      expect(sseResponse.status).toBe(200);
      if (!sseResponse.body) {
        throw new Error('expected SSE body');
      }

      const sse = createSseReader(sseResponse.body);
      const replayedEvent = await sse.next();

      expect(replayedEvent.id).toBe('2');
      expect(replayedEvent.event).toBe('issue_event');
      if (!replayedEvent.data) {
        throw new Error('expected replayed payload');
      }
      expect(JSON.parse(replayedEvent.data)).toEqual({
        id: 2,
        type: 'issue_event',
        issueId: '1',
        timestamp: '2026-05-23T00:00:04Z',
        payload: { event: 'replay-me' },
      });

      await sse.close();
    } finally {
      await server.close();
      await cleanupFixture();
    }
  });
});
