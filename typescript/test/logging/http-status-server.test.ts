import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEventBus, createServerStateController, startStatusServer } from '../../src/logging/index.js';
import { DEFAULT_SERVICE_CONFIG, type Issue, type OrchestratorRuntimeState } from '../../src/spec/index.js';
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
        : null,
  });

  return {
    controller,
    snapshot,
  };
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
