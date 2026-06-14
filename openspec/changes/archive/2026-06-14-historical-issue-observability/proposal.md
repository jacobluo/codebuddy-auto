## Why

Operators can currently inspect events and transcripts only after selecting an issue that is visible in the live runtime snapshot. Once an issue leaves `running`, `retrying`, or `stuck`, its durable observability data may still exist, but the Dashboard no longer provides a discoverable way to open it.

This change makes historical issue observability a first-class workflow: completed or inactive issues can be found from the Dashboard and inspected through the same persisted Events and Transcript views.

## What Changes

- Add a read-only historical issue index backed by the local transcript SQLite store.
- Expose an API for listing issues that have persisted transcript sessions or dashboard events.
- Allow transcript and event-history reads for issues that are known only to the durable observability store, not just the current runtime snapshot.
- Extend the Dashboard issue sidebar with a history/completed section whose rows can be selected.
- Reuse the existing per-issue Events and Transcript detail panel for historical issues.
- Keep live SSE behavior unchanged; historical reads are explicit HTTP queries against persisted data.

## Capabilities

### New Capabilities

- `historical-issue-observability`: Defines the historical issue index, API contract, and persisted issue summary behavior.

### Modified Capabilities

- `persistent-agent-transcript`: Persisted transcript and dashboard event reads must treat durable store membership as sufficient evidence that an issue is known.
- `dashboard-web-frontend`: The Dashboard must expose selectable historical issues and render their persisted Events and Transcript views.

## Impact

- Affected PLAN.md chapters:
  - `§3` State Schema: introduces a dashboard-facing historical issue summary shape.
  - `§10` Agent Runner Protocol: consumes persisted turn/session metadata produced by local SDK and CLI runners.
  - `§13` Logging / Status / Observability: adds historical issue index and persisted issue detail access to the status surface.
  - `§14` Failure Model and Recovery: defines unavailable/error behavior when transcript persistence is disabled or unreadable.
  - `§17` Test Matrix: requires API, store, hook, and Dashboard coverage for historical issue selection.
- Affected backend code:
  - `typescript/src/transcript/index.ts`
  - `typescript/src/logging/http-status-server.ts`
  - status server tests under `typescript/test/logging/`
- Affected frontend code:
  - `typescript/dashboard/src/api/dashboard-api.ts`
  - `typescript/dashboard/src/hooks/use-dashboard-state.ts`
  - `typescript/dashboard/src/components/issue-sidebar.tsx`
  - `typescript/dashboard/src/components/live-events-panel.tsx`
  - Dashboard component/hook tests
- No new runtime dependency is expected.
