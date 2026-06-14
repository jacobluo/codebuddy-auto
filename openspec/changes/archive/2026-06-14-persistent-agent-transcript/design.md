## Context

The current Dashboard event stream is built on an in-memory `EventBus` intended for realtime status updates and bounded reconnect replay. It can show issue-scoped events and assistant notification text while the daemon is alive, but it is not a durable conversation record and does not preserve full user prompts, continuation prompts, raw SDK/CLI messages, or historical events after restart.

Operators need a durable transcript to understand what the agent saw, said, and concluded for each issue. This overlaps with Symphony SPEC §10.4 Emitted Runtime Events and §13 Logging / Status / Observability, but it must not turn scheduler runtime state into a persistent claim database. The transcript is an audit/debug record, not a recovery source of truth.

The current runner stack has two execution paths:

- `worker.kind === 'local'`: a long-lived CodeBuddy SDK session owned by `runIssueWorker`.
- `worker.kind === 'ssh'`: CLI subprocess fallback driven one turn at a time.

Both paths already normalize stream messages into runtime events. This change adds a separate persistent transcript recording path while keeping realtime EventBus semantics intact.

## Goals / Non-Goals

**Goals:**

- Persist a per-issue agent transcript locally in SQLite.
- Capture user prompts, continuation prompts, assistant messages, session metadata, result boundaries, failures, and raw SDK/CLI payloads.
- Provide a status-server API for retrieving an issue transcript after daemon restart.
- Add a Dashboard Transcript view separate from the realtime Events view.
- Keep transcript data local to the scheduler runtime directory by default.
- Cover SDK local worker, SSH/CLI fallback, API, and Dashboard behavior with tests.

**Non-Goals:**

- Do not persist scheduler claims, `state.running`, retry queues, or exact SDK session recovery state.
- Do not implement distributed transcript storage.
- Do not require live transcript streaming in the first implementation; the existing SSE stream remains the realtime update path.
- Do not redact arbitrary secrets from agent messages in the first implementation. Transcript storage is local and must be treated as sensitive.
- Do not require rendering every tool-call shape as first-class UI if the SDK/CLI does not expose it in a stable structured form. Raw payloads must still be stored.

## Decisions

### Decision: Use a dedicated SQLite transcript store

The transcript will be stored in a local SQLite database with append-only event rows. Recommended dependency: `better-sqlite3` plus `@types/better-sqlite3`.

Alternatives considered:

- **EventBus history only**: rejected because it is bounded, in-memory, and designed for reconnect replay rather than audit history.
- **JSONL files per issue**: simpler dependency profile, but weaker query support, harder pagination, and more fragile concurrent append behavior.
- **External database**: overkill for the single-node reference implementation and adds deployment burden.

SQLite gives a small operational footprint while supporting stable ordering, pagination, and future filtering.

### Decision: Keep transcript persistence separate from runtime state

Transcript sessions/events are durable, but they are not used by scheduler reconciliation, worker recovery, dispatch eligibility, or claim ownership.

Alternatives considered:

- **Persist all runtime state together with transcript**: rejected because it changes the restart-recovery model and conflicts with the current Symphony-aligned design that treats tracker/workspace as recovery inputs.
- **Attach transcript rows to `RuntimeState`**: rejected because `RuntimeState` is process-local and would mix historical audit data with live scheduling decisions.

This keeps failure recovery predictable: if the daemon restarts, operators can read old transcripts, but the scheduler still re-derives work from tracker and workspace.

### Decision: Record transcript at execution boundaries

Recording should happen at boundaries already owned by the runner/worker:

- before `session.send()` or CLI launch: record the user prompt with turn index;
- on `system` / session init: record session metadata;
- on assistant messages: record display text and raw payload;
- on result/error/timeout: record terminal turn boundary details;
- on unknown messages: record raw payload as `other_message`.

Alternatives considered:

- **Only record normalized `CodebuddyRunnerEvent` objects**: insufficient because user prompts and some raw SDK/CLI data can be lost.
- **Only record raw SDK/CLI messages**: insufficient for UI because the Dashboard needs stable roles and display text.

The store should keep both normalized fields and raw JSON payload.

### Decision: Add a Transcript API under the status server

The status server will expose issue transcript reads, e.g.:

- `GET /api/v1/issues/:issueId/transcript`
- optional query parameters such as `limit` and `after`

Alternatives considered:

- **Serve transcript only through SSE**: rejected for first implementation because historical loading and pagination are easier over HTTP.
- **Fold transcript into `/api/v1/<issue>`**: rejected because existing issue status payload is small and runtime-focused.

HTTP query first keeps the change scoped. Live updates can later use SSE as a notification to refetch.

### Decision: Dashboard gets Events and Transcript as distinct views

The existing live event stream should remain focused on operational events. A new Transcript view/tab should show durable conversation rows grouped by turn where possible.

Alternatives considered:

- **Replace Events with Transcript**: rejected because runtime events and conversation messages answer different questions.
- **Interleave everything in one list**: rejected because scheduler/stuck/progress events make conversation review noisy.

This separation makes failure triage clearer: Events explain orchestration state; Transcript explains agent interaction.

### Decision: Fail startup when transcript persistence is enabled but unavailable

If transcript persistence is enabled and the SQLite database cannot be opened or migrated, startup/check should fail with a clear configuration/runtime error. If explicitly disabled, the system may run without transcript persistence.

Alternatives considered:

- **Silently degrade to in-memory transcript**: rejected because operators asked for durable transcript and silent loss would be misleading.
- **Always mandatory with no disable flag**: rejected because test/local exploration may need to run without native SQLite dependency or durable storage.

Default should be enabled once implemented, with an explicit `transcript.enabled: false` escape hatch.

## Risks / Trade-offs

- [Risk] `better-sqlite3` is a native dependency and may require platform-specific prebuilds or compiler tooling. -> Mitigation: document the dependency rationale, keep SQLite access isolated behind a small `transcript` module, and cover install/package behavior in tests where practical.
- [Risk] Transcripts can contain sensitive prompts, repository paths, tool arguments, or model output. -> Mitigation: keep the database local by default, avoid exposing it beyond the local status server, document it as sensitive runtime data, and do not write transcript payloads to pino logs.
- [Risk] SDK/CLI tool-call shapes may vary by CodeBuddy version. -> Mitigation: store raw payload JSON for every transcript event and only render stable display fields in Dashboard.
- [Risk] Transcript writes could add latency to turn streaming. -> Mitigation: use short synchronous SQLite inserts around already serialized stream handling; keep payloads append-only; avoid expensive queries in the hot path.
- [Risk] Database corruption or migration failure blocks daemon startup when enabled. -> Mitigation: fail clearly during check/startup and allow explicit `transcript.enabled: false` for recovery while preserving the corrupt file for inspection.
- [Risk] Transcript database grows without bound. -> Mitigation: first implementation documents local storage growth; later changes can add retention/compaction policies without changing the base recording contract.

## Migration Plan

1. Add `transcript` configuration with defaults:
   - `enabled: true`
   - `sqlitePath: ./.codebuddy-auto/transcripts.sqlite` resolved relative to `WORKFLOW.md`.
2. Add the SQLite store and migration code. Opening the store creates required tables and indexes.
3. Wire the store into daemon/check startup and status server dependencies.
4. Record transcript events from local SDK worker execution.
5. Record transcript events from SSH/CLI fallback execution.
6. Add transcript read API.
7. Add Dashboard Transcript view and API client.
8. Document local transcript storage and sensitivity.

Rollback strategy:

- Disable transcript persistence with `transcript.enabled: false`.
- Existing transcript SQLite files are ignored when disabled.
- No scheduler state migration is required because scheduler recovery does not depend on transcript tables.

## Open Questions

- Should the initial API identify issues by `issueId`, `identifier`, or support both? Recommendation: support the same identifier style already used by issue status routes, resolving against runtime/tracker data when available.
- Should retention be configured in the first version? Recommendation: defer retention until real transcript sizes are observed.
- Should transcript content be downloadable as Markdown/JSON from Dashboard? Recommendation: defer export until the read-only transcript view is stable.
