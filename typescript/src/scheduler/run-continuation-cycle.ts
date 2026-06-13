import { createIssueLogger, type RuntimeLogger, type EventBus } from '../logging/index.js';
import type { CodebuddyRunnerEvent, SdkSessionStore } from '../runner/index.js';
import { buildCodebuddyCommand, runCodebuddyTurn, updateTokenUsage } from '../runner/index.js';
import type { Issue, ServiceConfig, OrchestratorRuntimeState, RetryEntry } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';
import { prepareWorkerCommand } from '../worker/index.js';
import { createProgressFingerprint, recordProgressFingerprint } from '../progress/index.js';
import { renderPrompt } from '../workflow/index.js';

import { createRetryEntry } from './create-retry-entry.js';

export interface ContinuationCycleResult {
  continuedIssueIds: string[];
  releasedIssueIds: string[];
}

const CONTINUATION_PROMPT_TEMPLATE = [
  'Continue working on {{ issue.identifier }}: {{ issue.title }}.',
  'Issue details:',
  '{{ issue.description }}',
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
  tracker?: Tracker,
  eventBus?: EventBus,
  sessionStore?: SdkSessionStore,
): Promise<ContinuationCycleResult> {
  const nowMs = Date.now();
  const continuedIssueIds: string[] = [];
  const releasedIssueIds: string[] = [];

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

    if (state.stuck[issueId]) {
      delete state.retryAttempts[issueId];
      state.claimed.delete(issueId);
      continue;
    }

    let latestIssueState: Pick<Issue, 'id' | 'state' | 'labels'> | undefined;
    if (tracker) {
      try {
        const stateSnapshot = await tracker.fetchIssueStatesByIds([issueId]);
        const issueState = stateSnapshot.get(issueId);
        latestIssueState = issueState;
        const isActive = issueState
          ? config.tracker.activeStates.some((s) => s.toLowerCase() === issueState.state.toLowerCase())
          : false;
        const isTerminal = issueState
          ? config.tracker.terminalStates.some((s) => s.toLowerCase() === issueState.state.toLowerCase())
          : false;
        const finishLabel = config.tracker.finishLabel ?? tracker.getFinishLabel?.();
        const hasFinishLabel = finishLabel && issueState
          ? issueState.labels.some((l) => l.toLowerCase() === finishLabel.toLowerCase())
          : false;

        if (!isActive || isTerminal || hasFinishLabel) {
          delete state.running[issueId];
          delete state.retryAttempts[issueId];
          state.claimed.delete(issueId);
          state.completed.add(issueId);
          delete state.stuck[issueId];
          // Task 3.4: drop the SDK session when the issue is no longer active.
          sessionStore?.destroy(issueId);
          releasedIssueIds.push(issueId);
          const releaseLogger = createIssueLogger(logger, {
            issueId,
            issueIdentifier: runningEntry.issue.identifier,
            sessionId: runningEntry.sessionId,
            turnCount: runningEntry.turnCount,
          });
          releaseLogger?.info(
            {
              trackerState: issueState?.state ?? 'unknown',
              hasFinishLabel,
              reason: hasFinishLabel ? 'agent_finished' : 'issue_no_longer_active',
            },
            'issue_released_before_continuation',
          );
          continue;
        }
      } catch {
        // Tracker fetch failure: proceed with continuation (try again next tick)
      }
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

    try {
      const command = prepareWorkerCommand(buildCodebuddyCommand({
        config,
        prompt,
        sessionId,
        resumeSessionId: runningEntry.sessionId ?? undefined,
        workspacePath: runningEntry.workspacePath,
      }), config);
      const turnResult = await runCodebuddyTurn({
        command,
        prompt,
        workspacePath: runningEntry.workspacePath,
        config,
        issueId,
        resumeSessionId: runningEntry.sessionId ?? undefined,
        readTimeoutMs: config.codebuddy.readTimeoutMs,
        turnTimeoutMs: config.codebuddy.turnTimeoutMs,
        stallTimeoutMs: config.codebuddy.stallTimeoutMs,
        onEvent: eventBus
          ? (evt) => { eventBus.emit({ type: 'issue_event', timestamp: new Date().toISOString(), issueId, payload: evt as unknown as Record<string, unknown> }); }
          : undefined,
        eventBus,
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
      // Task 3.3: refresh session metadata after each successful turn so the
      // store mirrors runningEntry.sessionId. recordTurn() is also defensive
      // when the entry is missing (creates a fresh one).
      if (sessionStore && config.worker.kind === 'local' && runningEntry.sessionId) {
        sessionStore.recordTurn(issueId, runningEntry.sessionId);
      }
      delete state.retryAttempts[issueId];

      if (lastEvent === 'turn_completed' && nextTurnCount < config.agent.maxTurns) {
        const progress = await createProgressFingerprint({
          issueId,
          identifier: runningEntry.issue.identifier,
          workspacePath: runningEntry.workspacePath,
          trackerState: latestIssueState
            ? { state: latestIssueState.state, labels: latestIssueState.labels }
            : undefined,
          lastEvent,
        });
        const nextProgress = recordProgressFingerprint(
          state.progress[issueId],
          progress,
          config.agent.noProgressThreshold,
        );
        state.progress[issueId] = nextProgress;
        if (eventBus) {
          eventBus.emit({
            type: 'issue_event',
            timestamp: new Date().toISOString(),
            issueId,
            payload: {
              event: 'progress_fingerprint_recorded',
              repeatedCount: nextProgress.repeatedCount,
              stuck: nextProgress.stuck !== null,
            },
          });
        }
        if (nextProgress.stuck) {
          state.stuck[issueId] = nextProgress.stuck;
          delete state.running[issueId];
          delete state.retryAttempts[issueId];
          state.claimed.delete(issueId);
          sessionStore?.destroy(issueId);
          if (eventBus) {
            eventBus.emit({
              type: 'issue_event',
              timestamp: new Date().toISOString(),
              issueId,
              payload: {
                event: 'issue_stuck',
                reason: nextProgress.stuck.reason,
                repeatedCount: nextProgress.stuck.repeatedCount,
              },
            });
          }
          continue;
        }
        delete state.stuck[issueId];
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
        // Max turns reached — release the issue from running state
        delete state.running[issueId];
        delete state.retryAttempts[issueId];
        state.claimed.delete(issueId);
        state.stuck[issueId] = {
          reason: 'max_turns_reached',
          repeatedCount: state.progress[issueId]?.repeatedCount ?? 1,
          fingerprint: state.progress[issueId]?.fingerprint ?? 'max_turns_reached',
        };
        // Task 3.4: drop the SDK session when maxTurns is hit.
        sessionStore?.destroy(issueId);

        issueLogger?.info(
          {
            workspacePath: runningEntry.workspacePath,
            secondsRunning: runningEntry.secondsRunning,
            totalTokens: runningEntry.tokenUsage.totalTokens,
          },
          'issue_continuation_completed_max_turns',
        );
      }
    } catch (error) {
      runningEntry.lastEvent = 'continuation_failed';
      runningEntry.lastEventAt = new Date().toISOString();
      state.retryAttempts[issueId] = createRetryEntry({
        issueId,
        identifier: runningEntry.issue.identifier,
        previousAttempt: getPreviousAttempt(retryEntry, 'continuation_failed'),
        reason: 'continuation_failed',
        nowMs: Date.now(),
        maxRetryBackoffMs: config.agent.maxRetryBackoffMs,
      });
      issueLogger?.error(
        {
          workspacePath: runningEntry.workspacePath,
          lastEvent: 'continuation_failed',
          error: error instanceof Error ? error.message : String(error),
          retryMode: state.retryAttempts[issueId]?.mode,
          retryAttempt: state.retryAttempts[issueId]?.attempt,
          retryDueAtMs: state.retryAttempts[issueId]?.dueAtMs,
        },
        'issue_continuation_retry_scheduled',
      );
    }

    continuedIssueIds.push(issueId);
  }

  return {
    continuedIssueIds,
    releasedIssueIds,
  };
}
