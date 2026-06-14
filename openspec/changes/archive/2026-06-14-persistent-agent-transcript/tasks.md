## 1. Configuration and Storage

- [x] 1.1 Add failing tests for `transcript.enabled` and `transcript.sqlite_path` workflow config defaults, path resolution, and explicit disable behavior.
- [x] 1.2 Implement transcript config schema, default values, snake_case loading, and preflight/startup validation.
- [x] 1.3 Add failing tests for SQLite transcript store initialization, schema creation, append ordering, pagination, and disabled-store behavior.
- [x] 1.4 Add `better-sqlite3` dependency and implement `typescript/src/transcript/` store module with append-only session/event APIs.
- [x] 1.5 Add tests for transcript initialization failure when the configured SQLite path cannot be opened.
- [x] 1.6 Wire transcript store lifecycle into CLI runtime creation/check/daemon startup without persisting scheduler runtime state.

## 2. Runner and Worker Recording

- [x] 2.1 Add failing SDK worker tests proving initial prompts, continuation prompts, assistant messages, session metadata, results, failures, and timeouts are recorded.
- [x] 2.2 Implement transcript recording in local SDK worker and SDK turn adapter, preserving raw SDK payload JSON.
- [x] 2.3 Add failing CLI fallback tests proving first-turn prompts, continuation prompts, parsed stream-json events, malformed events, stderr, exit code, and timeout failures are recorded.
- [x] 2.4 Implement transcript recording in CLI fallback command execution and continuation paths, preserving raw CLI payload JSON.
- [x] 2.5 Add regression tests proving transcript write failure classifies the current turn as failed and emits visible failure details.

## 3. Status API

- [x] 3.1 Add failing status-server tests for `GET /api/v1/issues/:issueId/transcript` successful response, unknown issue transcript, disabled transcript store, `limit`, and `after`.
- [x] 3.2 Implement transcript response types and status-server transcript endpoints.
- [x] 3.3 Add tests proving transcript API does not change existing `/api/v1/state`, `/api/v1/events`, and Dashboard bootstrap behavior.

## 4. Dashboard Transcript View

- [x] 4.1 Add failing dashboard API client tests for fetching transcript events and handling unavailable/error responses.
- [x] 4.2 Implement dashboard transcript API client and TypeScript types.
- [x] 4.3 Add failing React tests for Events/Transcript switching, turn-ordered transcript rendering, role styling, unavailable state, and transcript request failure state.
- [x] 4.4 Implement Dashboard Transcript view/tab while preserving existing live Events behavior.
- [x] 4.5 Add rendered frontend smoke validation with Playwright for a selected issue showing persisted transcript rows.

## 5. Documentation and Verification

- [x] 5.1 Document transcript configuration, local SQLite file location, sensitivity of stored transcript data, and disable behavior.
- [x] 5.2 Update architecture documentation to describe transcript storage as durable observability, not scheduler state persistence.
- [x] 5.3 Run focused tests for config, transcript store, runner recording, status API, and Dashboard transcript UI.
- [x] 5.4 Run full `pnpm run check` and `pnpm run test`.
- [x] 5.5 Review the OpenSpec requirements against implementation evidence before archive.

## 6. Durable Dashboard Events

- [x] 6.1 Add failing tests for SQLite dashboard event history, disabled storage behavior, and EventBus id continuation.
- [x] 6.2 Implement `dashboard_events` persistence in the SQLite observability store and append from `EventBus.emit()`.
- [x] 6.3 Add failing status-server and dashboard API tests for `GET /api/v1/events/history` with `issueId`, `after`, and `limit`.
- [x] 6.4 Implement dashboard event history API and load persisted issue events before live SSE updates.
- [x] 6.5 Run focused tests, full typecheck, full test suite, and OpenSpec validation after event persistence changes.
