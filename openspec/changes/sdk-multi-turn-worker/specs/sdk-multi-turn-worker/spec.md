## ADDED Requirements

### Requirement: Per-issue long-lived worker

When `worker.kind === 'local'`, each dispatched issue SHALL be driven by exactly one in-process async worker that owns a single CodeBuddy SDK session for the entire issue lifetime, and that worker SHALL run multiple turns by repeatedly calling `session.send` and `session.stream` on that same session, so that Symphony SPEC §10.3 ("the app-server subprocess SHOULD remain alive across continuation turns") is satisfied.

The worker MUST NOT call `query()` or open a fresh session per turn. The session MUST be created via the SDK's session API (e.g., `createSession`) and MUST persist across all turns until the worker exits.

#### Scenario: Worker created on dispatch
- **WHEN** the scheduler dispatches an issue and `config.worker.kind === 'local'`
- **THEN** a single worker async task is started
- **AND** a `WorkerHandle` for that issue is registered in the runtime state with `turnCount = 0`, `gracefulExitRequested = false`, and an `AbortController` reference
- **AND** the scheduler tick returns without awaiting the worker

#### Scenario: Session reused across turns
- **WHEN** the worker has just finished turn N and is about to start turn N+1
- **THEN** the same `Session` object is reused for turn N+1
- **AND** no new SDK session is created for turn N+1
- **AND** the `sessionId` recorded in the `WorkerHandle` is unchanged

#### Scenario: Session closed on worker exit
- **WHEN** the worker exits for any reason (max turns, graceful exit, fatal error, abort)
- **THEN** `session.close()` is called exactly once in a `finally` block
- **AND** the `WorkerHandle` is removed from the runtime state

### Requirement: Per-turn loop drives send/stream until result

Within one worker, each turn SHALL be driven by exactly one `session.send(message)` followed by iterating `session.stream()` until a message of type `'result'` is observed. The worker SHALL emit a `turn_completed` runtime event when a successful `result` arrives and a `turn_failed` event when `result.is_error === true` (excluding "max turns" results, which map to `turn_completed` for parity with existing behaviour).

#### Scenario: First turn sends rendered prompt
- **WHEN** the worker is starting turn 1 for a new issue
- **THEN** the rendered task prompt (the full output of the WORKFLOW.md template) is sent via `session.send(prompt)`
- **AND** the worker iterates `session.stream()` until a `result` message is observed
- **AND** a `turn_completed` event is emitted to the runtime event bus on the `result` boundary

#### Scenario: Continuation turn sends only guidance
- **WHEN** the worker is starting any turn N where N > 1
- **THEN** the message sent via `session.send` is the continuation guidance template, NOT the original task prompt
- **AND** the original task prompt is NOT resent

#### Scenario: Result error becomes turn_failed
- **WHEN** during stream iteration a message of type `'result'` arrives with `is_error === true` and the error list does NOT contain "max turns"
- **THEN** the worker emits a `turn_failed` event
- **AND** the worker advances to the worker-level error budget logic (NOT to the next turn directly)

### Requirement: Per-turn tracker re-check before next send

After every successful `turn_completed`, the worker SHALL re-fetch the issue from the tracker before sending the next user message and SHALL break the turn loop without sending another message if any of the following holds:

- The issue is no longer in an active state (Symphony §7.1).
- The issue carries the `tracker.finishLabel` label.
- The current `turnCount` has reached `agent.maxTurns`.

#### Scenario: Issue moved to terminal state mid-flight
- **WHEN** turn N completes successfully
- **AND** before sending turn N+1 the worker re-fetches the tracker and finds the issue is no longer active
- **THEN** the worker breaks the loop without sending turn N+1
- **AND** `session.close()` is called
- **AND** the `agent-finish` safety-net label is NOT applied (the issue is already past handoff)

#### Scenario: Agent applied finish_label mid-flight
- **WHEN** turn N completes successfully
- **AND** the re-fetched issue contains the configured `tracker.finishLabel`
- **THEN** the worker breaks the loop without sending turn N+1
- **AND** the safety-net label is NOT re-applied
- **AND** the worker logs `issue_continuation_completed_finish_label`

#### Scenario: maxTurns reached
- **WHEN** turn N completes and `turnCount === agent.maxTurns`
- **THEN** the worker breaks the loop
- **AND** the safety-net label `tracker.finishLabel` IS applied (preserving existing behaviour)
- **AND** the worker logs `issue_continuation_completed_max_turns`

### Requirement: Reconcile triggers graceful exit, not in-flight abort

`reconcileRuntimeState` SHALL request graceful exit by setting `WorkerHandle.gracefulExitRequested = true` for any runner whose tracker state indicates termination, and the worker SHALL honour the flag at the next turn boundary (after the in-flight turn completes), so that no half-applied tool calls leave the workspace in an inconsistent state.

`reconcileRuntimeState` MUST NOT call `abortController.abort()` for the purpose of graceful exit.

#### Scenario: Reconcile sets graceful exit flag
- **WHEN** during a scheduler tick, reconciliation observes that the issue for an active runner is now terminal or missing
- **THEN** `WorkerHandle.gracefulExitRequested` is set to `true`
- **AND** the in-flight `session.send / session.stream` is NOT interrupted
- **AND** no `AbortError` is raised on the worker

#### Scenario: Worker honours flag at next turn boundary
- **WHEN** the worker has just received a `result` message and is about to evaluate "should I send the next turn?"
- **AND** `WorkerHandle.gracefulExitRequested === true`
- **THEN** the worker breaks the loop
- **AND** `session.close()` is called

### Requirement: Concurrency bounded by maxConcurrentAgents

The number of simultaneously active workers SHALL never exceed `config.agent.maxConcurrentAgents`. Each worker counts toward the live capacity for its entire lifetime (from dispatch start to `session.close()`).

#### Scenario: Dispatch refuses when at capacity
- **WHEN** `state.runners` already has `maxConcurrentAgents` active entries
- **AND** a new candidate issue would otherwise be dispatched
- **THEN** the candidate is left for the next tick (deferred dispatch)
- **AND** no new worker is spawned

### Requirement: Wall-clock turn timeout aborts current turn

Each individual `session.send / session.stream` turn SHALL be subject to `codebuddy.turnTimeoutMs` enforced via an `AbortController`. On timeout the worker SHALL emit `turn_timed_out` and exit the worker loop without starting another turn.

#### Scenario: Turn exceeds turnTimeoutMs
- **WHEN** a turn's `session.stream()` iteration does not reach a `result` message within `codebuddy.turnTimeoutMs`
- **THEN** the worker calls `abortController.abort()`
- **AND** the worker emits `turn_timed_out`
- **AND** the worker exits the loop and calls `session.close()`

### Requirement: Daemon shutdown gracefully drains workers

On daemon `SIGINT` / `SIGTERM`, every active worker SHALL be sent an abort signal and given up to a configured grace window (default 30s, matching today's behaviour) for `session.close()` to complete. Workers still alive after the grace window are force-released.

#### Scenario: SIGINT during active workers
- **WHEN** the scheduler receives `SIGINT` while two workers are mid-turn
- **THEN** both workers receive `abortController.abort()`
- **AND** both attempt `session.close()`
- **AND** the daemon waits up to the grace window before exiting
