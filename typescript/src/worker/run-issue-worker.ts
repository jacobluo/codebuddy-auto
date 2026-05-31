/**
 * runIssueWorker — the per-issue, long-lived async worker that drives a
 * single CodeBuddy SDK session through N turns.
 *
 * Invoked once per dispatch in `worker.kind === 'local'` mode. The function
 * runs to completion in the background while `runDispatchCycle` returns
 * immediately.
 *
 * Lifecycle:
 *   1. createSession(...) — produces a long-lived `Session`
 *   2. session.connect()
 *   3. Loop:
 *      a. Build prompt (rendered task prompt for turn 1, continuation
 *         guidance otherwise) and `session.send(prompt)`
 *      b. Iterate `session.stream()` until a `result` message
 *      c. Increment turnCount; emit turn_completed / turn_failed
 *      d. Re-fetch tracker state
 *      e. Break if: graceful exit requested, finish_label observed,
 *         tracker no longer active, OR turnCount >= maxTurns
 *      f. Otherwise continue at (a)
 *   4. session.close() (always, in finally)
 *   5. Apply safety-net `agent-finish` label if exit reason was max_turns
 *      (preserves existing behaviour).
 *
 * Exit reasons:
 *   - finish_label_observed   — tracker now has finishLabel after turn N
 *   - issue_inactive          — tracker state no longer in activeStates
 *   - max_turns_reached       — turnCount === agent.maxTurns
 *   - graceful_exit_requested — reconcile flipped the cooperative flag
 *   - turn_timed_out          — wall-clock turnTimeoutMs hit
 *   - turn_failed             — stream-level error
 *   - startup_failed          — connect()/createSession threw before turn 1
 *   - aborted                 — abortController.abort() called externally (SIGINT)
 *
 * Design references:
 *   openspec/changes/sdk-multi-turn-worker/design.md §1, §3, §6
 *   openspec/changes/sdk-multi-turn-worker/specs/sdk-multi-turn-worker/spec.md
 */

import type { Session } from '@tencent-ai/agent-sdk';

import type { Issue, ServiceConfig, WorkerHandle } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';
import type { WorkerHandleStore } from './worker-handle-store.js';

export type IssueWorkerExitReason =
  | 'finish_label_observed'
  | 'issue_inactive'
  | 'max_turns_reached'
  | 'graceful_exit_requested'
  | 'turn_timed_out'
  | 'turn_failed'
  | 'startup_failed'
  | 'aborted';

export interface IssueWorkerResult {
  exitReason: IssueWorkerExitReason;
  turnCount: number;
  sessionId: string | null;
  /** Last error message when exitReason ∈ {turn_failed, startup_failed}. */
  errorMessage?: string;
}

export interface CreateSessionOptions {
  cwd: string;
  abortController?: AbortController;
  config: ServiceConfig;
}

export interface IssueWorkerDeps {
  /** Factory for the SDK session. Production wires this to `createSession`. */
  createSession(options: CreateSessionOptions): Session;
}

export interface IssueWorkerCallbacks {
  /** Fired with the index (1-based) and the assistant text/tool messages of every completed turn. */
  onTurnComplete?(info: {
    turnCount: number;
    durationMs: number;
    sessionId: string;
  }): void;
  /**
   * Fired when the worker emits a runtime-level event (turn_completed,
   * turn_failed, session_started, ...). Lets the caller forward to a
   * shared EventBus / logger.
   */
  onWorkerEvent?(event: {
    event: 'session_started' | 'turn_completed' | 'turn_failed' | 'turn_timed_out' | 'startup_failed';
    payload: Record<string, unknown>;
  }): void;
}

export interface RunIssueWorkerInput extends IssueWorkerDeps, IssueWorkerCallbacks {
  issue: Issue;
  workspacePath: string;
  config: ServiceConfig;
  tracker: Tracker;
  handleStore: WorkerHandleStore;
  /** Optional clock injection for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Optional initial prompt override; defaults to a synthesized minimum. */
  initialPrompt?: string;
  /**
   * Optional external abort controller. Wired in production by the
   * scheduler shutdown path; tests may pass their own to drive abort
   * scenarios.
   */
  abortController?: AbortController;
  /**
   * Optional getter for the live `ServiceConfig`. The worker reads
   * mutable fields (`agent.maxTurns`, `agent.maxRetryBackoffMs`,
   * `tracker.finishLabel`) through this so config-reload between turns
   * takes effect at the next turn boundary. Defaults to returning the
   * static `config` snapshot. Immutable fields (cwd / permissionMode /
   * maxTurns at session-create time) keep the snapshot they had on
   * worker birth — see design Decision §5.
   */
  getConfig?: () => ServiceConfig;
}

export const CONTINUATION_GUIDANCE = [
  'This is continuation turn {{ turnCount }} for the same issue. The full',
  'task prompt and Goals/Constraints from the first turn are still in this',
  'conversation history. Keep going until ALL of those goals are met. Do not',
  'respond with "done" until every goal has been verified. If a goal is',
  'blocked, explain the blocker explicitly.',
].join(' ');

/**
 * Suffix appended to the rendered task prompt on turn 1 only. Reinforces
 * that `turn_completed` is a checkpoint, not a finish line — the empirical
 * anti-pattern we observed under per-turn `query()` was the agent treating
 * each turn as a self-contained ask. See design Decision §5.
 */
export const INITIAL_PROMPT_SUFFIX = [
  '\n\n---',
  'This is a multi-turn session. Treat `turn_completed` as a checkpoint,',
  'not a finish line. The session ends only when you have completed every',
  'goal in the prompt above (commit, push, open the PR, add the agent-finish',
  'label). Do not stop early.',
].join('\n');

function renderContinuation(turnCount: number): string {
  return CONTINUATION_GUIDANCE.replace('{{ turnCount }}', String(turnCount));
}

interface IssueStateSnapshot {
  state: string;
  labels: string[];
}

async function fetchIssueSnapshot(
  tracker: Tracker,
  issueId: string,
): Promise<IssueStateSnapshot | undefined> {
  try {
    const map = await tracker.fetchIssueStatesByIds([issueId]);
    return map.get(issueId);
  } catch {
    // Fail open: a tracker hiccup should not collapse the worker. The next
    // turn loop iteration will retry. If repeated failures matter we will
    // surface them via the runner's error budget.
    return undefined;
  }
}

function classifySnapshot(
  snapshot: IssueStateSnapshot | undefined,
  config: ServiceConfig,
  finishLabel: string | undefined,
): { active: boolean; finished: boolean } {
  if (!snapshot) {
    // No snapshot — treat as still active so the worker doesn't drop the
    // issue on a tracker blip.
    return { active: true, finished: false };
  }
  const active = config.tracker.activeStates.some(
    (s) => s.toLowerCase() === snapshot.state.toLowerCase(),
  );
  const terminal = config.tracker.terminalStates.some(
    (s) => s.toLowerCase() === snapshot.state.toLowerCase(),
  );
  const finished = !!finishLabel
    && snapshot.labels.some((l) => l.toLowerCase() === finishLabel.toLowerCase());
  return { active: active && !terminal, finished };
}

export async function runIssueWorker(input: RunIssueWorkerInput): Promise<IssueWorkerResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const abortController = input.abortController ?? new AbortController();

  const handle: WorkerHandle = {
    issueId: input.issue.id,
    sessionId: null,
    startedAt,
    turnCount: 0,
    gracefulExitRequested: false,
  };
  input.handleStore.register(input.issue.id, handle);

  const finishLabel
    = input.config.tracker.finishLabel
      ?? input.tracker.getFinishLabel?.()
      ?? 'agent-finish';

  let session: Session | undefined;
  let exitReason: IssueWorkerExitReason = 'turn_failed';
  let errorMessage: string | undefined;
  let sessionIdForResult: string | null = null;

  try {
    try {
      session = input.createSession({
        cwd: input.workspacePath,
        abortController,
        config: input.config,
      });
      await session.connect();
    } catch (err) {
      exitReason = 'startup_failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      input.onWorkerEvent?.({
        event: 'startup_failed',
        payload: { message: errorMessage ?? '' },
      });
      return {
        exitReason,
        turnCount: handle.turnCount,
        sessionId: null,
        errorMessage,
      };
    }

    sessionIdForResult = session.sessionId ?? null;
    handle.sessionId = sessionIdForResult;

    const baseInitialPrompt = input.initialPrompt
      ?? `Work on ${input.issue.identifier}: ${input.issue.title}.`;
    // Always append the multi-turn reinforcement suffix.
    const initialPrompt = `${baseInitialPrompt}${INITIAL_PROMPT_SUFFIX}`;

    const liveConfig = (): ServiceConfig => (input.getConfig ? input.getConfig() : input.config);

    // Turn loop. Each iteration sends one user message and drains stream
    // until a `result` arrives.
    while (true) {
      const cfg = liveConfig();
      const maxTurnsNow = cfg.agent.maxTurns;
      if (handle.turnCount >= maxTurnsNow) {
        exitReason = 'max_turns_reached';
        break;
      }

      // Honour graceful exit set before this turn was scheduled.
      const liveHandle = input.handleStore.get(input.issue.id);
      if (liveHandle?.gracefulExitRequested) {
        exitReason = 'graceful_exit_requested';
        break;
      }

      const message = handle.turnCount === 0
        ? initialPrompt
        : renderContinuation(handle.turnCount + 1);

      const turnTimeoutMs = cfg.codebuddy.turnTimeoutMs;
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;
      if (turnTimeoutMs && turnTimeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          abortController.abort();
        }, turnTimeoutMs);
      }

      try {
        await session.send(message);
        let turnDurationMs = 0;
        let turnSessionId: string | undefined;
        for await (const m of session.stream()) {
          // Capture session_started for callback consumers (Symphony §10.4
          // event), then keep iterating until a result arrives.
          if (m.type === 'system' && (m as { subtype?: string }).subtype === 'init') {
            const sysMsg = m as unknown as { session_id?: string };
            if (sysMsg.session_id && !sessionIdForResult) {
              sessionIdForResult = sysMsg.session_id;
              handle.sessionId = sessionIdForResult;
            }
            input.onWorkerEvent?.({
              event: 'session_started',
              payload: {
                sessionId: sysMsg.session_id ?? handle.sessionId ?? '',
              },
            });
          }
          if (m.type === 'result') {
            handle.turnCount += 1;
            turnDurationMs = (m as unknown as { duration_ms?: number }).duration_ms ?? 0;
            turnSessionId = (m as unknown as { session_id?: string }).session_id ?? handle.sessionId ?? undefined;
            if (m.is_error) {
              const errs = (m as unknown as { errors?: string[] }).errors;
              const isMaxTurns = !!errs?.some((e) => /max turns/i.test(String(e)));
              if (!isMaxTurns) {
                exitReason = 'turn_failed';
                errorMessage = errs?.join('; ');
                input.onWorkerEvent?.({
                  event: 'turn_failed',
                  payload: { message: errorMessage ?? '' },
                });
                throw new TurnFailedError(errorMessage);
              }
            }
            input.onWorkerEvent?.({
              event: 'turn_completed',
              payload: {
                durationMs: turnDurationMs,
                sessionId: turnSessionId ?? '',
              },
            });
            input.onTurnComplete?.({
              turnCount: handle.turnCount,
              durationMs: turnDurationMs,
              sessionId: turnSessionId ?? handle.sessionId ?? '',
            });
            break;
          }
        }
      } catch (err) {
        if (err instanceof TurnFailedError) {
          // exitReason + errorMessage already set
          return {
            exitReason: 'turn_failed',
            turnCount: handle.turnCount,
            sessionId: sessionIdForResult,
            errorMessage,
          };
        }
        if (timedOut) {
          exitReason = 'turn_timed_out';
          input.onWorkerEvent?.({
            event: 'turn_timed_out',
            payload: { timeoutMs: turnTimeoutMs ?? 0 },
          });
          return {
            exitReason,
            turnCount: handle.turnCount,
            sessionId: sessionIdForResult,
          };
        }
        if (err instanceof Error && (err.name === 'AbortError' || err.message === 'Aborted')) {
          exitReason = 'aborted';
          return {
            exitReason,
            turnCount: handle.turnCount,
            sessionId: sessionIdForResult,
          };
        }
        // Stream-level failure (network, SDK transport, generator throw):
        // emit turn_failed and exit the loop. Do not retry the same turn —
        // that is the runner-level error budget's job, not the worker's.
        exitReason = 'turn_failed';
        errorMessage = err instanceof Error ? err.message : String(err);
        input.onWorkerEvent?.({
          event: 'turn_failed',
          payload: { message: errorMessage ?? '' },
        });
        return {
          exitReason,
          turnCount: handle.turnCount,
          sessionId: sessionIdForResult,
          errorMessage,
        };
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }

      // After a successful turn: re-fetch tracker.
      const snap = await fetchIssueSnapshot(input.tracker, input.issue.id);
      const classified = classifySnapshot(snap, input.config, finishLabel);

      if (classified.finished) {
        exitReason = 'finish_label_observed';
        return {
          exitReason,
          turnCount: handle.turnCount,
          sessionId: sessionIdForResult,
        };
      }
      if (!classified.active) {
        exitReason = 'issue_inactive';
        return {
          exitReason,
          turnCount: handle.turnCount,
          sessionId: sessionIdForResult,
        };
      }

      // Honour graceful exit set during the turn we just finished.
      if (input.handleStore.get(input.issue.id)?.gracefulExitRequested) {
        exitReason = 'graceful_exit_requested';
        break;
      }

      // The cap is re-checked at the top of the next iteration via the live
      // config; no need to duplicate it here.
    }

    if (exitReason === 'max_turns_reached') {
      // Apply safety-net label.
      try {
        await input.tracker.addLabel?.(input.issue.id, finishLabel);
      } catch {
        // Best-effort: surfacing the failure here would mask the more
        // important fact that we hit max_turns. The reconcile loop will
        // retry on next tick.
      }
    }

    return {
      exitReason,
      turnCount: handle.turnCount,
      sessionId: sessionIdForResult,
      errorMessage,
    };
  } finally {
    try {
      session?.close();
    } catch {
      // session.close() is best-effort
    }
    input.handleStore.release(input.issue.id);
  }
}

class TurnFailedError extends Error {
  constructor(message?: string) {
    super(message ?? 'turn_failed');
    this.name = 'TurnFailedError';
  }
}
