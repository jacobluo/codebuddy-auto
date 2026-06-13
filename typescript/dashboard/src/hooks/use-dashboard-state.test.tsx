import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDashboardState, type DashboardRuntimeDependencies } from './use-dashboard-state.js';

interface FakeMessageEvent {
  data: string;
}

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  public readonly url: string;
  public readyState = FakeEventSource.CONNECTING;
  public onopen: ((event: Event) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  private readonly listeners = new Map<string, Set<(event: FakeMessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: FakeMessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: FakeMessageEvent) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: FakeMessageEvent) => void): void {
    const listeners = this.listeners.get(type);
    listeners?.delete(listener);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  emitOpen(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  emitError(nextReadyState: number): void {
    this.readyState = nextReadyState;
    this.onerror?.(new Event('error'));
  }

  emitEvent(type: string, payload: unknown): void {
    this.emitRawEvent(type, JSON.stringify(payload));
  }

  emitRawEvent(type: string, data: string): void {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }

    const event = { data };
    for (const listener of listeners) {
      listener(event);
    }
  }
}

function createBootstrapPayload() {
  return {
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
    serverTime: '2026-05-23T00:00:02Z',
    snapshot: {
      generatedAt: '2026-05-23T00:00:02Z',
      counts: { running: 1, retrying: 1, claimed: 0, completed: 0 },
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
      retrying: [
        {
          issueId: '2',
          identifier: '#2',
          mode: 'failure',
          attempt: 2,
          dueAtMs: 1716422400000,
          error: 'rate limited',
        },
      ],
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
    },
  };
}

function DashboardStateProbe({ dependencies }: { dependencies: DashboardRuntimeDependencies }) {
  const state = useDashboardState(dependencies);
  const issueIds = state.snapshot
    ? [...state.snapshot.running.map((issue) => issue.issueId), ...state.snapshot.retrying.map((issue) => issue.issueId)]
    : [];

  return (
    <div>
      <div data-testid="status">{state.status}</div>
      <div data-testid="connection">{state.connectionState}</div>
      <div data-testid="refreshing">{String(state.isRefreshing)}</div>
      <div data-testid="running-count">{state.snapshot?.counts.running ?? 'none'}</div>
      <div data-testid="selected-issue">{state.selectedIssueId ?? 'none'}</div>
      <div data-testid="selected-events">{state.selectedIssueEvents.length}</div>
      <button type="button" onClick={() => void state.triggerRefresh()}>
        trigger refresh
      </button>
      {issueIds.map((issueId) => (
        <button key={issueId} type="button" onClick={() => state.selectIssue(issueId)}>
          select {issueId}
        </button>
      ))}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useDashboardState', () => {
  it('loads bootstrap data before rendering ready state', async () => {
    const bootstrapPayload = createBootstrapPayload();
    const eventSources: FakeEventSource[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/api/v1/dashboard/bootstrap');
      return new Response(JSON.stringify(bootstrapPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    render(
      <DashboardStateProbe
        dependencies={{
          fetchImpl,
          createEventSource: (url) => {
            const eventSource = new FakeEventSource(url);
            eventSources.push(eventSource);
            return eventSource;
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(screen.getByTestId('running-count').textContent).toBe('1');
    expect(screen.getByTestId('connection').textContent).toBe('connecting');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(eventSources).toHaveLength(1);
    expect(eventSources[0]?.url).toBe('/api/v1/events');
  });

  it('tracks SSE connection transitions while preserving the last snapshot', async () => {
    const bootstrapPayload = createBootstrapPayload();
    const eventSource = new FakeEventSource('/api/v1/events');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(bootstrapPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    render(
      <DashboardStateProbe
        dependencies={{
          fetchImpl,
          createEventSource: () => eventSource,
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    await act(async () => {
      eventSource.emitOpen();
    });
    await waitFor(() => {
      expect(screen.getByTestId('connection').textContent).toBe('connected');
    });

    await act(async () => {
      eventSource.emitEvent('state_snapshot', {
        type: 'state_snapshot',
        timestamp: '2026-05-23T00:00:05Z',
        payload: {
          ...bootstrapPayload.snapshot,
          counts: {
            ...bootstrapPayload.snapshot.counts,
            running: 2,
          },
        },
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('running-count').textContent).toBe('2');
    });

    await act(async () => {
      eventSource.emitError(FakeEventSource.CONNECTING);
    });
    await waitFor(() => {
      expect(screen.getByTestId('connection').textContent).toBe('reconnecting');
    });

    await act(async () => {
      eventSource.emitError(FakeEventSource.CLOSED);
    });
    await waitFor(() => {
      expect(screen.getByTestId('connection').textContent).toBe('disconnected');
    });

    expect(screen.getByTestId('running-count').textContent).toBe('2');
  });

  it('tracks refresh request state while posting to the refresh endpoint', async () => {
    const bootstrapPayload = createBootstrapPayload();
    let resolveRefresh!: () => void;
    const refreshDone = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/v1/dashboard/bootstrap')) {
        return new Response(JSON.stringify(bootstrapPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      expect(String(input)).toContain('/api/v1/refresh');
      expect(init?.method).toBe('POST');
      await refreshDone;
      return new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    });

    render(
      <DashboardStateProbe
        dependencies={{
          fetchImpl,
          createEventSource: () => new FakeEventSource('/api/v1/events'),
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger refresh' }));
    await waitFor(() => {
      expect(screen.getByTestId('refreshing').textContent).toBe('true');
    });

    resolveRefresh();
    await waitFor(() => {
      expect(screen.getByTestId('refreshing').textContent).toBe('false');
    });
  });

  it('tracks issue selection state and selected issue events', async () => {
    const bootstrapPayload = createBootstrapPayload();
    const eventSource = new FakeEventSource('/api/v1/events');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(bootstrapPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    render(
      <DashboardStateProbe
        dependencies={{
          fetchImpl,
          createEventSource: () => eventSource,
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    fireEvent.click(screen.getByRole('button', { name: 'select 2' }));
    expect(screen.getByTestId('selected-issue').textContent).toBe('2');

    await act(async () => {
      eventSource.emitEvent('issue_event', {
        type: 'issue_event',
        timestamp: '2026-05-23T00:00:05Z',
        issueId: '2',
        payload: {
          event: 'tool_call',
          tool: 'read_file',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-events').textContent).toBe('1');
    });
  });

  it('ignores malformed SSE payloads and events without issue ids', async () => {
    const bootstrapPayload = createBootstrapPayload();
    const eventSource = new FakeEventSource('/api/v1/events');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(bootstrapPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    render(
      <DashboardStateProbe
        dependencies={{
          fetchImpl,
          createEventSource: () => eventSource,
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    fireEvent.click(screen.getByRole('button', { name: 'select 1' }));

    await act(async () => {
      eventSource.emitRawEvent('issue_event', 'not-json');
      eventSource.emitEvent('state_snapshot', {
        type: 'state_snapshot',
        timestamp: '2026-05-23T00:00:05Z',
        payload: { not: 'a dashboard snapshot' },
      });
      eventSource.emitEvent('issue_event', {
        type: 'issue_event',
        timestamp: '2026-05-23T00:00:06Z',
        payload: {
          event: 'missing_issue_id',
        },
      });
    });

    expect(screen.getByTestId('running-count').textContent).toBe('1');
    expect(screen.getByTestId('selected-events').textContent).toBe('0');
  });
});
