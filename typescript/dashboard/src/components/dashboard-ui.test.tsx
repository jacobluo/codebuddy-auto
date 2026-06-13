import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfigStrip } from './config-strip.js';
import { DashboardHeader } from './dashboard-header.js';
import { DashboardToolbar } from './dashboard-toolbar.js';
import { IssueSidebar } from './issue-sidebar.js';
import { LiveEventsPanel } from './live-events-panel.js';
import { MetricGrid } from './metric-grid.js';
import { DashboardPage, type DashboardPageState } from '../pages/dashboard-page.js';

function createPageState(overrides: Partial<DashboardPageState> = {}): DashboardPageState {
  return {
    status: 'ready',
    connectionState: 'connected',
    isRefreshing: false,
    errorMessage: null,
    bootstrap: {
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
        counts: { running: 1, retrying: 1, claimed: 2, completed: 4 },
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
          secondsRunning: 82,
          inputTokens: 400,
          outputTokens: 1100,
          totalTokens: 1500,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          creditCost: 0,
        },
        cleanedWorkspaceIssueIds: [],
        progress: [],
        stuck: [],
        completedIssueIds: ['8', '9', '10', '11'],
      },
    },
    snapshot: {
      generatedAt: '2026-05-23T00:00:02Z',
      counts: { running: 1, retrying: 1, claimed: 2, completed: 4 },
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
        secondsRunning: 82,
        inputTokens: 400,
        outputTokens: 1100,
        totalTokens: 1500,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 0,
      },
      cleanedWorkspaceIssueIds: [],
      progress: [],
      stuck: [],
      completedIssueIds: ['8', '9', '10', '11'],
    },
    selectedIssueId: '1',
    selectedIssueEvents: [
      {
        type: 'issue_event',
        timestamp: '2026-05-23T00:00:03Z',
        issueId: '1',
        payload: {
          event: 'tool_call',
          tool: 'read_file',
        },
      },
      {
        type: 'scheduler_event',
        timestamp: '2026-05-23T00:00:05Z',
        issueId: '1',
        payload: {
          event: 'turn_completed',
          message: 'turn finished',
        },
      },
    ],
    onRefresh: vi.fn(async () => undefined),
    onRetry: vi.fn(),
    onSelectIssue: vi.fn(),
    ...overrides,
  };
}

describe('dashboard UI components', () => {
  it('renders the dashboard header as a compact topbar', () => {
    render(<DashboardHeader />);

    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'codebuddy-auto dashboard' })).toBeTruthy();
    expect(screen.getByText('Real-time agent orchestration · SSE live events')).toBeTruthy();
    expect(screen.getByText('runtime surface')).toBeTruthy();
  });

  it('renders a separate runtime toolbar with refresh and connection state', () => {
    render(
      <DashboardToolbar
        connectionState="connected"
        isRefreshing={true}
        lastTickLabel="21:00:02"
        uptimeLabel="12m 04s"
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'dashboard runtime toolbar' })).toBeTruthy();
    expect(screen.getByText('connected')).toBeTruthy();
    expect(screen.getByText('last tick 21:00:02')).toBeTruthy();
    expect(screen.getByText('uptime 12m 04s')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'refreshing…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the config strip with repo and runtime configuration', () => {
    const state = createPageState();
    render(
      <ConfigStrip
        config={state.bootstrap!.config}
        repoUrl={state.bootstrap!.repoUrl}
      />,
    );

    expect(screen.getByRole('link', { name: 'repo/demo' }).getAttribute('href')).toBe('https://cnb.cool/repo/demo');
    expect(screen.getByText('Tracker cnb')).toBeTruthy();
    expect(screen.getByText('Poll 30s')).toBeTruthy();
    expect(screen.getByText('Concurrency 10')).toBeTruthy();
    expect(screen.getByText('Max turns 20')).toBeTruthy();
    expect(screen.getByText('Worker local')).toBeTruthy();
    expect(screen.getByText('Workspace directory')).toBeTruthy();
  });

  it('renders the metric grid with formatted counts and totals', () => {
    const state = createPageState();
    render(<MetricGrid snapshot={state.snapshot!} />);

    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText('retrying')).toBeTruthy();
    expect(screen.getByText('claimed')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText('tokens')).toBeTruthy();
    expect(screen.getByText('runtime')).toBeTruthy();
    expect(screen.getByText('1.5K')).toBeTruthy();
    expect(screen.getByText('1m 22s')).toBeTruthy();
  });

  it('renders the issue sidebar with active selection and completed issues', () => {
    const state = createPageState();
    render(
      <IssueSidebar
        snapshot={state.snapshot!}
        selectedIssueId={state.selectedIssueId}
        onSelectIssue={state.onSelectIssue}
      />,
    );

    const selectedIssue = screen.getByRole('button', { name: /#1/i });
    expect(selectedIssue.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('#11')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /#2/i }));
    expect(state.onSelectIssue).toHaveBeenCalledWith('2');
  });

  it('renders stuck issues with their stuck reason', () => {
    const state = createPageState({
      selectedIssueId: 'stuck-1',
    });
    const snapshot = {
      ...state.snapshot!,
      running: [],
      retrying: [],
      stuck: [
        {
          issueId: 'stuck-1',
          identifier: '#stuck-1',
          reason: 'no_progress' as const,
          repeatedCount: 3,
          fingerprint: 'same',
        },
      ],
    };

    render(
      <IssueSidebar
        snapshot={snapshot}
        selectedIssueId={state.selectedIssueId}
        onSelectIssue={state.onSelectIssue}
      />,
    );

    const stuckIssue = screen.getByRole('button', { name: /#stuck-1/i });
    expect(stuckIssue.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('stuck')).toBeTruthy();
    expect(screen.getByText('no_progress')).toBeTruthy();

    fireEvent.click(stuckIssue);
    expect(state.onSelectIssue).toHaveBeenCalledWith('stuck-1');
  });

  it('renders the live events panel and empty state', () => {
    const state = createPageState();
    render(
      <LiveEventsPanel
        repoUrl={state.bootstrap!.repoUrl}
        selectedIssue={state.snapshot!.running[0]!}
        selectedIssueEvents={state.selectedIssueEvents}
      />,
    );

    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText('/tmp/_1')).toBeTruthy();
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(screen.getByText('turn finished')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'open issue' }).getAttribute('href')).toBe('https://cnb.cool/repo/demo/-/issues/1');

    render(
      <LiveEventsPanel
        repoUrl={state.bootstrap!.repoUrl}
        selectedIssue={null}
        selectedIssueEvents={[]}
      />,
    );
    expect(screen.getByText('Select an issue to inspect its live event stream.')).toBeTruthy();
  });

  it('renders failure details in the live events panel', () => {
    const state = createPageState({
      selectedIssueEvents: [
        {
          type: 'issue_event',
          timestamp: '2026-05-23T00:00:03Z',
          issueId: '1',
          payload: {
            event: 'turn_failed',
            error: 'SDK stream closed before result',
            exitReason: 'turn_failed',
            stderr: 'fatal: authentication failed',
          },
        },
      ],
    });

    render(
      <LiveEventsPanel
        repoUrl={state.bootstrap!.repoUrl}
        selectedIssue={state.snapshot!.running[0]!}
        selectedIssueEvents={state.selectedIssueEvents}
      />,
    );

    expect(screen.getByText('SDK stream closed before result')).toBeTruthy();
    expect(screen.getByText(/fatal: authentication failed/)).toBeTruthy();
    expect(screen.queryByText('event received')).toBeNull();
  });

  it('renders the ready dashboard page as a compact shell with a separate toolbar row', () => {
    const state = createPageState();

    render(<DashboardPage state={state} />);

    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'dashboard configuration summary' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'dashboard runtime toolbar' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'dashboard metrics' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Issues' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '#1' })).toBeTruthy();
  });

  it('renders the dashboard page error state with retry action', () => {
    const state = createPageState({
      status: 'error',
      snapshot: null,
      bootstrap: null,
      errorMessage: 'dashboard bootstrap failed',
      selectedIssueId: null,
      selectedIssueEvents: [],
    });

    render(<DashboardPage state={state} />);

    expect(screen.getByText('Unable to initialize dashboard')).toBeTruthy();
    expect(screen.getByText('dashboard bootstrap failed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'retry initialization' }));
    expect(state.onRetry).toHaveBeenCalledTimes(1);
  });
});
