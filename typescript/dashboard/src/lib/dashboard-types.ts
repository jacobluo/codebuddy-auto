export type DashboardStatus = 'loading' | 'ready' | 'error';
export type DashboardConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface DashboardTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  creditCost: number;
}

export interface DashboardRunningIssue {
  issueId: string;
  identifier: string;
  title: string;
  sessionId: string | null;
  turnCount: number;
  lastEvent: string | null;
  lastEventAt: string | null;
  secondsRunning: number;
  workspacePath: string;
  tokenUsage: DashboardTokenUsage;
}

export interface DashboardRetryingIssue {
  issueId: string;
  identifier: string;
  mode: 'continuation' | 'failure';
  attempt: number;
  dueAtMs: number;
  error: string | null;
}

export interface DashboardProgressIssue {
  issueId: string;
  identifier: string;
  fingerprint: string;
  repeatedCount: number;
  headCommit: string | null;
  statusShort: string[];
  untrackedFiles: string[];
  trackerState: string | null;
  trackerLabels: string[];
  lastEvent: string | null;
  stuck: {
    reason: 'no_progress' | 'max_turns_reached';
    repeatedCount: number;
    fingerprint: string;
  } | null;
}

export interface DashboardStuckIssue {
  issueId: string;
  identifier: string;
  reason: 'no_progress' | 'max_turns_reached';
  repeatedCount: number;
  fingerprint: string;
}

export interface DashboardSnapshot {
  generatedAt: string;
  counts: {
    running: number;
    retrying: number;
    claimed: number;
    completed: number;
  };
  cleanedWorkspaceIssueIds: string[];
  totals: DashboardTokenUsage & {
    secondsRunning: number;
  };
  running: DashboardRunningIssue[];
  retrying: DashboardRetryingIssue[];
  progress: DashboardProgressIssue[];
  stuck: DashboardStuckIssue[];
  completedIssueIds: string[];
}

export interface DashboardBootstrapPayload {
  config: {
    tracker: {
      kind: string;
      projectSlug: string | null;
    };
    polling: {
      intervalMs: number;
    };
    agent: {
      maxConcurrentAgents: number;
      maxTurns: number;
    };
    worker: {
      kind: string;
    };
    workspace: {
      mode: string;
    };
  };
  repoUrl: string | null;
  serverTime: string;
  snapshot: DashboardSnapshot;
}

export interface DashboardSseEnvelope {
  id?: number;
  type: 'issue_event' | 'scheduler_event' | 'state_snapshot';
  timestamp: string;
  issueId?: string;
  payload: DashboardSnapshot | Record<string, unknown>;
}

export interface DashboardTranscriptEvent {
  id: number;
  sessionId: number;
  issueId: string;
  turnIndex?: number;
  sequence: number;
  role: 'system' | 'user' | 'assistant' | 'tool' | 'result' | 'error' | 'runtime';
  eventType: string;
  text?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardTranscriptPayload {
  issueId: string;
  events: DashboardTranscriptEvent[];
  nextAfter: number | null;
}

export interface DashboardEventsHistoryPayload {
  events: DashboardSseEnvelope[];
  nextAfter: number | null;
}

export interface DashboardHistoricalIssue {
  issueId: string;
  identifier: string;
  title: string;
  lastObservedAt: string;
  sessionCount: number;
  transcriptEventCount: number;
  dashboardEventCount: number;
  source: 'transcript' | 'dashboard_event';
}

export interface DashboardHistoricalIssuesPayload {
  issues: DashboardHistoricalIssue[];
  nextAfter: number | null;
}

export interface DashboardMessageEventLike {
  data: string;
}

export interface DashboardEventSourceLike {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: DashboardMessageEventLike) => void): void;
  removeEventListener?(type: string, listener: (event: DashboardMessageEventLike) => void): void;
  close(): void;
}

export interface DashboardRuntimeDependencies {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  createEventSource?: (url: string) => DashboardEventSourceLike;
}
