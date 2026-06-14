import { formatCompactNumber, formatDuration, formatClockTime } from '../lib/dashboard-format.js';
import type { DashboardHistoricalIssue, DashboardSnapshot } from '../lib/dashboard-types.js';

interface IssueSidebarProps {
  snapshot: DashboardSnapshot;
  selectedIssueId: string | null;
  historicalIssues?: DashboardHistoricalIssue[];
  historyStatus?: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  historyError?: string | null;
  onSelectIssue: (issueId: string) => void;
}

function getActiveIssueIds(snapshot: DashboardSnapshot): Set<string> {
  return new Set([
    ...snapshot.running.map((issue) => issue.issueId),
    ...snapshot.retrying.map((issue) => issue.issueId),
    ...snapshot.stuck.map((issue) => issue.issueId),
  ]);
}

export function IssueSidebar({
  snapshot,
  selectedIssueId,
  historicalIssues = [],
  historyStatus = 'idle',
  historyError = null,
  onSelectIssue,
}: IssueSidebarProps) {
  const activeIssueIds = getActiveIssueIds(snapshot);
  const visibleHistoricalIssues = historicalIssues.filter((issue) => !activeIssueIds.has(issue.issueId));

  return (
    <aside className="dashboard-panel dashboard-issue-sidebar">
      <div className="dashboard-panel-heading">
        <div>
          <p className="dashboard-panel-kicker">active work</p>
          <h2>Issues</h2>
        </div>
      </div>

      <div className="dashboard-issue-list">
        {snapshot.running.map((issue) => (
          <button
            key={issue.issueId}
            className="dashboard-issue-card"
            type="button"
            aria-pressed={selectedIssueId === issue.issueId}
            onClick={() => onSelectIssue(issue.issueId)}
          >
            <span className="dashboard-issue-state is-running">running</span>
            <strong>{issue.identifier}</strong>
            <span>{issue.title}</span>
            <small>
              turn {issue.turnCount} · {formatDuration(issue.secondsRunning)} · {formatCompactNumber(issue.tokenUsage.totalTokens)} tok
            </small>
          </button>
        ))}
        {snapshot.retrying.map((issue) => (
          <button
            key={issue.issueId}
            className="dashboard-issue-card"
            type="button"
            aria-pressed={selectedIssueId === issue.issueId}
            onClick={() => onSelectIssue(issue.issueId)}
          >
            <span className="dashboard-issue-state is-retrying">retrying</span>
            <strong>{issue.identifier}</strong>
            <span>{issue.error ?? 'retry scheduled'}</span>
            <small>
              attempt {issue.attempt} · due {formatClockTime(new Date(issue.dueAtMs).toISOString())}
            </small>
          </button>
        ))}
        {snapshot.stuck.map((issue) => (
          <button
            key={issue.issueId}
            className="dashboard-issue-card"
            type="button"
            aria-pressed={selectedIssueId === issue.issueId}
            onClick={() => onSelectIssue(issue.issueId)}
          >
            <span className="dashboard-issue-state is-stuck">stuck</span>
            <strong>{issue.identifier}</strong>
            <span>{issue.reason}</span>
            <small>
              repeated {issue.repeatedCount} · fingerprint {issue.fingerprint}
            </small>
          </button>
        ))}
        {snapshot.running.length === 0 && snapshot.retrying.length === 0 && snapshot.stuck.length === 0 ? (
          <p className="dashboard-empty-copy">No active issues right now.</p>
        ) : null}
      </div>

      {snapshot.completedIssueIds.length > 0 ? (
        <section className="dashboard-completed-strip">
          <h3>Completed</h3>
          <div>
            {snapshot.completedIssueIds.map((issueId) => (
              <span className="dashboard-completed-chip" key={issueId}>#{issueId}</span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="dashboard-history-section">
        <h3>History</h3>
        {historyStatus === 'loading' ? (
          <p className="dashboard-empty-copy">Loading historical issues…</p>
        ) : historyStatus === 'unavailable' || historyStatus === 'error' ? (
          <p className="dashboard-empty-copy">{historyError ?? 'Historical issue history is unavailable.'}</p>
        ) : visibleHistoricalIssues.length === 0 ? (
          <p className="dashboard-empty-copy">No historical issues yet.</p>
        ) : (
          <div className="dashboard-issue-list dashboard-history-list">
            {visibleHistoricalIssues.map((issue) => (
              <button
                key={issue.issueId}
                className="dashboard-issue-card dashboard-history-card"
                type="button"
                aria-pressed={selectedIssueId === issue.issueId}
                onClick={() => onSelectIssue(issue.issueId)}
              >
                <span className="dashboard-issue-state is-history">history</span>
                <strong>{issue.identifier}</strong>
                <span>{issue.title}</span>
                <small>
                  {issue.sessionCount} session · {issue.transcriptEventCount} transcript · {issue.dashboardEventCount} events
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
