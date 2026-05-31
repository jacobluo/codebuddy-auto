## 1. Spec types and worker handle store

- [x] 1.1 Add `WorkerHandle` interface and `runners: Record<issueId, WorkerHandle>` field to `typescript/src/spec/runtime-state.ts` (and matching zod schema if applicable)
- [x] 1.2 Write `test/worker/worker-handle-store.test.ts` covering register / get / list / release / requestGracefulExit
- [x] 1.3 Implement `typescript/src/worker/worker-handle-store.ts` to satisfy 1.2
- [x] 1.4 Re-run `pnpm test` for the new file; baseline (38 files / 194 tests) MUST stay green

## 2. FakeSdk test harness

- [x] 2.1 Write `test/worker/fake-sdk.ts` exposing `createFakeSdk(plan: ScenarioPlan)`. The fake's `Session` SHALL implement `connect / send / stream / close / sessionId` and emit messages exactly as a `ScenarioPlan` describes (including `result` boundaries, `is_error`, `assistant tool_use` blocks, and stream errors)
- [x] 2.2 Write a smoke test in `test/worker/fake-sdk.test.ts` that drives the fake through one happy turn and asserts the message stream

## 3. Worker turn loop (TDD)

Tasks 3.x MUST follow `superpowers:test-driven-development`: write failing scenario tests first, then minimal implementation.

- [ ] 3.1 Write `test/worker/run-issue-worker.test.ts` covering scenario "happy path: agent applies finish_label on turn 5 → worker exits without safety-net label"
- [ ] 3.2 Implement `typescript/src/worker/run-issue-worker.ts` minimum to pass 3.1 (createSession → connect → send initial → stream until result → re-fetch tracker → break on finish_label → close)
- [ ] 3.3 Add scenario "max_turns reached: worker applies safety-net `agent-finish` label and exits"; extend implementation to satisfy
- [ ] 3.4 Add scenario "issue moved to terminal mid-flight: reconcile sets gracefulExitRequested → worker breaks at next turn boundary, no safety-net label"; extend implementation
- [ ] 3.5 Add scenario "stream error mid-turn: worker emits `turn_failed` and exits the loop without retrying"; extend implementation
- [ ] 3.6 Add scenario "wall-clock turnTimeoutMs: worker aborts the turn, emits `turn_timed_out`, exits"; extend implementation
- [ ] 3.7 Add scenario "SIGINT / abort signal mid-turn: worker aborts, calls session.close(), removes WorkerHandle"; extend implementation
- [ ] 3.8 Add scenario "session.connect failure: worker emits `startup_failed`, never enters the turn loop, releases handle"; extend implementation
- [ ] 3.9 Add scenario "concurrent dispatch: 3 issues start 3 workers with 3 distinct sessionIds, no cross-talk"; extend implementation
- [ ] 3.10 Add scenario "config reload during run: worker reads new agent.maxTurns at the next turn boundary"; extend implementation
- [ ] 3.11 Run full vitest suite; new + existing MUST stay green

## 4. Continuation guidance prompt

- [ ] 4.1 In `typescript/src/worker/run-issue-worker.ts`, replace the inline continuation guidance with the new template (see design Decision 5). Inject via a local constant
- [ ] 4.2 Add a unit test that asserts the continuation `send` argument matches the new template AND does NOT include the original task prompt
- [ ] 4.3 Update the initial prompt path to append the "turn_completed is a checkpoint, not a finish line" reminder used in design §5

## 5. Scheduler routing

- [ ] 5.1 Modify `typescript/src/scheduler/run-dispatch-cycle.ts`: when `config.worker.kind === 'local'`, register a `WorkerHandle`, kick off `runIssueWorker(...)` (do NOT await), and return. SSH branch unchanged
- [ ] 5.2 Modify `typescript/src/scheduler/start-scheduler.ts`: skip `runContinuationCycle` when `config.worker.kind === 'local'`. Add a code comment that explains the routing decision
- [ ] 5.3 Modify `typescript/src/scheduler/reconcile-runtime-state.ts`: for any `state.runners` entry whose tracker state indicates termination, set `gracefulExitRequested = true` (do NOT call abort)
- [ ] 5.4 Update / rewrite the dispatch-cycle and continuation-cycle test files where they exercised the local-mode SDK path; SSH-mode tests stay
- [ ] 5.5 Add a new test that asserts: when `worker.kind === 'local'` and a `WorkerHandle` exists for an issue, `runDispatchCycle` does NOT spawn a second worker for the same issue

## 6. Runner glue

- [ ] 6.1 Refactor `typescript/src/runner/run-codebuddy-turn-sdk.ts` so its public surface accepts an externally-provided `Session`. The function becomes "drive one turn on a session"; it MUST NOT call `createSession` or `query()`
- [ ] 6.2 Update `typescript/src/runner/run-codebuddy-turn.ts` so the SDK branch requires the caller to provide a session (the new worker provides it). SSH branch unchanged
- [ ] 6.3 Update `test/runner/run-codebuddy-turn-sdk.test.ts` to inject a `FakeSession` rather than mock `query`. Existing per-turn behaviour assertions remain
- [ ] 6.4 Delete the unused `SessionStore` symbol from the local path (it remains for SSH if and only if SSH already used it; otherwise remove entirely)

## 7. Dashboard / SSE field semantics

- [ ] 7.1 Update `typescript/src/logging/runtime-snapshot.ts` (and any helpers) so `running[*].turnCount` is read from `WorkerHandle.turnCount` for local mode and from existing retry tables for SSH mode
- [ ] 7.2 Verify that no SSE event name changes; field shapes preserved. Add a regression test asserting the snapshot JSON shape against a fixture

## 8. Manual end-to-end verification (gated, NOT auto-tested)

- [ ] 8.1 Run `pnpm build && node dist/src/main.js WORKFLOW.md --daemon` against `relaxorg/demo-mini-crm` issue #6 with the new worker. Capture daemon log to `/tmp/codebuddy-auto-e2e-after.log`
- [ ] 8.2 Confirm via cnb API and SSE that within `agent.maxTurns` the agent reaches: commit on `fix/issue-6` branch → push → `cnb pulls post-pull` returns 201 → `cnb issues post-issue-labels --labels agent-finish` succeeds. If any step fails, do NOT mark task complete; cycle back to systematic-debugging
- [ ] 8.3 Clean up the test PR (close), delete the probe branch, and remove `agent-finish` from issue #6 if the smoke test created it. Do NOT leave artifacts on the demo repo
- [ ] 8.4 Snapshot the final `pnpm test` run (must show 38+ test files passing, including new `test/worker/`)

## 9. Documentation

- [ ] 9.1 Add a brief note to `PLAN.md` §10 / §7.1 references documenting that the runtime now satisfies SPEC §10.3 long-lived-thread semantics under `worker.kind === 'local'`
- [ ] 9.2 Update `docs/references/codebuddy-cli-capabilities.md` if it claims the SDK uses per-turn `query({resume})`. Replace with the new session-based model
- [ ] 9.3 No README update needed (README is intentionally implementation-light per recent edits)

## 10. Pre-archive verification

- [ ] 10.1 Run `superpowers:verification-before-completion` on the full change set
- [ ] 10.2 Run `superpowers:requesting-code-review` (project asks for code-reviewer pre-archive); fix findings or document why deferred
- [ ] 10.3 Confirm `openspec status --change sdk-multi-turn-worker` shows all artifacts done and `tasks.md` checkboxes all checked
- [ ] 10.4 Use `superpowers:finishing-a-development-branch` to land the worktree (PR or merge), then `/opsx:archive` the change
