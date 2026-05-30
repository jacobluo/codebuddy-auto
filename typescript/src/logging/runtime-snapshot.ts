import type { OrchestratorRuntimeState } from '../spec/index.js';

export interface RuntimeSnapshot {
  generatedAt: string;
  counts: {
    running: number;
    retrying: number;
    claimed: number;
    completed: number;
  };
  cleanedWorkspaceIssueIds: string[];
  totals: {
    secondsRunning: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    creditCost: number;
  };
  running: Array<{
    issueId: string;
    identifier: string;
    title: string;
    sessionId: string | null;
    turnCount: number;
    lastEvent: string | null;
    lastEventAt: string | null;
    secondsRunning: number;
    workspacePath: string;
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      creditCost: number;
    };
  }>;
  retrying: Array<{
    issueId: string;
    identifier: string;
    mode: 'continuation' | 'failure';
    attempt: number;
    dueAtMs: number;
    error: string | null;
  }>;
  completedIssueIds: string[];
}

export function createRuntimeSnapshot(
  state: OrchestratorRuntimeState,
  generatedAt = new Date().toISOString(),
): RuntimeSnapshot {
  const running = Object.values(state.running)
    .map((entry) => ({
      issueId: entry.issue.id,
      identifier: entry.issue.identifier,
      title: entry.issue.title,
      sessionId: entry.sessionId,
      turnCount: entry.turnCount,
      lastEvent: entry.lastEvent,
      lastEventAt: entry.lastEventAt,
      secondsRunning: entry.secondsRunning,
      workspacePath: entry.workspacePath,
      tokenUsage: entry.tokenUsage,
    }))
    .sort((left, right) => left.identifier.localeCompare(right.identifier));

  const retrying = Object.values(state.retryAttempts)
    .map((entry) => ({
      issueId: entry.issueId,
      identifier: entry.identifier,
      mode: entry.mode,
      attempt: entry.attempt,
      dueAtMs: entry.dueAtMs,
      error: entry.error,
    }))
    .sort((left, right) => left.dueAtMs - right.dueAtMs || left.identifier.localeCompare(right.identifier));

  const totals = running.reduce(
    (aggregate, entry) => ({
      secondsRunning: aggregate.secondsRunning + entry.secondsRunning,
      inputTokens: aggregate.inputTokens + entry.tokenUsage.inputTokens,
      outputTokens: aggregate.outputTokens + entry.tokenUsage.outputTokens,
      totalTokens: aggregate.totalTokens + entry.tokenUsage.totalTokens,
      cacheCreationInputTokens: aggregate.cacheCreationInputTokens + entry.tokenUsage.cacheCreationInputTokens,
      cacheReadInputTokens: aggregate.cacheReadInputTokens + entry.tokenUsage.cacheReadInputTokens,
      creditCost: aggregate.creditCost + entry.tokenUsage.creditCost,
    }),
    {
      secondsRunning: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      creditCost: 0,
    },
  );

  return {
    generatedAt,
    counts: {
      running: Object.keys(state.running).length,
      retrying: Object.keys(state.retryAttempts).length,
      claimed: state.claimed.size,
      completed: state.completed.size,
    },
    cleanedWorkspaceIssueIds: [],
    totals,
    running,
    retrying,
    completedIssueIds: Array.from(state.completed).sort(),
  };
}
