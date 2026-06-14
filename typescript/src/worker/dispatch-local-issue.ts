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
import type { TranscriptStore } from '../transcript/index.js';
import type { Tracker } from '../tracker/index.js';
import { createRunAttempt } from '../runner/index.js';
import { createProgressFingerprint, recordProgressFingerprint } from '../progress/index.js';
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
  transcriptStore?: TranscriptStore;
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
    let exitReason: string | undefined;
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
        transcriptStore: input.transcriptStore,
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
        onTurnComplete: ({ turnCount, durationMs, sessionId, usage }) => {
          const running = input.state.running[input.issue.id];
          if (running) {
            running.turnCount = turnCount;
            running.sessionId = sessionId || running.sessionId;
            running.lastEvent = 'turn_completed';
            running.lastEventAt = new Date().toISOString();
            running.secondsRunning += Math.max(durationMs / 1000, 0);
            // Token usage: the SDK reports absolute cumulative totals per
            // turn. We track absolute (overwrites running.tokenUsage)
            // and the per-turn delta against `lastReportedTotals`. See
            // Symphony §13.5 / src/runner/token-usage.ts for the reference
            // model the legacy SDK runner used.
            if (usage) {
              const last = running.lastReportedTotals;
              const dInput = Math.max(0, usage.inputTokens - last.inputTokens);
              const dOutput = Math.max(0, usage.outputTokens - last.outputTokens);
              const dCacheCreate = Math.max(0, usage.cacheCreationInputTokens - last.cacheCreationInputTokens);
              const dCacheRead = Math.max(0, usage.cacheReadInputTokens - last.cacheReadInputTokens);
              running.tokenUsage = {
                inputTokens: running.tokenUsage.inputTokens + dInput,
                outputTokens: running.tokenUsage.outputTokens + dOutput,
                totalTokens: running.tokenUsage.totalTokens + dInput + dOutput,
                cacheCreationInputTokens: running.tokenUsage.cacheCreationInputTokens + dCacheCreate,
                cacheReadInputTokens: running.tokenUsage.cacheReadInputTokens + dCacheRead,
                creditCost: running.tokenUsage.creditCost,
              };
              running.lastReportedTotals = {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cacheCreationInputTokens: usage.cacheCreationInputTokens,
                cacheReadInputTokens: usage.cacheReadInputTokens,
              };
            }
          }
        },
        onProgress: async ({ trackerState, lastEvent }) => {
          const progress = await createProgressFingerprint({
            issueId: input.issue.id,
            identifier: input.issue.identifier,
            workspacePath: runAttempt.workspacePath,
            trackerState,
            lastEvent,
          });
          const next = recordProgressFingerprint(
            input.state.progress[input.issue.id],
            progress,
            (input.getConfig?.() ?? input.config).agent.noProgressThreshold,
          );
          input.state.progress[input.issue.id] = next;
          if (input.eventBus) {
            input.eventBus.emit({
              type: 'issue_event',
              timestamp: new Date().toISOString(),
              issueId: input.issue.id,
              payload: {
                event: 'progress_fingerprint_recorded',
                repeatedCount: next.repeatedCount,
                stuck: next.stuck !== null,
              },
            });
          }
          if (next.stuck) {
            input.state.stuck[input.issue.id] = next.stuck;
            if (input.eventBus) {
              input.eventBus.emit({
                type: 'issue_event',
                timestamp: new Date().toISOString(),
                issueId: input.issue.id,
                payload: {
                  event: 'issue_stuck',
                  reason: next.stuck.reason,
                  repeatedCount: next.stuck.repeatedCount,
                },
              });
            }
            return 'stuck';
          }
          delete input.state.stuck[input.issue.id];
          return 'continue';
        },
      });
      exitReason = result.exitReason;

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

      // Claim handling depends on exit reason. The goal is: the scheduler
      // should NOT keep an issue claimed forever after a transient failure,
      // and SHOULD treat a successful run (or one whose tracker state is
      // already terminal) as completed.
      //
      //   finish_label_observed / issue_inactive
      //     → terminal for this scheduler. Drop claim, add to completed.
      //   max_turns_reached / stuck_no_progress
      //     → non-handoff stuck states. Drop claim, do not add completed.
      //   graceful_exit_requested
      //     → reconcile already deleted any retry table entries; mirror that
      //       and add to completed so the same tick doesn't re-evaluate.
      //   aborted (SIGINT)
      //     → daemon is shutting down; leave claim/completed untouched so
      //       the next process inherits a clean restart-recovery model.
      //   turn_failed / turn_timed_out / startup_failed (or undefined on
      //   uncaught exception)
      //     → drop claim so the next tick can retry. Do NOT add to completed.
      const TERMINAL = new Set(['finish_label_observed', 'issue_inactive', 'graceful_exit_requested']);
      const RETRYABLE = new Set(['turn_failed', 'turn_timed_out', 'startup_failed']);

      if (exitReason === 'aborted') {
        // leave both `claimed` and `completed` alone
      } else if (exitReason && TERMINAL.has(exitReason)) {
        input.state.claimed.delete(input.issue.id);
        input.state.completed.add(input.issue.id);
        delete input.state.stuck[input.issue.id];
      } else if (exitReason === 'max_turns_reached') {
        input.state.claimed.delete(input.issue.id);
        const latest = input.state.progress[input.issue.id];
        input.state.stuck[input.issue.id] = {
          reason: 'max_turns_reached',
          repeatedCount: latest?.repeatedCount ?? 1,
          fingerprint: latest?.fingerprint ?? 'max_turns_reached',
        };
      } else if (exitReason === 'stuck_no_progress') {
        input.state.claimed.delete(input.issue.id);
      } else if (exitReason === undefined || RETRYABLE.has(exitReason)) {
        input.state.claimed.delete(input.issue.id);
      }

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
