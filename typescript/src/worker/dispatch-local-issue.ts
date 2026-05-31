/**
 * dispatchLocalIssue — glue between the scheduler and the long-lived
 * IssueWorker for `worker.kind === 'local'`.
 *
 * Lifecycle (per dispatched issue):
 *   1. workspace prep:
 *      - createRunAttempt() → workspace path + RunningEntry skeleton
 *      - run before_run hook; on hook failure, schedule retry and bail
 *   2. seed `state.running[issueId]` with the RunningEntry (so subsequent
 *      ticks see this issue as live and dispatch's plan-cycle excludes it)
 *   3. register a fresh `WorkerHandle` in the WorkerHandleStore
 *   4. start `runIssueWorker(...)` as a background promise (DO NOT await)
 *   5. on worker exit (success or failure): drop `state.running[issueId]`,
 *      mark `state.completed`, run after_run hook
 *
 * The function returns immediately after step 4 — the scheduler tick is
 * therefore not blocked by the worker's actual runtime, which can span
 * minutes.
 *
 * Concurrency cap is enforced upstream by `planDispatchCycle` counting
 * `state.running` size before deciding which issues to dispatch.
 */

import { createIssueLogger, type EventBus, type RuntimeLogger } from '../logging/index.js';
import type { CodebuddyRunnerEvent } from '../runner/run-codebuddy-turn.js';
import type { Issue, OrchestratorRuntimeState, ServiceConfig } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';
import { createRunAttempt } from '../runner/index.js';
import { renderPrompt } from '../workflow/index.js';
import { getWorkspaceHookScript, runWorkspaceHook } from '../workspace/index.js';

import { runIssueWorker, type CreateSessionOptions } from './run-issue-worker.js';
import type { WorkerHandleStore } from './worker-handle-store.js';

export interface DispatchLocalIssueInput {
  issue: Issue;
  config: ServiceConfig;
  state: OrchestratorRuntimeState;
  tracker: Tracker;
  handleStore: WorkerHandleStore;
  promptTemplate: string;
  logger?: RuntimeLogger;
  eventBus?: EventBus;
  /**
   * Factory for the SDK Session. Production wires this to
   * `createSdkSession(...)`; tests inject a FakeSdk-backed factory.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSession: (opts: CreateSessionOptions) => any;
  /**
   * Optional getter for the live ServiceConfig; let the worker see
   * config-reload at the next turn boundary. Defaults to returning the
   * snapshot.
   */
  getConfig?: () => ServiceConfig;
}

export interface DispatchLocalIssueResult {
  /** True when the worker promise was started. */
  started: boolean;
  /**
   * The background promise. Tests/shutdown code may await this; the
   * scheduler tick deliberately does not.
   */
  workerPromise?: Promise<void>;
  /** When `started` is false, the reason the dispatch was deferred. */
  reason?: 'workspace_setup_failed' | 'before_run_failed' | 'before_run_timeout';
}

export async function dispatchLocalIssue(
  input: DispatchLocalIssueInput,
): Promise<DispatchLocalIssueResult> {
  const issueLogger = createIssueLogger(input.logger, {
    issueId: input.issue.id,
    issueIdentifier: input.issue.identifier,
    turnCount: 0,
  });

  // 1. Workspace.
  let runAttempt;
  try {
    runAttempt = await createRunAttempt(input.issue, input.config.workspace.root, input.config);
  } catch (error) {
    issueLogger?.error(
      {
        reason: 'workspace_setup_failed',
        error: error instanceof Error ? error.message : String(error),
      },
      'issue_dispatch_failed',
    );
    return { started: false, reason: 'workspace_setup_failed' };
  }

  // 2. before_run hook.
  const beforeRunScript = getWorkspaceHookScript(input.config, 'beforeRun');
  if (beforeRunScript) {
    const hookResult = await runWorkspaceHook({
      script: beforeRunScript,
      workspacePath: runAttempt.workspacePath,
      timeoutMs: input.config.hooks.timeoutMs,
    });
    if (hookResult.timedOut || hookResult.exitCode !== 0) {
      const reason = hookResult.timedOut ? 'before_run_timeout' : 'before_run_failed';
      issueLogger?.error(
        { workspacePath: runAttempt.workspacePath, reason },
        'issue_before_run_hook_failed',
      );
      return { started: false, reason };
    }
  }

  // 3. Seed state.running so subsequent ticks see the issue as live.
  input.state.running[input.issue.id] = runAttempt.runningEntry;
  input.state.claimed.add(input.issue.id);

  if (input.eventBus) {
    input.eventBus.emit({
      type: 'scheduler_event',
      timestamp: new Date().toISOString(),
      issueId: input.issue.id,
      payload: { event: 'dispatch_started', identifier: input.issue.identifier },
    });
  }

  // 4. Render initial prompt for the worker.
  const initialPrompt = renderPrompt(input.promptTemplate, {
    issue: input.issue,
    attempt: { turnCount: 1 },
  });

  // 5. Kick off the worker. We deliberately do NOT await.
  const workerPromise = (async () => {
    try {
      const result = await runIssueWorker({
        issue: input.issue,
        workspacePath: runAttempt.workspacePath,
        config: input.config,
        getConfig: input.getConfig,
        tracker: input.tracker,
        handleStore: input.handleStore,
        createSession: input.createSession,
        initialPrompt,
        onWorkerEvent: (evt) => {
          if (input.eventBus) {
            input.eventBus.emit({
              type: 'issue_event',
              timestamp: new Date().toISOString(),
              issueId: input.issue.id,
              payload: evt as unknown as Record<string, unknown>,
            });
          }
          // Mirror to onEvent-style consumers via a CodebuddyRunnerEvent-shaped object.
          const runnerShape = evt as unknown as CodebuddyRunnerEvent;
          if (runnerShape.event === 'turn_completed' || runnerShape.event === 'turn_failed') {
            const running = input.state.running[input.issue.id];
            if (running) {
              running.lastEvent = runnerShape.event;
              running.lastEventAt = new Date().toISOString();
            }
          }
        },
        onTurnComplete: ({ turnCount, durationMs, sessionId }) => {
          const running = input.state.running[input.issue.id];
          if (running) {
            running.turnCount = turnCount;
            running.sessionId = sessionId || running.sessionId;
            running.lastEvent = 'turn_completed';
            running.lastEventAt = new Date().toISOString();
            running.secondsRunning += Math.max(durationMs / 1000, 0);
          }
        },
      });

      issueLogger?.info(
        {
          workspacePath: runAttempt.workspacePath,
          exitReason: result.exitReason,
          turnCount: result.turnCount,
          sessionId: result.sessionId,
        },
        'issue_worker_completed',
      );
    } catch (error) {
      issueLogger?.error(
        {
          workspacePath: runAttempt.workspacePath,
          error: error instanceof Error ? error.message : String(error),
        },
        'issue_worker_crashed',
      );
    } finally {
      // Drop running state; worker handle is released by runIssueWorker.
      delete input.state.running[input.issue.id];
      input.state.completed.add(input.issue.id);

      const afterRunScript = getWorkspaceHookScript(input.config, 'afterRun');
      if (afterRunScript) {
        try {
          const hookResult = await runWorkspaceHook({
            script: afterRunScript,
            workspacePath: runAttempt.workspacePath,
            timeoutMs: input.config.hooks.timeoutMs,
          });
          if (hookResult.timedOut || hookResult.exitCode !== 0) {
            issueLogger?.error(
              { workspacePath: runAttempt.workspacePath },
              'issue_after_run_hook_failed',
            );
          }
        } catch (error) {
          issueLogger?.error(
            {
              workspacePath: runAttempt.workspacePath,
              error: error instanceof Error ? error.message : String(error),
            },
            'issue_after_run_hook_crashed',
          );
        }
      }
    }
  })();

  return { started: true, workerPromise };
}
