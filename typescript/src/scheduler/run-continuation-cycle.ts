import { createIssueLogger, type RuntimeLogger } from '../logging/index.js';
import type { CodebuddyRunnerEvent } from '../runner/index.js';
import { buildCodebuddyCommand, runCodebuddyTurn, updateTokenUsage } from '../runner/index.js';
import type { ServiceConfig, OrchestratorRuntimeState, RetryEntry } from '../spec/index.js';
import { renderPrompt } from '../workflow/index.js';

import { createRetryEntry } from './create-retry-entry.js';

export interface ContinuationCycleResult {
  continuedIssueIds: string[];
}

const CONTINUATION_PROMPT_TEMPLATE = [
  'Continue working on {{ issue.identifier }}: {{ issue.title }}.',
  'This is continuation turn {{ attempt.turnCount }}.',
].join(' ');

function resolveSessionId(
  issueId: string,
  turnCount: number,
  existingSessionId: string | null,
  events: CodebuddyRunnerEvent[],
): string {
  const sessionStarted = events.find(
    (event): event is Extract<CodebuddyRunnerEvent, { event: 'session_started' }> => event.event === 'session_started',
  );
  return sessionStarted?.payload.sessionId ?? existingSessionId ?? `${issueId}-turn-${turnCount}`;
}

function getPreviousAttempt(retryEntry: RetryEntry | undefined, reason: string): number {
  const nextMode = reason === 'turn_completed' ? 'continuation' : 'failure';
  if (!retryEntry || retryEntry.mode !== nextMode) {
    return 0;
  }

  return retryEntry.attempt;
}

export async function runContinuationCycle(
  state: OrchestratorRuntimeState,
  config: ServiceConfig,
  logger?: RuntimeLogger,
): Promise<ContinuationCycleResult> {
  const nowMs = Date.now();
  const continuedIssueIds: string[] = [];

  for (const [issueId, retryEntry] of Object.entries(state.retryAttempts)) {
    if (retryEntry.dueAtMs > nowMs) {
      continue;
    }

    const runningEntry = state.running[issueId];
    if (!runningEntry) {
      delete state.retryAttempts[issueId];
      state.claimed.delete(issueId);
      continue;
    }

    const nextTurnCount = runningEntry.turnCount + 1;
    const issueLogger = createIssueLogger(logger, {
      issueId,
      issueIdentifier: runningEntry.issue.identifier,
      sessionId: runningEntry.sessionId,
      turnCount: nextTurnCount,
    });
    const sessionId = `${issueId}-turn-${nextTurnCount}`;
    const prompt = renderPrompt(CONTINUATION_PROMPT_TEMPLATE, {
      issue: runningEntry.issue,
      attempt: {
        turnCount: nextTurnCount,
      },
    });

    const command = buildCodebuddyCommand({
      config,
      prompt,
      sessionId,
      resumeSessionId: runningEntry.sessionId ?? undefined,
      workspacePath: runningEntry.workspacePath,
    });
    const turnResult = await runCodebuddyTurn({
      command,
      readTimeoutMs: config.codebuddy.readTimeoutMs,
      turnTimeoutMs: config.codebuddy.turnTimeoutMs,
      stallTimeoutMs: config.codebuddy.stallTimeoutMs,
    });

    const lastEvent = turnResult.events.at(-1)?.event ?? null;
    const tokenUsageUpdate = updateTokenUsage(
      {
        totals: runningEntry.tokenUsage,
        lastReportedTotals: runningEntry.lastReportedTotals,
        latestCreditCost: null,
      },
      turnResult.events,
    );
    const turnCompleted = turnResult.events.find((event) => event.event === 'turn_completed');
    runningEntry.sessionId = resolveSessionId(issueId, nextTurnCount, runningEntry.sessionId, turnResult.events);
    runningEntry.turnCount = nextTurnCount;
    runningEntry.lastEvent = lastEvent;
    runningEntry.lastEventAt = new Date().toISOString();
    runningEntry.secondsRunning += Math.max((turnCompleted?.payload.durationMs ?? 0) / 1000, 0);
    runningEntry.tokenUsage = tokenUsageUpdate.totals;
    runningEntry.lastReportedTotals = tokenUsageUpdate.lastReportedTotals;
    delete state.retryAttempts[issueId];

    if (lastEvent === 'turn_completed' && nextTurnCount < config.agent.maxTurns) {
      state.retryAttempts[issueId] = createRetryEntry({
        issueId,
        identifier: runningEntry.issue.identifier,
        previousAttempt: getPreviousAttempt(retryEntry, lastEvent),
        reason: lastEvent,
        nowMs: Date.now(),
        maxRetryBackoffMs: config.agent.maxRetryBackoffMs,
      });
      issueLogger?.info(
        {
          workspacePath: runningEntry.workspacePath,
          secondsRunning: runningEntry.secondsRunning,
          totalTokens: runningEntry.tokenUsage.totalTokens,
          retryMode: state.retryAttempts[issueId]?.mode,
          retryAttempt: state.retryAttempts[issueId]?.attempt,
          retryDueAtMs: state.retryAttempts[issueId]?.dueAtMs,
        },
        'issue_continuation_succeeded',
      );
    } else if (lastEvent !== 'turn_completed') {
      state.retryAttempts[issueId] = createRetryEntry({
        issueId,
        identifier: runningEntry.issue.identifier,
        previousAttempt: getPreviousAttempt(retryEntry, lastEvent ?? 'unknown_error'),
        reason: lastEvent ?? 'unknown_error',
        nowMs: Date.now(),
        maxRetryBackoffMs: config.agent.maxRetryBackoffMs,
      });
      issueLogger?.error(
        {
          workspacePath: runningEntry.workspacePath,
          lastEvent,
          retryMode: state.retryAttempts[issueId]?.mode,
          retryAttempt: state.retryAttempts[issueId]?.attempt,
          retryDueAtMs: state.retryAttempts[issueId]?.dueAtMs,
        },
        'issue_continuation_retry_scheduled',
      );
    } else {
      issueLogger?.info(
        {
          workspacePath: runningEntry.workspacePath,
          secondsRunning: runningEntry.secondsRunning,
          totalTokens: runningEntry.tokenUsage.totalTokens,
        },
        'issue_continuation_completed_max_turns',
      );
    }

    continuedIssueIds.push(issueId);
  }

  return {
    continuedIssueIds,
  };
}
