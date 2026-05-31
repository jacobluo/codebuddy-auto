import { describe, expect, it } from 'vitest';

import { startStatusServer, createServerStateController } from '../../src/logging/index.js';
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

describe('startStatusServer', () => {
  it('serves dashboard html plus state and issue endpoints plus refresh trigger', async () => {
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

    const controller = createServerStateController({
      state,
      config: DEFAULT_SERVICE_CONFIG,
      tracker: new NoopTracker(),
      getSnapshotJson: () => JSON.stringify({ generatedAt: 'now', counts: { running: 1, retrying: 0, claimed: 0, completed: 0 }, running: [], retrying: [], totals: {}, cleanedWorkspaceIssueIds: [], completedIssueIds: [] }),
      getIssueJson: (identifier) => identifier === '#1'
        ? JSON.stringify({ issueIdentifier: '#1', status: 'running', workspace: { path: '/tmp/_1' } })
        : null,
    });

    const server = await startStatusServer({
      ...DEFAULT_SERVICE_CONFIG,
      server: {
        host: '127.0.0.1',
        port: 0,
      },
    }, controller);

    const address = server.address();
    if (!address) {
      throw new Error('expected bound status server address');
    }

    const dashboardResponse = await fetch(address);
    expect(dashboardResponse.status).toBe(200);
    const dashboardHtml = await dashboardResponse.text();
    expect(dashboardHtml).toContain('codebuddy-auto dashboard');
    expect(dashboardHtml).toContain('/api/v1/events');

    const stateResponse = await fetch(`${address}/api/v1/state`);
    expect(stateResponse.status).toBe(200);
    expect(await stateResponse.json()).toEqual({ generatedAt: 'now', counts: { running: 1, retrying: 0, claimed: 0, completed: 0 }, running: [], retrying: [], totals: {}, cleanedWorkspaceIssueIds: [], completedIssueIds: [] });

    const issueResponse = await fetch(`${address}/api/v1/%231`);
    expect(issueResponse.status).toBe(200);
    expect(await issueResponse.json()).toEqual({ issueIdentifier: '#1', status: 'running', workspace: { path: '/tmp/_1' } });

    const missingResponse = await fetch(`${address}/api/v1/%23missing`);
    expect(missingResponse.status).toBe(404);

    const refreshPromise = controller.waitForNextRefresh();
    const refreshResponse = await fetch(`${address}/api/v1/refresh`, { method: 'POST' });
    expect(refreshResponse.status).toBe(202);
    const refreshBody = await refreshResponse.json();
    expect(refreshBody.queued).toBe(true);
    expect(refreshBody.operations).toEqual(['poll', 'reconcile']);
    await refreshPromise;

    await server.close();
  });
});
