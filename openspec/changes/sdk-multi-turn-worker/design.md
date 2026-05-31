## Context

The repo contains a TypeScript reference implementation of [OpenAI Symphony](https://github.com/openai/symphony) that drives [CodeBuddy Agent SDK](https://www.codebuddy.cn/docs/cli/sdk-typescript) against `cnb.cool` issues. End-to-end smoke testing against `relaxorg/demo-mini-crm` (issue #6, 2026-05-31) showed that an `agent-ready` issue runs to `agent.maxTurns = 20` without ever producing the commit / push / PR / `agent-finish` handoff that the prompt asks for. The scheduler eventually applies its safety-net `agent-finish` label after exhausting the turn budget; no PR is created and no new branch reaches the remote.

SSE traces from `/api/v1/events` reveal the failure mode: across 6 successful turns (all 6 of which arrived before max-turns) the agent issued exactly **one** tool call per turn (`ls`, `read README.md`, `write README.md`, `read README.md`, `git status`, `git add+commit -m`), then said "已完成。" and stopped. The scheduler then drove a *seventh* turn, which produced no new tool call and another "已完成。", and the cycle continued for the remaining 13 turns burning ~860k tokens for zero forward progress.

The implementation cause is a contract mismatch between scheduler and SDK:

- `runCodebuddyTurnSdk` calls `query({ prompt, options: { resume: sessionId } })` per turn.
- Each `query()` invocation spawns a fresh CLI subprocess (`@tencent-ai/agent-sdk` source confirms this — see `node_modules/@tencent-ai/agent-sdk/lib/query.js:330-400` `cleanup() → transport.close()` and `acquireSessionLock`).
- `resume` only replays conversation history; it does not preserve any "task progress" mental model. The new subprocess sees an old conversation plus a fresh user prompt that says only `Continue working on #6: 调整 README. This is continuation turn N.` — semantically a self-contained ask.
- Agent fulfils that ask with the cheapest viable response (one tool call, plus "已完成。"), and `query()` returns. The scheduler treats `turn_completed` as a checkpoint and schedules another shallow turn.

This contradicts:

- **Symphony SPEC §10.3 / §7.1** ("the app-server subprocess SHOULD remain alive across continuation turns"; "After each normal turn completion, the worker re-checks the tracker issue state").
- **Our own existing `sdk-session-management` spec** ("the existing session is reused (same in-memory context), not recreated").

The SDK *does* expose the right API: `unstable_v2_createSession`, `session.send(...)`, `session.stream()`, `session.close()` (see `lib/session.d.ts` and `lib/types.d.ts:Session` interface). They keep the CLI subprocess alive for the session's lifetime — that is, exactly the SPEC §10.3 mode.

## Goals / Non-Goals

**Goals:**

1. Realize Symphony §7.1 / §10.3 long-lived-thread semantics for `worker.kind === 'local'`: one SDK session lives for the whole issue, multiple turns flow through `session.send + session.stream` on that single session.
2. Honour the existing `sdk-session-management` requirement that "the existing session is reused (same in-memory context), not recreated".
3. Keep the SSH path (`worker.kind === 'ssh'`) unchanged, including its dispatch + continuation cycles. SSH workers spawn a fresh CodeBuddy CLI per turn; they cannot host a long-lived session.
4. Make the per-turn tracker re-check (Symphony §7.1) explicit and graceful: a worker that learns the issue is no longer active or has acquired `finish_label` exits at the next turn boundary without aborting the in-flight turn.
5. Provide a `FakeSdk` test harness so the worker's turn loop, exit conditions, and error paths can be exercised deterministically without contacting the real SDK.

**Non-Goals:**

1. **Cross-process session resume.** Daemon restart / crash starts a fresh session; no persistent `WorkerHandleStore` on disk. Aligned with Symphony "scheduler state intentionally NOT persisted".
2. **Prompt-side anti-loafing checklists.** We do not encode "have you committed? have you pushed?" into the prompt template. The fix is structural (let the agent see the original Goals across all turns); prompt-side reinforcement is at most a follow-up and is not part of this change.
3. **Hook-based PR creation.** Moving commit/push/PR/post-issue-labels into `after_run` hooks is not in scope. The agent retains responsibility for the handoff. (Considered and rejected during brainstorming — would need a separate change to expose issue context to hooks.)
4. **Child-process-per-issue supervisor model.** Each worker is an in-process async task; no `child_process.fork`. Aligns with current runtime model and avoids IPC complexity.
5. **Reworking SSH worker semantics.** SSH path is intentionally untouched.

## Decisions

### Decision 1: Worker as a per-issue async function

`runIssueWorker(issue, config, deps): Promise<void>` is a long-lived async function. It:

1. Calls `unstable_v2_createSession({ cwd: workspace, permissionMode, maxTurns, abortController, canUseTool, onEvent ... })`.
2. `await session.connect()`.
3. Sends initial rendered prompt via `await session.send(prompt)`; iterates `session.stream()` until a `result` message arrives (turn boundary).
4. Re-checks tracker; if `finish_label` present or issue no longer active, breaks the loop without sending more turns.
5. Otherwise sends continuation guidance via `session.send(...)`; iterates again.
6. Loop exits on max-turns, graceful exit, fatal error, or wall-clock timeout. Always calls `session.close()` in `finally`.

**Alternatives considered:**
- **Loop inside `runCodebuddyTurnSdk`.** Rejected: function name implies one turn; multi-turn semantics belong to a higher-level abstraction. Continuation cycle would become dead code that maintainers would mistake for live code.
- **Child-process supervisor.** Rejected as Non-Goal #4.

### Decision 2: Scheduler tick removes continuation cycle for local mode

When `worker.kind === 'local'`:

- `runDispatchCycle` registers a worker handle in `state.runners[issueId]`, kicks off `runIssueWorker(...)`, and returns immediately. It does not `await` the worker.
- `runContinuationCycle` is **not invoked** in this branch.
- `reconcileRuntimeState` continues to fire each tick. When it observes a runner whose issue is now terminal / missing / has `finish_label`, it sets `runners[issueId].gracefulExitRequested = true`. The worker checks this flag at every turn boundary.

When `worker.kind === 'ssh'`:

- Existing dispatch + continuation flow is kept verbatim. `runners` map is unused; SSH path keeps using `state.retryAttempts`.

**Alternatives considered:**
- **Always run continuation cycle even in local mode** (no-op when worker is alive). Rejected: extra polling for nothing; complicates reasoning.

### Decision 3: WorkerHandleStore replaces SessionStore (local mode only)

```ts
interface WorkerHandle {
  issueId: string;
  sessionId: string;            // captured from session.sessionId after connect()
  abortController: AbortController;
  gracefulExitRequested: boolean;
  turnCount: number;
  startedAt: string;            // ISO timestamp
}
type WorkerHandleStore = {
  register(issueId: string, handle: WorkerHandle): void;
  get(issueId: string): WorkerHandle | undefined;
  list(): WorkerHandle[];
  release(issueId: string): void;
  requestGracefulExit(issueId: string): boolean;
};
```

The existing `SessionStore` (issue → sessionId string) is removed in the local path. SSH path may keep its lighter session bookkeeping, but it does not need a worker handle since each turn is a fresh subprocess.

**Alternatives considered:**
- **Repurpose `SessionStore`.** Rejected: name and shape would mislead. Worker handle owns more than a session id.

### Decision 4: Turn boundary detection

Stream loop terminates a turn when `msg.type === 'result'` arrives (consistent with the existing SDK runner). A `result` with `is_error: true` and "max turns" in its error list is mapped to `turn_completed` (existing behaviour); other errors are mapped to `turn_failed`. Wall-clock timeout (`codebuddy.turnTimeoutMs`) wraps each turn via `abortController.abort()`.

### Decision 5: Continuation guidance text

Replaces the existing `Continue working on {{ issue.identifier }}: {{ issue.title }}. ...` template. New text:

```
This is continuation turn {{ attempt.turnCount }} for the same issue. The full
task prompt and Goals/Constraints from the first turn are still in this
conversation history. Keep going until ALL of those goals are met. Do not
respond with "done" until every goal has been verified. If a goal is blocked,
explain the blocker explicitly.
```

Rationale: the empirical anti-pattern in the smoke test was the agent treating each turn as a fresh, self-contained ask. The new text:

- States explicitly that the original Goals are still in context
- Adds an instruction to keep going until ALL goals are met
- Names the failure mode ("done" without verification) and forbids it

This is a behavioural reinforcement on top of the structural fix, not a substitute for it.

### Decision 6: Reconcile triggers graceful exit, not abort

`reconcileRuntimeState` may set `gracefulExitRequested = true` on a runner. The worker reads this flag at the **top of each turn iteration**:

- Before sending the next user message: if flag set, break loop (no more turns; the in-flight turn already completed).
- It does **not** call `abortController.abort()` for graceful exit. Abort is reserved for hard cases (turn timeout, daemon shutdown, max-turn-failure budget exceeded).

Rationale: aborting in-flight tool calls can leave half-applied edits in the workspace. SPEC §7.1 also implies the re-check happens after turn completion, not during.

### Decision 7: Test harness via FakeSdk

`test/worker/fake-sdk.ts` exports a `createFakeSdk(plan)` factory whose return value plugs into `runIssueWorker` via dependency injection. The factory returns objects with the same `Session` shape used by the worker (`connect`, `send`, `stream`, `close`, `sessionId`).

`runIssueWorker` accepts a `deps: { createSession, eventBus, tracker, logger, now, ... }` parameter; production code wires it to the real SDK, tests wire it to FakeSdk.

**Alternatives considered:**
- **Module-level mock via vitest's `vi.mock`.** Rejected: less explicit, harder to drive scenario plans.

## Risks / Trade-offs

- **[Risk] SDK `unstable_v2_*` API changes.** → Mitigation: the surface we use (`createSession + send + stream + close`) is the same shape as Anthropic's SDK and the SPEC's expected shape; if `unstable_v2_*` becomes stable the names will be aliased. We pin the SDK version in `package.json` and review upgrades.
- **[Risk] In-process worker leaks if the daemon process is force-killed.** → Mitigation: each `Session` registers an SDK-side lock file (`acquireSessionLock`); on next daemon start, lock conflicts surface explicitly. Workspace cleanup on next-tick reconciliation already exists.
- **[Risk] Long-lived sessions hold more memory than per-turn queries.** → Trade-off: SDK session keeps conversation in CLI memory; for typical `agent.maxTurns = 20` and our observed turns averaging ~30s each, peak memory per worker is comparable to running 20 short queries back-to-back. We do not foresee process-wide memory growth issues at `maxConcurrentAgents = 1..10`.
- **[Risk] Removing `runContinuationCycle` from the local hot path may surprise contributors who read scheduler tests.** → Mitigation: `runContinuationCycle` is preserved (and its tests stay) for SSH; `start-scheduler.ts` carries a comment that explains the routing decision.
- **[Risk] Behavioural fix is partially structural and partially prompt-driven.** → Trade-off: even with long-lived session, an agent that reads "已完成" out of laziness can stop early. We accept this as an acknowledged risk; the prompt change is mitigation #1 and follow-up monitoring (max-turns-bottom-out alerts in dashboard) is mitigation #2 (out of scope here, tracked as a follow-up).

## Migration Plan

This is an internal-only refactor. No data migration, no external API breakage.

1. Branch lives in a worktree (`worktree-sdk-multi-turn-worker`); merge to master via PR.
2. `pnpm test` (38 files / 194 tests today) plus the new `test/worker/` suite must pass.
3. Manual verification: re-run the same end-to-end smoke against `relaxorg/demo-mini-crm` issue #6 (or #7) and confirm the agent reaches commit → push → PR → `agent-finish` within `agent.maxTurns`.
4. **Rollback**: if the new path misbehaves in production, the old single-turn `runCodebuddyTurnSdk` + `runContinuationCycle` path is preserved in git history; a single-commit revert restores it. No persisted state to migrate.

## Open Questions

None. The decisions above were settled during brainstorming with the user (worktree session, 2026-05-31).
