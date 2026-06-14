import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './app.js';
import type { DashboardBootstrapPayload } from './lib/dashboard-types.js';

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
    eventSources.push(this);
  }

  addEventListener(type: string, listener: (event: FakeMessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: FakeMessageEvent) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: FakeMessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  emitOpen(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  emitEvent(type: string, payload: unknown): void {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }
    const event = { data: JSON.stringify(payload) };
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const eventSources: FakeEventSource[] = [];

function createBootstrapPayload(): DashboardBootstrapPayload {
  return {
    config: {
      tracker: {
        kind: 'cnb',
        projectSlug: 'repo/demo',
      },
      polling: {
        intervalMs: 30_000,
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
      counts: {
        running: 1,
        retrying: 0,
        claimed: 0,
        completed: 0,
      },
      cleanedWorkspaceIssueIds: [],
      totals: {
        secondsRunning: 82,
        inputTokens: 400,
        outputTokens: 1100,
        totalTokens: 1500,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 0,
      },
      running: [
        {
          issueId: '1',
          identifier: '#1',
          title: 'Issue One',
          sessionId: 'session-1',
          turnCount: 1,
          lastEvent: 'turn_completed',
          lastEventAt: '2026-05-23T00:00:01Z',
          secondsRunning: 82,
          workspacePath: '/tmp/_1',
          tokenUsage: {
            inputTokens: 400,
            outputTokens: 1100,
            totalTokens: 1500,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            creditCost: 0,
          },
        },
      ],
      retrying: [],
      progress: [],
      stuck: [],
      completedIssueIds: [],
    },
  };
}

function installEventSource(): void {
  vi.stubGlobal('EventSource', FakeEventSource);
}

afterEach(() => {
  cleanup();
  eventSources.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('loads bootstrap data, renders the dashboard, and displays live issue events', async () => {
    installEventSource();
    const bootstrapPayload = createBootstrapPayload();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/issues/history')) {
        return new Response(JSON.stringify({ issues: [], nextAfter: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(bootstrapPayload), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Loading dashboard…' })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'codebuddy-auto dashboard' })).toBeTruthy();
    });
    expect(screen.getByText('Issue One')).toBeTruthy();
    expect(eventSources).toHaveLength(1);
    expect(eventSources[0]?.url).toBe('/api/v1/events');

    await act(async () => {
      eventSources[0]?.emitOpen();
    });
    await waitFor(() => {
      expect(screen.getByText('connected')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /#1/i }));
    await act(async () => {
      eventSources[0]?.emitEvent('issue_event', {
        type: 'issue_event',
        timestamp: '2026-05-23T00:00:05Z',
        issueId: '1',
        payload: {
          event: 'tool_call',
          tool: 'read_file',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('read_file')).toBeTruthy();
    });
  });

  it('renders initialization errors and retries bootstrap loading', async () => {
    installEventSource();
    const bootstrapPayload = createBootstrapPayload();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (fetchImpl.mock.calls.length === 1) {
        return new Response('nope', { status: 503 });
      }
      if (url.includes('/api/v1/issues/history')) {
        return new Response(JSON.stringify({ issues: [], nextAfter: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(bootstrapPayload), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Unable to initialize dashboard' })).toBeTruthy();
    });
    expect(screen.getByText('dashboard bootstrap failed with status 503')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'retry initialization' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'codebuddy-auto dashboard' })).toBeTruthy();
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(eventSources).toHaveLength(1);
  });
});
