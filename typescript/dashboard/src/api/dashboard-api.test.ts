import { describe, expect, it, vi } from 'vitest';

import {
  fetchDashboardBootstrap,
  fetchDashboardEventsHistory,
  fetchIssueTranscript,
  requestDashboardRefresh,
} from './dashboard-api.js';
import type {
  DashboardBootstrapPayload,
  DashboardEventsHistoryPayload,
  DashboardTranscriptPayload,
} from '../lib/dashboard-types.js';

function createBootstrapPayload(): DashboardBootstrapPayload {
  return {
    config: {
      tracker: {
        kind: 'local',
        projectSlug: null,
      },
      polling: {
        intervalMs: 1_000,
      },
      agent: {
        maxConcurrentAgents: 2,
        maxTurns: 3,
      },
      worker: {
        kind: 'ssh',
      },
      workspace: {
        mode: 'directory',
      },
    },
    repoUrl: null,
    serverTime: '2026-06-13T10:00:00.000Z',
    snapshot: {
      generatedAt: '2026-06-13T10:00:00.000Z',
      counts: {
        running: 0,
        retrying: 0,
        claimed: 0,
        completed: 0,
      },
      cleanedWorkspaceIssueIds: [],
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 0,
        secondsRunning: 0,
      },
      running: [],
      retrying: [],
      progress: [],
      stuck: [],
      completedIssueIds: [],
    },
  };
}

describe('dashboard api client', () => {
  it('fetches bootstrap data from the configured API base URL', async () => {
    const payload = createBootstrapPayload();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }));

    await expect(fetchDashboardBootstrap(fetchImpl, 'http://127.0.0.1:4317')).resolves.toEqual(payload);

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4317/api/v1/dashboard/bootstrap');
  });

  it('throws a status-specific error when bootstrap loading fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));

    await expect(fetchDashboardBootstrap(fetchImpl)).rejects.toThrow('dashboard bootstrap failed with status 503');
  });

  it('posts refresh requests and surfaces non-2xx responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));

    await expect(requestDashboardRefresh(fetchImpl, '/dashboard')).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledWith('/dashboard/api/v1/refresh', {
      method: 'POST',
    });

    const failingFetch = vi.fn(async () => new Response('nope', { status: 409 }));

    await expect(requestDashboardRefresh(failingFetch)).rejects.toThrow('dashboard refresh failed with status 409');
  });

  it('fetches issue transcript events with pagination parameters', async () => {
    const payload: DashboardTranscriptPayload = {
      issueId: '1',
      nextAfter: 2,
      events: [
        {
          id: 2,
          sessionId: 1,
          issueId: '1',
          turnIndex: 1,
          sequence: 2,
          role: 'assistant',
          eventType: 'message',
          text: 'hello',
          payload: { type: 'assistant' },
          createdAt: '2026-06-13T10:00:00.000Z',
        },
      ],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(fetchIssueTranscript(fetchImpl, 'issue/1', { apiBaseUrl: '/dashboard', after: 1, limit: 20 })).resolves.toEqual(payload);

    expect(fetchImpl).toHaveBeenCalledWith('/dashboard/api/v1/issues/issue%2F1/transcript?after=1&limit=20');
  });

  it('surfaces unavailable and error transcript responses', async () => {
    const unavailableFetch = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'transcript_unavailable',
        message: 'transcript store is disabled',
      },
    }), { status: 503 }));

    await expect(fetchIssueTranscript(unavailableFetch, '1')).rejects.toThrow('transcript store is disabled');

    const failingFetch = vi.fn(async () => new Response('nope', { status: 500 }));

    await expect(fetchIssueTranscript(failingFetch, '1')).rejects.toThrow('issue transcript failed with status 500');
  });

  it('fetches dashboard event history with optional filters', async () => {
    const payload: DashboardEventsHistoryPayload = {
      nextAfter: 8,
      events: [
        {
          id: 8,
          type: 'issue_event',
          issueId: '1',
          timestamp: '2026-06-13T10:00:00.000Z',
          payload: { event: 'tool_result' },
        },
      ],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(fetchDashboardEventsHistory(fetchImpl, {
      apiBaseUrl: '/dashboard',
      issueId: 'issue/1',
      after: 7,
      limit: 20,
    })).resolves.toEqual(payload);

    expect(fetchImpl).toHaveBeenCalledWith('/dashboard/api/v1/events/history?issueId=issue%2F1&after=7&limit=20');
  });

  it('surfaces unavailable dashboard event history responses', async () => {
    const unavailableFetch = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'event_history_unavailable',
        message: 'transcript store is disabled',
      },
    }), { status: 503 }));

    await expect(fetchDashboardEventsHistory(unavailableFetch, { issueId: '1' })).rejects.toThrow('transcript store is disabled');
  });
});
