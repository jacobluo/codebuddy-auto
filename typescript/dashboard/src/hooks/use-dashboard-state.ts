import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  fetchDashboardBootstrap,
  fetchDashboardEventsHistory,
  fetchIssueTranscript,
  requestDashboardRefresh,
} from '../api/dashboard-api.js';
import { createBrowserEventSource, getDashboardEventsUrl } from '../sse/dashboard-event-source.js';
import type {
  DashboardBootstrapPayload,
  DashboardConnectionState,
  DashboardEventSourceLike,
  DashboardRuntimeDependencies,
  DashboardSnapshot,
  DashboardSseEnvelope,
  DashboardStatus,
  DashboardTranscriptEvent,
} from '../lib/dashboard-types.js';

interface DashboardState {
  status: DashboardStatus;
  bootstrap: DashboardBootstrapPayload | null;
  snapshot: DashboardSnapshot | null;
  connectionState: DashboardConnectionState;
  selectedIssueId: string | null;
  selectedIssueEvents: DashboardSseEnvelope[];
  selectedIssueTranscriptEvents: DashboardTranscriptEvent[];
  selectedIssueTranscriptStatus: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  selectedIssueTranscriptError: string | null;
  isRefreshing: boolean;
  errorMessage: string | null;
  selectIssue(issueId: string | null): void;
  triggerRefresh(): Promise<void>;
  refreshSelectedTranscript(): Promise<void>;
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
  const id = parsed.id;
  const timestamp = parsed.timestamp;
  const payload = parsed.payload;
  const issueId = parsed.issueId;
  if (
    (type !== 'issue_event' && type !== 'scheduler_event' && type !== 'state_snapshot')
    || (id !== undefined && typeof id !== 'number')
    || typeof timestamp !== 'string'
    || !isRecord(payload)
    || (issueId !== undefined && typeof issueId !== 'string')
  ) {
    return null;
  }

  return {
    id,
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
  if (envelope.id !== undefined && existing.some((event) => event.id === envelope.id)) {
    return previous;
  }
  return {
    ...previous,
    [envelope.issueId]: [...existing, envelope].slice(-MAX_STORED_EVENTS_PER_ISSUE),
  };
}

function mergeIssueEventHistory(
  previous: Record<string, DashboardSseEnvelope[]>,
  issueId: string,
  history: DashboardSseEnvelope[],
): Record<string, DashboardSseEnvelope[]> {
  const existing = previous[issueId] ?? [];
  const merged = [...history.filter((event) => event.issueId === issueId), ...existing];
  const seenIds = new Set<number>();
  const deduped: DashboardSseEnvelope[] = [];

  for (const event of merged) {
    if (event.id !== undefined) {
      if (seenIds.has(event.id)) {
        continue;
      }
      seenIds.add(event.id);
    }
    deduped.push(event);
  }

  return {
    ...previous,
    [issueId]: deduped.slice(-MAX_STORED_EVENTS_PER_ISSUE),
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
  const [transcriptEventsByIssueId, setTranscriptEventsByIssueId] = useState<Record<string, DashboardTranscriptEvent[]>>({});
  const [transcriptStatusByIssueId, setTranscriptStatusByIssueId] = useState<Record<string, 'loading' | 'ready' | 'unavailable' | 'error'>>({});
  const [transcriptErrorByIssueId, setTranscriptErrorByIssueId] = useState<Record<string, string | null>>({});
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

  const loadTranscript = useCallback(async (issueId: string) => {
    setTranscriptStatusByIssueId((current) => ({ ...current, [issueId]: 'loading' }));
    setTranscriptErrorByIssueId((current) => ({ ...current, [issueId]: null }));
    try {
      const payload = await fetchIssueTranscript(fetchImpl, issueId, { apiBaseUrl });
      setTranscriptEventsByIssueId((current) => ({ ...current, [issueId]: payload.events }));
      setTranscriptStatusByIssueId((current) => ({ ...current, [issueId]: 'ready' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcript request failed.';
      setTranscriptStatusByIssueId((current) => ({
        ...current,
        [issueId]: /unavailable|disabled/i.test(message) ? 'unavailable' : 'error',
      }));
      setTranscriptErrorByIssueId((current) => ({ ...current, [issueId]: message }));
    }
  }, [apiBaseUrl, fetchImpl]);

  const loadIssueEventHistory = useCallback(async (issueId: string) => {
    try {
      const payload = await fetchDashboardEventsHistory(fetchImpl, {
        apiBaseUrl,
        issueId,
        limit: MAX_STORED_EVENTS_PER_ISSUE,
      });
      if (!Array.isArray(payload.events)) {
        return;
      }
      setEventsByIssueId((current) => mergeIssueEventHistory(current, issueId, payload.events));
    } catch {
      return;
    }
  }, [apiBaseUrl, fetchImpl]);

  const refreshSelectedTranscript = useCallback(async () => {
    if (!selectedIssueId) {
      return;
    }
    await loadTranscript(selectedIssueId);
  }, [loadTranscript, selectedIssueId]);

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

  useEffect(() => {
    if (!selectedIssueId || status !== 'ready') {
      return;
    }

    void loadIssueEventHistory(selectedIssueId);
  }, [loadIssueEventHistory, selectedIssueId, status]);

  useEffect(() => {
    if (!selectedIssueId || status !== 'ready') {
      return;
    }

    void loadTranscript(selectedIssueId);
  }, [loadTranscript, selectedIssueId, selectedIssueEvents.length, status]);

  const selectedIssueTranscriptEvents = useMemo(() => {
    if (!selectedIssueId) {
      return [];
    }
    return transcriptEventsByIssueId[selectedIssueId] ?? [];
  }, [selectedIssueId, transcriptEventsByIssueId]);

  return {
    status,
    bootstrap,
    snapshot,
    connectionState,
    selectedIssueId,
    selectedIssueEvents,
    selectedIssueTranscriptEvents,
    selectedIssueTranscriptStatus: selectedIssueId ? transcriptStatusByIssueId[selectedIssueId] ?? 'idle' : 'idle',
    selectedIssueTranscriptError: selectedIssueId ? transcriptErrorByIssueId[selectedIssueId] ?? null : null,
    isRefreshing,
    errorMessage,
    selectIssue: setSelectedIssueId,
    triggerRefresh,
    refreshSelectedTranscript,
    retryInitialization,
  };
}

export type { DashboardRuntimeDependencies } from '../lib/dashboard-types.js';
