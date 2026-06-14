## 1. Transcript Store And Status API

- [x] 1.1 Add failing transcript-store tests for listing historical issue summaries from transcript sessions, transcript events, and dashboard events.
- [x] 1.2 Implement historical issue summary types and read queries in the transcript store, including stable ordering and pagination support.
- [x] 1.3 Add failing status-server tests for `GET /api/v1/issues/history`, unavailable responses, pagination, and historical transcript reads for issues absent from the runtime snapshot.
- [x] 1.4 Implement the history API route and update transcript-not-found logic to treat durable store membership as a known issue source.

## 2. Dashboard API And State

- [x] 2.1 Add failing dashboard API client tests for fetching historical issue summaries and surfacing unavailable/error responses.
- [x] 2.2 Add dashboard types and API client support for historical issue summaries.
- [x] 2.3 Add failing hook tests for loading historical issues, deduplicating active issues, selecting a historical issue, and loading its persisted events/transcript.
- [x] 2.4 Extend the Dashboard state hook to load history, keep history errors scoped, and support selected issues that are not in the live runtime snapshot.

## 3. Dashboard UI

- [x] 3.1 Add failing component tests for the historical issue list, unavailable state, deduplication, and historical issue detail header.
- [x] 3.2 Update `IssueSidebar` to render a separate historical issue section with selectable rows.
- [x] 3.3 Update issue detail rendering so active and historical selections share Events/Transcript views while avoiding active-only metadata for historical issues.
- [x] 3.4 Update Dashboard styles for historical rows and scoped history states without changing the existing active-work layout.

## 4. Verification

- [x] 4.1 Run `pnpm run check` and fix any type errors.
- [x] 4.2 Run `pnpm run test` and fix any test failures.
- [x] 4.3 Run `pnpm run build` and confirm dashboard assets still build.
- [x] 4.4 Review OpenSpec status for `historical-issue-observability` and ensure it is apply-ready.
