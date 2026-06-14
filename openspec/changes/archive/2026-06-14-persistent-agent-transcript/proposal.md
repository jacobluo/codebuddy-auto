## Why

Operators need to inspect the full agent conversation for an issue, not just realtime scheduler events. The current Dashboard live event stream is in-memory and lossy across restarts, which makes post-failure debugging and handoff review difficult.

This change introduces a persistent per-issue transcript aligned with Symphony SPEC §10.4 Emitted Runtime Events and §13 Logging / Status / Observability while keeping scheduler runtime state itself intentionally non-persistent.

## What Changes

- Add an append-only local SQLite transcript store for agent conversation events.
- Record user prompts, assistant messages, result/error boundaries, session metadata, and raw SDK/CLI payloads for each issue run.
- Add typed transcript configuration under `transcript:` in `WORKFLOW.md` front matter, with a root-local default SQLite path.
- Add status-server API endpoints for reading an issue transcript.
- Add a Dashboard Transcript view/tab that is separate from the existing realtime Events stream.
- Keep existing EventBus/SSE behavior focused on realtime observability; transcript persistence does not replace EventBus history.
- Add tests for persistence, SDK local worker recording, SSH/CLI fallback recording, API responses, and Dashboard rendering.

## Capabilities

### New Capabilities

- `persistent-agent-transcript`: Persistent local SQLite transcript storage, transcript query API, and transcript config contract.

### Modified Capabilities

- `sdk-multi-turn-worker`: Local SDK workers must record first-turn prompts, continuation prompts, assistant messages, result boundaries, failures, and session metadata into the transcript store.
- `codebuddy-cli-integration`: SSH/CLI fallback turns must record CLI prompt input and parsed stream events into the same transcript store.
- `dashboard-web-frontend`: Dashboard must expose a per-issue Transcript view distinct from the existing live event stream.

## Impact

- Affected PLAN.md chapters:
  - `§6` Configuration Specification: add transcript config defaults and path resolution.
  - `§10` Agent Runner Protocol: record SDK/CLI stream messages and prompt boundaries.
  - `§12` Prompt Construction: persist rendered user prompts and continuation guidance.
  - `§13` Logging / Status / Observability: add persistent transcript API and Dashboard view.
  - `§14` Failure Model and Recovery: transcript store startup/open failures must have explicit behavior.
  - `§15` Security and Operational Safety: transcript payloads may contain sensitive prompt/output data and must remain local.
  - `§17` Test Matrix: add store, API, worker, and Dashboard transcript tests.
- Affected TypeScript areas:
  - `typescript/src/spec/` for transcript config schema and response types.
  - `typescript/src/config/` for loading and resolving transcript configuration.
  - `typescript/src/runner/` and `typescript/src/worker/` for transcript recording hooks.
  - `typescript/src/logging/http-status-server.ts` for transcript read endpoints.
  - `typescript/dashboard/src/` for Transcript UI and data fetching.
  - `typescript/test/` and `typescript/dashboard/src/**/*.test.tsx` for regression coverage.
- Dependencies:
  - Add a local SQLite driver, recommended `better-sqlite3` plus its TypeScript types, because Node.js 20 does not provide a stable built-in SQLite API.
- Operational impact:
  - Creates a local SQLite file under the scheduler runtime directory by default.
  - Transcript persistence is local-only and does not persist scheduler claims, running state, or worker session recovery state.
