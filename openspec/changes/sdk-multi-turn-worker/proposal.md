## Why

End-to-end smoke testing on `relaxorg/demo-mini-crm` showed that an `agent-ready` issue runs to `agent.maxTurns` without ever producing the commit / push / PR / `agent-finish` handoff that the prompt requires; only `agent-finish` (the scheduler's safety-net label) ends up on the issue. SSE traces show why: the agent does **one** tool call per turn, then says "已完成。" and stops. Each scheduler turn is a fresh `query({resume: sessionId})` call, which spawns a new CLI subprocess that resumes conversation history but treats the per-call user prompt (`"Continue working on #6: …"`) as a self-contained ask — so the agent fulfils that single ask and quits, oblivious to the original Goals list. This contradicts both Symphony SPEC §10.3 ("the app-server subprocess SHOULD remain alive across continuation turns") and our own existing `sdk-session-management` spec ("the existing session is reused (same in-memory context), not recreated"). The implementation never honoured those contracts; we are now closing the gap.

## What Changes

- Replace per-turn `query()` calls with a per-issue, in-process **`IssueWorker`** that holds a single `createSession(...)` for the issue's full lifetime and drives N turns via repeated `session.send(...) + session.stream()`.
- Move the multi-turn loop, mid-flight tracker re-checks, and graceful-exit handling **out of the scheduler tick** and **into the worker** (Symphony §7.1: "After each normal turn completion the worker re-checks the tracker issue state").
- Delete `runContinuationCycle` from the local-mode hot path; scheduler tick becomes `reconcile + dispatch` only when `worker.kind === 'local'`. The SSH branch keeps the existing dispatch + continuation cycles unchanged (no long-lived session there).
- Rework `SessionStore` (issue → sessionId string) into `WorkerHandleStore` (issue → `{ session, abortController, gracefulExitRequested, turnCount }`) so reconcile can request graceful exit without killing in-flight turns.
- Update the continuation guidance text sent on every non-first turn to explicitly remind the agent that "turn_completed is a checkpoint, not a finish line" — the prompt anti-pattern observed in the smoke test.
- Add a `FakeSdk` test harness in `test/worker/` that drives the worker through happy-path, max-turns, mid-flight finish-label, stream errors, wall-clock timeout, and SIGINT shutdown scenarios.
- **BREAKING (internal)**: `SessionStore` symbol is renamed and its shape changes; no external API but the internal scheduler/runner glue must be updated together.

## Capabilities

### New Capabilities

- `sdk-multi-turn-worker`: A per-issue, long-lived async worker that owns the SDK session for the issue's lifetime, runs the multi-turn loop, performs per-turn tracker re-checks, and exits gracefully on terminal state, finish_label, or maxTurns.

### Modified Capabilities

- `sdk-session-management`: Existing requirements ("session reused across continuation turns", "session destroyed on issue release") are restated in terms of the new worker — the contract does not change but the realization does. We add explicit requirements that the SDK CLI subprocess MUST stay alive across continuation turns (currently violated) and that continuation turns MUST be driven via `session.send` rather than `query({resume})`.
- `codebuddy-cli-integration`: Adds a clarifying scenario that the local SDK runner no longer relies on the CLI's `--session-id` / `--resume` flag path; that flag set remains in scope only for the SSH worker (`worker.kind === 'ssh'`).

## Impact

- **Code (local mode)**:
  - New: `typescript/src/worker/run-issue-worker.ts`
  - New: `typescript/src/worker/worker-handle-store.ts` (replaces `src/runner/session-store.ts` for the local path)
  - Modified: `typescript/src/runner/run-codebuddy-turn-sdk.ts` (becomes a thin per-turn helper that takes a live `Session`, no longer creates one)
  - Modified: `typescript/src/runner/run-codebuddy-turn.ts` (dispatcher: SDK branch now requires the caller to provide a session)
  - Modified: `typescript/src/scheduler/run-dispatch-cycle.ts` (local branch becomes "register worker handle and return")
  - Modified: `typescript/src/scheduler/start-scheduler.ts` (skip continuation cycle when `worker.kind === 'local'`)
  - Modified: `typescript/src/scheduler/reconcile-runtime-state.ts` (sets `gracefulExitRequested` on stale runners instead of mutating retry tables)
  - Modified: `typescript/src/spec/runtime-state.ts` (adds `runners` map; `retryAttempts` confined to SSH path)
  - Modified: `typescript/src/scheduler/run-continuation-cycle.ts` (gated behind `worker.kind === 'ssh'`; deleted from the local path)
- **Code (SSH mode)**: unchanged — `runContinuationCycle` and its tests remain authoritative for `worker.kind === 'ssh'`.
- **Tests**: 38-file vitest suite expands by ≈ 1 new directory (`test/worker/`) covering the 10 scenarios listed in design §6. Existing scheduler tests that asserted `runContinuationCycle` is invoked under SDK mode are rewritten to assert worker-handle registration instead.
- **Specs**: new spec file `openspec/specs/sdk-multi-turn-worker/spec.md`; deltas to `sdk-session-management` and `codebuddy-cli-integration`.
- **Runtime / dashboard**: SSE event names and field shapes are preserved; `turnCount` semantics shift from "number of scheduler-driven continuation attempts" to "number of in-worker turns" but the field type and range are unchanged.
- **Configuration**: no new fields. `agent.maxTurns`, `agent.maxRetryBackoffMs`, `codebuddy.turnTimeoutMs`, `codebuddy.permissionMode` keep their meaning. `agent.maxConcurrentAgents` continues to bound concurrency, now over live workers.
- **Operational**: graceful shutdown becomes worker-aware — SIGINT/SIGTERM aborts each worker's current turn and closes its session. Default grace window 30s before forced kill (matches current behaviour).
- **Docs**: PLAN.md §10 / §7.1 cross-references will need a follow-up note that the runtime now satisfies SPEC §10.3 long-lived-thread semantics; that doc edit ships as part of `/opsx:apply`.
