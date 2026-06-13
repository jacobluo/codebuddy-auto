## Why

The current worker can mark an issue finished when `maxTurns` is reached, even if the agent never reached the workflow-defined handoff state. Real CRM runs also showed that repeated turns can make no practical progress while the scheduler continues running, so we need to align the core lifecycle with Symphony and add an explicit, optional progress guard.

## What Changes

- Align the core worker lifecycle with Symphony SPEC §1.1, §7.1, and §7.3: scheduler release remains driven by tracker state, inactive state, terminal state, or workflow handoff signal.
- Change `maxTurns` behavior so reaching the limit is not treated as successful handoff and does not automatically apply the finish label.
- Preserve agent responsibility for business validation, commits, pushes, PR/comment handoff, and finish-label application through the workflow prompt.
- Add a progress-gate enhancement layer that observes per-turn workspace/tracker progress without interpreting project-specific verification commands.
- Surface stuck/no-progress state through runtime snapshot, events, and dashboard/status surfaces.
- Keep validation command execution outside the scheduler core; hooks may still run, but hook results are observability inputs rather than business-completion authority.

## Capabilities

### New Capabilities

- `orchestration-progress-gate`: Detects repeated no-progress worker turns using workspace/tracker fingerprints and exposes stuck state without taking over project verification semantics.

### Modified Capabilities

- `sdk-multi-turn-worker`: Reclassify `maxTurns` as a non-handoff stop condition that does not automatically add the finish label.
- `sdk-session-management`: Clarify that SDK sessions close on worker exit, while max-turns exit is not a successful issue handoff.
- `dashboard-bootstrap-api`: Include progress/stuck state in the runtime snapshot served to dashboard clients.
- `sse-event-stream`: Emit issue events when progress fingerprints are recorded and when an issue becomes stuck.

## Impact

- Affected PLAN.md chapters: §1 Project Positioning, §7 Orchestration State Machine, §8 Polling / Scheduling / Reconciliation, §10 Agent Runner Protocol, §13 Logging / Status / Observability, §14 Failure Model and Recovery, §17 Test Matrix.
- Affected implementation areas:
  - `typescript/src/worker/run-issue-worker.ts`
  - `typescript/src/worker/dispatch-local-issue.ts`
  - `typescript/src/scheduler/*`
  - `typescript/src/logging/runtime-snapshot.ts`
  - `typescript/src/logging/http-status-server.ts`
  - `typescript/dashboard/src/**`
  - relevant unit, integration, and E2E tests
- No new runtime dependency is expected.
- No breaking CLI/API removal is expected, but runtime snapshot shape will gain additive progress/stuck fields.
