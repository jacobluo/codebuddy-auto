import { getWorkspaceHookScript, runWorkspaceHook } from '../workspace/index.js';
import { createIssueLogger, type RuntimeLogger, type EventBus } from '../logging/index.js';
import type { OrchestratorRuntimeState } from '../spec/index.js';
import type { ServiceConfig } from '../spec/index.js';
import type { TranscriptStore } from '../transcript/index.js';
import {
  buildCodebuddyCommand,
  createRunAttempt,
  runCodebuddyTurn,
  updateTokenUsage,
  type CodebuddyRunnerEvent,
  type SdkSessionStore,
} from '../runner/index.js';
import type { Tracker } from '../tracker/index.js';
import {
  prepareWorkerCommand,
  dispatchLocalIssue,
  type CreateSessionOptions,
  type WorkerHandleStore,
} from '../worker/index.js';
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
  /** Worker promises started this tick (local mode). Useful for shutdown drain. */
  workerPromises?: Promise<void>[];
}

export interface LocalDispatchDeps {
  handleStore: WorkerHandleStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSession: (opts: CreateSessionOptions) => any;
  transcriptStore?: TranscriptStore;
  getConfig?: () => ServiceConfig;
}

export async function runDispatchCycle(
  state: OrchestratorRuntimeState,
  tracker: Tracker,
  config: ServiceConfig,
  promptTemplate = [
    'You are working on {{ issue.identifier }}: {{ issue.title }}.',
    '',
    'Issue details:',
    '{{ issue.description }}',
  ].join('\n'),
  logger?: RuntimeLogger,
  eventBus?: EventBus,
  sessionStore?: SdkSessionStore,
  localDeps?: LocalDispatchDeps,
  transcriptStore?: TranscriptStore,
): Promise<DispatchCycleResult> {
  const issues = await tracker.fetchCandidateIssues();
  const dispatchPlan = planDispatchCycle(state, issues, config);

  // Local-mode dispatch path (Symphony §10.3 long-lived session).
  // SSH mode falls through to the legacy per-turn path below.
  const workerPromises: Promise<void>[] = [];
  if (config.worker.kind === 'local' && localDeps) {
    for (const issue of dispatchPlan.dispatchableIssues) {
      const dispatched = await dispatchLocalIssue({
        issue,
        config,
        state,
        tracker,
        handleStore: localDeps.handleStore,
        promptTemplate,
        logger,
        eventBus,
        createSession: localDeps.createSession,
        transcriptStore: localDeps.transcriptStore,
        getConfig: localDeps.getConfig,
      });
      if (!dispatched.started) {
        // Workspace setup or before_run failed — schedule a retry.
        state.claimed.add(issue.id);
        state.retryAttempts[issue.id] = createRetryEntry({
          issueId: issue.id,
          identifier: issue.identifier,
          previousAttempt: getPreviousAttempt(dispatched.reason ?? 'dispatch_failed', state.retryAttempts[issue.id]),
          reason: dispatched.reason ?? 'dispatch_failed',
          nowMs: Date.now(),
          maxRetryBackoffMs: config.agent.maxRetryBackoffMs,
        });
        continue;
      }
      if (dispatched.workerPromise) {
        workerPromises.push(dispatched.workerPromise);
      }
    }
    return {
      availableSlots: dispatchPlan.availableSlots,
      dispatchableIssueIds: dispatchPlan.dispatchableIssues.map((issue) => issue.id),
      claimedIssueIds: dispatchPlan.dispatchableIssues
        .map((issue) => issue.id)
        .filter((issueId) => state.claimed.has(issueId)),
      workerPromises,
    };
  }

  for (const issue of dispatchPlan.dispatchableIssues) {
    const issueLogger = createIssueLogger(logger, {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      turnCount: 1,
    });
    let runAttempt;
    try {
      runAttempt = await createRunAttempt(issue, config.workspace.root, config);
    } catch (error) {
      state.claimed.add(issue.id);
      state.retryAttempts[issue.id] = createRetryEntry({
        issueId: issue.id,
        identifier: issue.identifier,
        previousAttempt: getPreviousAttempt('workspace_setup_failed', state.retryAttempts[issue.id]),
        reason: 'workspace_setup_failed',
        nowMs: Date.now(),
        maxRetryBackoffMs: config.agent.maxRetryBackoffMs,
      });
      issueLogger?.error(
        {
          reason: 'workspace_setup_failed',
          error: error instanceof Error ? error.message : String(error),
          retryMode: state.retryAttempts[issue.id]?.mode,
          retryAttempt: state.retryAttempts[issue.id]?.attempt,
          retryDueAtMs: state.retryAttempts[issue.id]?.dueAtMs,
        },
        'issue_dispatch_retry_scheduled',
      );
      continue;
    }

    try {
      const transcriptTurnIndex = transcriptStore?.getNextTurnIndex(issue.id) ?? 1;
      const sessionId = `${issue.id}-turn-1`;
      const prompt = renderPrompt(promptTemplate, {
        issue,
        attempt: {
          turnCount: 1,
        },
      });
      const transcriptSession = transcriptStore?.recordSession({
        issueId: issue.id,
        issueTitle: issue.title,
        workspacePath: runAttempt.workspacePath,
        provider: 'cli',
        sdkSessionId: sessionId,
        metadata: {
          issueIdentifier: issue.identifier,
          turnIndex: transcriptTurnIndex,
        },
      });
      const workerCommand = prepareWorkerCommand(buildCodebuddyCommand({
        config,
        prompt,
        sessionId,
        workspacePath: runAttempt.workspacePath,
      }), config);

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

      if (eventBus) {
        eventBus.emit({
          type: 'scheduler_event',
          timestamp: new Date().toISOString(),
          issueId: issue.id,
          payload: { event: 'dispatch_started', identifier: issue.identifier },
        });
      }

      const turnResult = await runCodebuddyTurn({
        command: workerCommand,
        prompt,
        workspacePath: runAttempt.workspacePath,
        config,
        issueId: issue.id,
        readTimeoutMs: config.codebuddy.readTimeoutMs,
        turnTimeoutMs: config.codebuddy.turnTimeoutMs,
        stallTimeoutMs: config.codebuddy.stallTimeoutMs,
        onEvent: eventBus
          ? (evt) => { eventBus.emit({ type: 'issue_event', timestamp: new Date().toISOString(), issueId: issue.id, payload: evt as unknown as Record<string, unknown> }); }
          : undefined,
        eventBus,
        transcriptStore,
        transcriptSessionId: transcriptSession?.id,
        turnIndex: transcriptTurnIndex,
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
      // Task 3.2: register the SDK session for this issue. We use create()
      // here because dispatch is the issue's first turn; subsequent turns
      // come through runContinuationCycle which calls recordTurn().
      if (sessionStore && config.worker.kind === 'local') {
        sessionStore.destroy(issue.id); // defensive: clear any stale entry from a prior run
        sessionStore.create(issue.id, resolvedSessionId);
      }
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
    } catch (error) {
      state.claimed.add(issue.id);
      state.retryAttempts[issue.id] = createRetryEntry({
        issueId: issue.id,
        identifier: issue.identifier,
        previousAttempt: getPreviousAttempt('dispatch_failed', state.retryAttempts[issue.id]),
        reason: 'dispatch_failed',
        nowMs: Date.now(),
        maxRetryBackoffMs: config.agent.maxRetryBackoffMs,
      });
      issueLogger?.error(
        {
          workspacePath: runAttempt.workspacePath,
          lastEvent: 'dispatch_failed',
          error: error instanceof Error ? error.message : String(error),
          retryMode: state.retryAttempts[issue.id]?.mode,
          retryAttempt: state.retryAttempts[issue.id]?.attempt,
          retryDueAtMs: state.retryAttempts[issue.id]?.dueAtMs,
        },
        'issue_dispatch_retry_scheduled',
      );
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
