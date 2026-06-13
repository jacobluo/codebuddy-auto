import type {
  DashboardRetryingIssue,
  DashboardRunningIssue,
  DashboardSseEnvelope,
  DashboardStuckIssue,
} from '../lib/dashboard-types.js';

type DashboardSelectableIssue = DashboardRunningIssue | DashboardRetryingIssue | DashboardStuckIssue | null;

interface LiveEventsPanelProps {
  repoUrl: string | null;
  selectedIssue: DashboardSelectableIssue;
  selectedIssueEvents: DashboardSseEnvelope[];
}

function getPayloadRecord(event: DashboardSseEnvelope): Record<string, unknown> {
  return event.payload as Record<string, unknown>;
}

function getIssueEventTitle(event: DashboardSseEnvelope): string {
  const payload = getPayloadRecord(event);
  const namedEvent = payload.event;
  return typeof namedEvent === 'string' ? namedEvent : event.type;
}

function getIssueEventMessage(event: DashboardSseEnvelope): string {
  const payload = getPayloadRecord(event);
  const message = payload.message;
  if (typeof message === 'string' && message.length > 0) {
    return message;
  }

  const tool = payload.tool;
  if (typeof tool === 'string' && tool.length > 0) {
    return tool;
  }

  return '';
}

export function LiveEventsPanel({ repoUrl, selectedIssue, selectedIssueEvents }: LiveEventsPanelProps) {
  if (!selectedIssue) {
    return (
      <section className="dashboard-panel dashboard-live-events">
        <div className="dashboard-panel-heading">
          <div>
            <p className="dashboard-panel-kicker">live event stream</p>
            <h2>Events</h2>
          </div>
        </div>
        <p className="dashboard-empty-copy">Select an issue to inspect its live event stream.</p>
      </section>
    );
  }

  const issueUrl = repoUrl ? `${repoUrl}/-/issues/${selectedIssue.issueId}` : null;
  const workspaceLabel = 'workspacePath' in selectedIssue
    ? selectedIssue.workspacePath
    : 'reason' in selectedIssue
      ? `stuck · ${selectedIssue.reason}`
      : 'retry queue';

  return (
    <section className="dashboard-panel dashboard-live-events">
      <div className="dashboard-panel-heading">
        <div>
          <p className="dashboard-panel-kicker">live event stream</p>
          <h2>{selectedIssue.identifier}</h2>
        </div>
        <span className="dashboard-live-status">SSE live</span>
      </div>
      <div className="dashboard-live-meta-strip">
        <span>{repoUrl ? `cnb.cool issue · ${selectedIssue.identifier}` : selectedIssue.identifier}</span>
        <span className="dashboard-live-meta">
          <span>workspace · </span>
          <span>{workspaceLabel}</span>
        </span>
        {issueUrl ? (
          <a className="dashboard-secondary-link" href={issueUrl} target="_blank" rel="noreferrer">
            open issue
          </a>
        ) : null}
      </div>

      <div className="dashboard-event-list">
        {selectedIssueEvents.length === 0 ? (
          <p className="dashboard-empty-copy">Waiting for the first issue event…</p>
        ) : (
          selectedIssueEvents.map((event, index) => (
            <article className="dashboard-event-card" key={`${event.timestamp}-${index}`}>
              <span className="dashboard-event-type">{getIssueEventTitle(event)}</span>
              <strong>{getIssueEventMessage(event) || 'event received'}</strong>
              <small>{event.timestamp}</small>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
