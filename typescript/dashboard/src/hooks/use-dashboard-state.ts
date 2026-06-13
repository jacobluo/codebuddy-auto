import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchDashboardBootstrap, requestDashboardRefresh } from '../api/dashboard-api.js';
import { createBrowserEventSource, getDashboardEventsUrl } from '../sse/dashboard-event-source.js';
import type {
  DashboardBootstrapPayload,
  DashboardConnectionState,
  DashboardEventSourceLike,
  DashboardRuntimeDependencies,
  DashboardSnapshot,
  DashboardSseEnvelope,
  DashboardStatus,
} from '../lib/dashboard-types.js';

interface DashboardState {
  status: DashboardStatus;
  bootstrap: DashboardBootstrapPayload | null;
  snapshot: DashboardSnapshot | null;
  connectionState: DashboardConnectionState;
  selectedIssueId: string | null;
  selectedIssueEvents: DashboardSseEnvelope[];
  isRefreshing: boolean;
  errorMessage: string | null;
  selectIssue(issueId: string | null): void;
  triggerRefresh(): Promise<void>;
  retryInitialization(): void;
}

const EVENT_SOURCE_CONNECTING = 0;
const EVENT_SOURCE_CLOSED = 2;
const MAX_STORED_EVENTS_PER_ISSUE = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDashboardSnapshot(value: unknown): value is DashboardSnapshot {
  return isRecord(value)
    && isRecord(value.counts)
    && Array.isArray(value.running)
    && Array.isArray(value.retrying)
    && Array.isArray(value.progress)
    && Array.isArray(value.stuck)
    && Array.isArray(value.completedIssueIds)
    && Array.isArray(value.cleanedWorkspaceIssueIds)
    && isRecord(value.totals)
    && typeof value.generatedAt === 'string';
}

function parseSseEnvelope(rawData: string): DashboardSseEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }
  const type = parsed.type;
  const timestamp = parsed.timestamp;
  const payload = parsed.payload;
  const issueId = parsed.issueId;
  if (
    (type !== 'issue_event' && type !== 'scheduler_event' && type !== 'state_snapshot')
    || typeof timestamp !== 'string'
    || !isRecord(payload)
    || (issueId !== undefined && typeof issueId !== 'string')
  ) {
    return null;
  }

  return {
    type,
    timestamp,
    issueId,
    payload,
  } satisfies DashboardSseEnvelope;
}

function appendIssueEvent(
  previous: Record<string, DashboardSseEnvelope[]>,
  envelope: DashboardSseEnvelope,
): Record<string, DashboardSseEnvelope[]> {
  if (!envelope.issueId) {
    return previous;
  }

  const existing = previous[envelope.issueId] ?? [];
  return {
    ...previous,
    [envelope.issueId]: [...existing, envelope].slice(-MAX_STORED_EVENTS_PER_ISSUE),
  };
}

export function useDashboardState(dependencies: DashboardRuntimeDependencies = {}): DashboardState {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const createEventSource = dependencies.createEventSource ?? createBrowserEventSource;
  const apiBaseUrl = dependencies.apiBaseUrl;

  const [status, setStatus] = useState<DashboardStatus>('loading');
  const [bootstrap, setBootstrap] = useState<DashboardBootstrapPayload | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<DashboardConnectionState>('connecting');
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [eventsByIssueId, setEventsByIssueId] = useState<Record<string, DashboardSseEnvelope[]>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const retryInitialization = useCallback(() => {
    setRetryToken((current) => current + 1);
  }, []);

  const triggerRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await requestDashboardRefresh(fetchImpl, apiBaseUrl);
    } finally {
      setIsRefreshing(false);
    }
  }, [apiBaseUrl, fetchImpl]);

  useEffect(() => {
    let disposed = false;
    let eventSource: DashboardEventSourceLike | null = null;

    const handleInitialization = async () => {
      setStatus('loading');
      setErrorMessage(null);
      setConnectionState('connecting');

      try {
        const nextBootstrap = await fetchDashboardBootstrap(fetchImpl, apiBaseUrl);
        if (disposed) {
          return;
        }

        setBootstrap(nextBootstrap);
        setSnapshot(nextBootstrap.snapshot);
        setStatus('ready');

        eventSource = createEventSource(getDashboardEventsUrl(apiBaseUrl));
        eventSource.onopen = () => {
          setConnectionState('connected');
        };
        eventSource.onerror = () => {
          if (!eventSource) {
            return;
          }
          if (eventSource.readyState === EVENT_SOURCE_CONNECTING) {
            setConnectionState('reconnecting');
            return;
          }
          if (eventSource.readyState === EVENT_SOURCE_CLOSED) {
            setConnectionState('disconnected');
            return;
          }
          setConnectionState('disconnected');
        };

        const handleStateSnapshot = (event: { data: string }) => {
          const envelope = parseSseEnvelope(event.data);
          if (!envelope || !isDashboardSnapshot(envelope.payload)) {
            return;
          }
          setSnapshot(envelope.payload);
        };

        const handleIssueEvent = (event: { data: string }) => {
          const envelope = parseSseEnvelope(event.data);
          if (!envelope) {
            return;
          }
          setEventsByIssueId((current) => appendIssueEvent(current, envelope));
        };

        eventSource.addEventListener('state_snapshot', handleStateSnapshot);
        eventSource.addEventListener('issue_event', handleIssueEvent);
        eventSource.addEventListener('scheduler_event', handleIssueEvent);
      } catch (error) {
        if (disposed) {
          return;
        }
        setStatus('error');
        setConnectionState('disconnected');
        setErrorMessage(error instanceof Error ? error.message : 'dashboard initialization failed');
      }
    };

    void handleInitialization();

    return () => {
      disposed = true;
      eventSource?.close();
    };
  }, [apiBaseUrl, createEventSource, fetchImpl, retryToken]);

  const selectedIssueEvents = useMemo(() => {
    if (!selectedIssueId) {
      return [];
    }
    return eventsByIssueId[selectedIssueId] ?? [];
  }, [eventsByIssueId, selectedIssueId]);

  return {
    status,
    bootstrap,
    snapshot,
    connectionState,
    selectedIssueId,
    selectedIssueEvents,
    isRefreshing,
    errorMessage,
    selectIssue: setSelectedIssueId,
    triggerRefresh,
    retryInitialization,
  };
}

export type { DashboardRuntimeDependencies } from '../lib/dashboard-types.js';
