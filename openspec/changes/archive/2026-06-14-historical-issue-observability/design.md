## Context

The previous `persistent-agent-transcript` change added a durable SQLite observability store for transcript events and dashboard event history. The status server can already read per-issue transcripts and persisted dashboard events when the caller knows the issue id.

The remaining gap is discoverability. The Dashboard issue sidebar is driven by the live runtime snapshot, so it only exposes `running`, `retrying`, and `stuck` issues. Completed issue ids are shown as passive chips, and issues from previous daemon runs can disappear from the UI even though their transcripts and events are still present in the SQLite store.

This change adds a historical issue index on top of the existing durable store. It does not make scheduler state durable. It only makes observability data discoverable after an issue leaves the live runtime surface, aligning with Symphony SPEC §10.4 Emitted Runtime Events and PLAN §13 Logging / Status / Observability.

## Goals / Non-Goals

**Goals:**

- Provide a read-only status-server API that lists historical issues with persisted observability data.
- Let the Dashboard show selectable historical issues alongside active work.
- Allow selected historical issues to load persisted Events and Transcript data even when they are absent from the current runtime snapshot.
- Keep historical data bounded by explicit API pagination and frontend limits.
- Preserve existing live SSE behavior for active issues.

**Non-Goals:**

- Persist scheduler runtime state such as `running`, `claimed`, `retryAttempts`, or `completed`.
- Add tracker writes, issue comments, PR creation, or automatic handoff changes.
- Introduce search across transcript text or dashboard event payloads.
- Add a new database dependency or external observability service.
- Reconstruct a full tracker Issue object for historical issues.

## Decisions

### Historical index comes from the transcript store

The historical issue index will be derived from the existing SQLite observability store, using transcript sessions, transcript events, and dashboard events as evidence that an issue exists.

Alternatives considered:

- Use only `runtimeSnapshot.completedIssueIds`: rejected because it only represents the current daemon process and loses previous-run history.
- Query the tracker for closed issues: rejected because tracker APIs differ by backend and would make Dashboard history dependent on remote availability.
- Add a second history database: rejected because the transcript store already owns durable observability data.

### Historical issue summaries are intentionally small

The API will return summary records: issue id, best-known identifier/title when available, last observed timestamp, counts, and status source. The UI can render these as selectable rows without pretending they are full live Issue objects.

Alternatives considered:

- Return full tracker Issue shapes: rejected because historical records may not have current tracker state, labels, or description.
- Return only issue ids: rejected because the Dashboard would be hard to scan and sort.

### Reuse the existing detail panel

Selecting a historical issue will reuse the existing Events and Transcript panel. Active issues and historical issues will share the same selected-issue state, while the selected issue metadata can come from either the live snapshot or the historical index.

Alternatives considered:

- Build a separate history detail page: rejected for now because it duplicates event/transcript rendering.
- Use a manual issue id input only: rejected because it solves lookup for power users but not discoverability.

### Store membership is enough for transcript reads

The transcript endpoint currently treats an issue as unknown when no events are returned and the runtime controller does not know the issue. Historical access requires the server to distinguish "no transcript rows for this page" from "issue has never been observed." Store membership will be checked through historical issue metadata before returning 404.

Alternatives considered:

- Always return 200 with an empty transcript: rejected because typos and genuinely unknown issues would become silent empty states.
- Keep runtime-controller membership as the only known-issue source: rejected because historical issues are often absent from runtime state by design.

## Risks / Trade-offs

- [Risk] Historical summaries may have incomplete titles when only dashboard events were recorded -> Mitigation: expose a fallback identifier such as `#<issueId>` and mark the metadata source.
- [Risk] Large local transcript databases could make the history query slow -> Mitigation: keep the API paginated and add/verify indexes on issue id and timestamps during implementation.
- [Risk] Users may confuse historical rows with active work -> Mitigation: render historical rows in a separate Dashboard section with distinct state labels and no live workspace assumptions.
- [Risk] Persistence disabled makes history unavailable -> Mitigation: return explicit unavailable errors and keep live Dashboard behavior usable.

## Migration Plan

1. Extend the transcript store schema access layer with read-only historical issue summary queries.
2. Add the status-server history endpoint without changing existing SSE routes.
3. Update Dashboard types, API client, state hook, sidebar, and detail metadata handling.
4. Add backend and frontend tests before implementation changes, following the project TDD rule.
5. Existing SQLite databases require no destructive migration; new read queries operate on existing tables.
6. Rollback is removing the new endpoint/UI wiring; persisted transcript and event data remains compatible.

## Open Questions

- None for the initial scope. Text search and tracker-backed enrichment are intentionally deferred.
