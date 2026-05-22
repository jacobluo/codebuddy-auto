import { getWorkspaceHookScript, runWorkspaceHook } from '../workspace/index.js';
import { createIssueLogger, type RuntimeLogger } from '../logging/index.js';
import type { OrchestratorRuntimeState } from '../spec/index.js';
import type { ServiceConfig } from '../spec/index.js';
import {
  buildCodebuddyCommand,
  createRunAttempt,
  runCodebuddyTurn,
  updateTokenUsage,
  type CodebuddyRunnerEvent,
} from '../runner/index.js';
import type { Tracker } from '../tracker/index.js';
import { createRetryEntry } from './create-retry-entry.js';
import { planDispatchCycle } from './plan-dispatch-cycle.js';
import { renderPrompt } from '../workflow/index.js';

function resolveSessionId(
  issueId: string,
  existingSessionId: string,
  events: CodebuddyRunnerEvent[],
): string {
  const sessionStarted = events.find(
    (event): event is Extract<CodebuddyRunnerEvent, { event: 'session_started' }> => event.event === 'session_started',
  );
  return sessionStarted?.payload.sessionId ?? existingSessionId ?? `${issueId}-turn-1`;
}

function getPreviousAttempt(reason: string, previousRetryEntry: OrchestratorRuntimeState['retryAttempts'][string] | undefined): number {
  const nextMode = reason === 'turn_completed' ? 'continuation' : 'failure';
  if (!previousRetryEntry || previousRetryEntry.mode !== nextMode) {
    return 0;
  }

  return previousRetryEntry.attempt;
}

export interface DispatchCycleResult {
  availableSlots: number;
  dispatchableIssueIds: string[];
  claimedIssueIds: string[];
}

export async function runDispatchCycle(
  state: OrchestratorRuntimeState,
  tracker: Tracker,
  config: ServiceConfig,
  promptTemplate = 'You are working on {{ issue.identifier }}: {{ issue.title }}',
  logger?: RuntimeLogger,
): Promise<DispatchCycleResult> {
  const issues = await tracker.fetchCandidateIssues();
  const dispatchPlan = planDispatchCycle(state, issues, config);

  for (const issue of dispatchPlan.dispatchableIssues) {
    const issueLogger = createIssueLogger(logger, {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      turnCount: 1,
    });
    const runAttempt = await createRunAttempt(issue, config.workspace.root, config);
    const sessionId = `${issue.id}-turn-1`;
    const prompt = renderPrompt(promptTemplate, {
      issue,
      attempt: {
        turnCount: 1,
      },
    });
    const command = buildCodebuddyCommand({
      config,
      prompt,
      sessionId,
      workspacePath: runAttempt.workspacePath,
    });

    const beforeRunScript = getWorkspaceHookScript(config, 'beforeRun');
    if (beforeRunScript) {
      const hookResult = await runWorkspaceHook({
        script: beforeRunScript,
        workspacePath: runAttempt.workspacePath,
        timeoutMs: config.hooks.timeoutMs,
      });

      if (hookResult.timedOut || hookResult.exitCode !== 0) {
        const reason = hookResult.timedOut ? 'before_run_timeout' : 'before_run_failed';
        state.claimed.add(issue.id);
        state.retryAttempts[issue.id] = createRetryEntry({
          issueId: issue.id,
          identifier: issue.identifier,
          previousAttempt: getPreviousAttempt(reason, state.retryAttempts[issue.id]),
          reason,
          nowMs: Date.now(),
          maxRetryBackoffMs: config.agent.maxRetryBackoffMs,
        });
        issueLogger?.error({ workspacePath: runAttempt.workspacePath, reason }, 'issue_before_run_hook_failed');
        continue;
      }
    }

    const turnResult = await runCodebuddyTurn({
      command,
      readTimeoutMs: config.codebuddy.readTimeoutMs,
      turnTimeoutMs: config.codebuddy.turnTimeoutMs,
      stallTimeoutMs: config.codebuddy.stallTimeoutMs,
    });

    const lastEvent = turnResult.events.at(-1)?.event ?? null;
    const previousRetryEntry = state.retryAttempts[issue.id];
    const resolvedSessionId = resolveSessionId(issue.id, sessionId, turnResult.events);
    const sessionLogger = createIssueLogger(issueLogger, {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      sessionId: resolvedSessionId,
      turnCount: 1,
    });

    if (lastEvent !== 'turn_completed') {
      state.claimed.add(issue.id);
      state.retryAttempts[issue.id] = createRetryEntry({
        issueId: issue.id,
        identifier: issue.identifier,
        previousAttempt: getPreviousAttempt(lastEvent ?? 'unknown_error', previousRetryEntry),
        reason: lastEvent ?? 'unknown_error',
        nowMs: Date.now(),
        maxRetryBackoffMs: config.agent.maxRetryBackoffMs,
      });
      sessionLogger?.error(
        {
          workspacePath: runAttempt.workspacePath,
          lastEvent,
          retryMode: state.retryAttempts[issue.id]?.mode,
          retryAttempt: state.retryAttempts[issue.id]?.attempt,
          retryDueAtMs: state.retryAttempts[issue.id]?.dueAtMs,
        },
        'issue_dispatch_retry_scheduled',
      );
      continue;
    }

    const tokenUsageUpdate = updateTokenUsage(
      {
        totals: runAttempt.runningEntry.tokenUsage,
        lastReportedTotals: runAttempt.runningEntry.lastReportedTotals,
        latestCreditCost: null,
      },
      turnResult.events,
    );

    state.running[issue.id] = {
      ...runAttempt.runningEntry,
      sessionId: resolvedSessionId,
      turnCount: 1,
      lastEvent,
      lastEventAt: new Date().toISOString(),
      secondsRunning: Math.max((turnResult.events.find((event) => event.event === 'turn_completed')?.payload.durationMs ?? 0) / 1000, 0),
      tokenUsage: tokenUsageUpdate.totals,
      lastReportedTotals: tokenUsageUpdate.lastReportedTotals,
    };
    state.claimed.add(issue.id);
    state.retryAttempts[issue.id] = createRetryEntry({
      issueId: issue.id,
      identifier: issue.identifier,
      previousAttempt: getPreviousAttempt(lastEvent, previousRetryEntry),
      reason: lastEvent,
      nowMs: Date.now(),
      maxRetryBackoffMs: config.agent.maxRetryBackoffMs,
    });
    sessionLogger?.info(
      {
        workspacePath: runAttempt.workspacePath,
        secondsRunning: state.running[issue.id]?.secondsRunning,
        totalTokens: state.running[issue.id]?.tokenUsage.totalTokens,
        retryMode: state.retryAttempts[issue.id]?.mode,
        retryAttempt: state.retryAttempts[issue.id]?.attempt,
        retryDueAtMs: state.retryAttempts[issue.id]?.dueAtMs,
      },
      'issue_dispatch_succeeded',
    );

    const afterRunScript = getWorkspaceHookScript(config, 'afterRun');
    if (afterRunScript) {
      const hookResult = await runWorkspaceHook({
        script: afterRunScript,
        workspacePath: runAttempt.workspacePath,
        timeoutMs: config.hooks.timeoutMs,
      });
      if (hookResult.timedOut || hookResult.exitCode !== 0) {
        sessionLogger?.error({ workspacePath: runAttempt.workspacePath }, 'issue_after_run_hook_failed');
      }
    }
  }

  return {
    availableSlots: dispatchPlan.availableSlots,
    dispatchableIssueIds: dispatchPlan.dispatchableIssues.map((issue) => issue.id),
    claimedIssueIds: dispatchPlan.dispatchableIssues
      .map((issue) => issue.id)
      .filter((issueId) => state.claimed.has(issueId)),
  };
}
