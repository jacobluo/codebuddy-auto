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
  const message = getPayloadDisplayValue(payload.message);
  if (message) {
    return message;
  }

  const error = getPayloadDisplayValue(payload.error);
  if (error) {
    return error;
  }

  const reason = getPayloadDisplayValue(payload.reason);
  if (reason) {
    return reason;
  }

  const exitReason = getPayloadDisplayValue(payload.exitReason);
  if (exitReason) {
    return exitReason;
  }

  const tool = getPayloadDisplayValue(payload.tool);
  if (tool) {
    return tool;
  }

  const timeoutMs = getPayloadDisplayValue(payload.timeoutMs);
  if (timeoutMs) {
    return `timeout after ${timeoutMs}ms`;
  }

  return '';
}

function getPayloadDisplayValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => getPayloadDisplayValue(item)).filter(Boolean).join('; ');
  }

  return '';
}

function getIssueEventDetails(event: DashboardSseEnvelope): string[] {
  const payload = getPayloadRecord(event);
  const fields: Array<[string, unknown]> = [
    ['error', payload.error],
    ['stderr', payload.stderr],
    ['stdout', payload.stdout],
    ['exit', payload.exitReason],
    ['reason', payload.reason],
    ['timeout', payload.timeoutMs],
    ['session', payload.sessionId],
  ];

  const message = getIssueEventMessage(event);
  const seen = new Set<string>();
  const details: string[] = [];

  for (const [label, value] of fields) {
    const display = getPayloadDisplayValue(value);
    if (!display || display === message || seen.has(`${label}:${display}`)) {
      continue;
    }
    seen.add(`${label}:${display}`);
    details.push(label === 'timeout' ? `${label}: ${display}ms` : `${label}: ${display}`);
  }

  return details;
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
              <div className="dashboard-event-body">
                <strong>{getIssueEventMessage(event) || 'event received'}</strong>
                {getIssueEventDetails(event).map((detail) => (
                  <small className="dashboard-event-detail" key={detail}>{detail}</small>
                ))}
              </div>
              <small>{event.timestamp}</small>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
