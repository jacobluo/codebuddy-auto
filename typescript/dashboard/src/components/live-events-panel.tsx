import { useState } from 'react';

import type {
  DashboardRetryingIssue,
  DashboardRunningIssue,
  DashboardSseEnvelope,
  DashboardStuckIssue,
  DashboardTranscriptEvent,
} from '../lib/dashboard-types.js';
import { formatLocalDateTime } from '../lib/dashboard-format.js';

type DashboardSelectableIssue = DashboardRunningIssue | DashboardRetryingIssue | DashboardStuckIssue | null;

interface LiveEventsPanelProps {
  repoUrl: string | null;
  selectedIssue: DashboardSelectableIssue;
  selectedIssueEvents: DashboardSseEnvelope[];
  transcriptEvents?: DashboardTranscriptEvent[];
  transcriptStatus?: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  transcriptError?: string | null;
  onRefreshTranscript?: () => void | Promise<void>;
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

function getTranscriptText(event: DashboardTranscriptEvent): string {
  if (event.text && event.text.trim().length > 0) {
    return event.text;
  }
  return event.eventType;
}

function getTranscriptTimeMs(event: DashboardTranscriptEvent): number {
  const parsed = new Date(event.createdAt).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortTranscriptNewestFirst(events: DashboardTranscriptEvent[]): DashboardTranscriptEvent[] {
  return [...events].sort((left, right) => {
    const timeDelta = getTranscriptTimeMs(right) - getTranscriptTimeMs(left);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return right.id - left.id;
  });
}

function hasTranscriptDisplayText(event: DashboardTranscriptEvent): boolean {
  return event.text !== undefined && event.text.trim().length > 0;
}

function shouldRenderTranscriptEvent(event: DashboardTranscriptEvent): boolean {
  return !(event.role === 'assistant' && event.eventType === 'message' && !hasTranscriptDisplayText(event));
}

export function LiveEventsPanel({
  repoUrl,
  selectedIssue,
  selectedIssueEvents,
  transcriptEvents = [],
  transcriptStatus = 'idle',
  transcriptError = null,
  onRefreshTranscript,
}: LiveEventsPanelProps) {
  const [activeView, setActiveView] = useState<'events' | 'transcript'>('events');

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
  const transcriptEventsNewestFirst = sortTranscriptNewestFirst(transcriptEvents.filter(shouldRenderTranscriptEvent));

  return (
    <section className="dashboard-panel dashboard-live-events">
      <div className="dashboard-panel-heading">
        <div>
          <p className="dashboard-panel-kicker">{activeView === 'events' ? 'live event stream' : 'persisted transcript'}</p>
          <h2>{selectedIssue.identifier}</h2>
        </div>
        <div className="dashboard-view-tabs" role="tablist" aria-label="Issue detail view">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'events'}
            className={activeView === 'events' ? 'is-active' : ''}
            onClick={() => setActiveView('events')}
          >
            Events
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'transcript'}
            className={activeView === 'transcript' ? 'is-active' : ''}
            onClick={() => setActiveView('transcript')}
          >
            Transcript
          </button>
        </div>
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

      {activeView === 'events' ? (
        <div className="dashboard-event-list">
          <span className="dashboard-live-status">SSE live</span>
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
      ) : (
        <div className="dashboard-event-list">
          <button className="dashboard-secondary-link" type="button" onClick={onRefreshTranscript}>
            refresh transcript
          </button>
          {transcriptStatus === 'loading' ? (
            <p className="dashboard-empty-copy">Loading transcript…</p>
          ) : transcriptStatus === 'unavailable' ? (
            <p className="dashboard-empty-copy">Transcript persistence is unavailable.</p>
          ) : transcriptStatus === 'error' ? (
            <p className="dashboard-empty-copy">{transcriptError ?? 'Transcript request failed.'}</p>
          ) : transcriptEventsNewestFirst.length === 0 ? (
            <p className="dashboard-empty-copy">No persisted transcript events yet.</p>
          ) : (
            transcriptEventsNewestFirst.map((event) => (
              <article className={`dashboard-event-card dashboard-transcript-role-${event.role}`} key={event.id}>
                <span className="dashboard-event-type">{event.role} · {event.eventType}</span>
                <div className="dashboard-event-body">
                  <strong>{getTranscriptText(event)}</strong>
                  {event.turnIndex !== undefined ? (
                    <small className="dashboard-event-detail">turn {event.turnIndex}</small>
                  ) : null}
                </div>
                <small>{formatLocalDateTime(event.createdAt)}</small>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}
