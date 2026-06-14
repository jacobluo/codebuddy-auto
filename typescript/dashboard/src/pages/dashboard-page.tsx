import { ConfigStrip } from '../components/config-strip.js';
import { DashboardHeader } from '../components/dashboard-header.js';
import { DashboardToolbar } from '../components/dashboard-toolbar.js';
import { IssueSidebar } from '../components/issue-sidebar.js';
import { LiveEventsPanel } from '../components/live-events-panel.js';
import { MetricGrid } from '../components/metric-grid.js';
import { formatClockTime, formatUptime } from '../lib/dashboard-format.js';
import type {
  DashboardBootstrapPayload,
  DashboardConnectionState,
  DashboardHistoricalIssue,
  DashboardSnapshot,
  DashboardSseEnvelope,
  DashboardStatus,
  DashboardTranscriptEvent,
} from '../lib/dashboard-types.js';
import type { DashboardSelectedIssue } from '../hooks/use-dashboard-state.js';

export interface DashboardPageState {
  status: DashboardStatus;
  connectionState: DashboardConnectionState;
  isRefreshing: boolean;
  errorMessage: string | null;
  bootstrap: DashboardBootstrapPayload | null;
  snapshot: DashboardSnapshot | null;
  selectedIssueId: string | null;
  selectedIssue: DashboardSelectedIssue | null;
  historicalIssues: DashboardHistoricalIssue[];
  historyStatus: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  historyError: string | null;
  selectedIssueEvents: DashboardSseEnvelope[];
  selectedIssueTranscriptEvents: DashboardTranscriptEvent[];
  selectedIssueTranscriptStatus: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  selectedIssueTranscriptError: string | null;
  onRefresh: () => void | Promise<void>;
  onRefreshTranscript: () => void | Promise<void>;
  onRetry: () => void;
  onSelectIssue: (issueId: string) => void;
  nowMs?: number;
}

function getSelectedIssue(state: DashboardPageState) {
  if (state.selectedIssue) {
    return state.selectedIssue.issue;
  }
  if (!state.snapshot || !state.selectedIssueId) {
    return null;
  }
  return state.snapshot.running.find((issue) => issue.issueId === state.selectedIssueId)
    ?? state.snapshot.retrying.find((issue) => issue.issueId === state.selectedIssueId)
    ?? state.snapshot.stuck.find((issue) => issue.issueId === state.selectedIssueId)
    ?? null;
}

export function DashboardPage({ state }: { state: DashboardPageState }) {
  if (state.status === 'loading') {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-status-surface">
          <p className="dashboard-kicker">dashboard startup</p>
          <h1>Loading dashboard…</h1>
          <p>Fetching bootstrap data and attaching the live SSE stream.</p>
        </section>
      </main>
    );
  }

  if (state.status === 'error' || !state.bootstrap || !state.snapshot) {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-status-surface is-error">
          <p className="dashboard-kicker">dashboard startup</p>
          <h1>Unable to initialize dashboard</h1>
          <p>{state.errorMessage ?? 'Bootstrap data is unavailable.'}</p>
          <button className="dashboard-primary-button" type="button" onClick={state.onRetry}>
            retry initialization
          </button>
        </section>
      </main>
    );
  }

  const selectedIssue = getSelectedIssue(state);
  const uptimeLabel = formatUptime(state.bootstrap.serverTime, state.nowMs ?? Date.now());
  const lastTickLabel = formatClockTime(state.snapshot.generatedAt);

  return (
    <main className="dashboard-shell dashboard-shell-ready">
      <div className="dashboard-surface-grid">
        <DashboardHeader />
        <ConfigStrip config={state.bootstrap.config} repoUrl={state.bootstrap.repoUrl} />
        <DashboardToolbar
          connectionState={state.connectionState}
          isRefreshing={state.isRefreshing}
          lastTickLabel={lastTickLabel}
          uptimeLabel={uptimeLabel}
          onRefresh={state.onRefresh}
        />
        <MetricGrid snapshot={state.snapshot} />
        <div className="dashboard-content-grid">
          <IssueSidebar
            snapshot={state.snapshot}
            selectedIssueId={state.selectedIssueId}
            historicalIssues={state.historicalIssues}
            historyStatus={state.historyStatus}
            historyError={state.historyError}
            onSelectIssue={state.onSelectIssue}
          />
          <LiveEventsPanel
            repoUrl={state.bootstrap.repoUrl}
            selectedIssue={selectedIssue}
            selectedIssueEvents={state.selectedIssueEvents}
            transcriptEvents={state.selectedIssueTranscriptEvents}
            transcriptStatus={state.selectedIssueTranscriptStatus}
            transcriptError={state.selectedIssueTranscriptError}
            onRefreshTranscript={state.onRefreshTranscript}
          />
        </div>
      </div>
    </main>
  );
}
