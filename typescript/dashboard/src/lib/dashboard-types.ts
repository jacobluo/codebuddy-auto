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
  type: 'issue_event' | 'scheduler_event' | 'state_snapshot';
  timestamp: string;
  issueId?: string;
  payload: DashboardSnapshot | Record<string, unknown>;
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
