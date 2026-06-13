## 1. Symphony Core Alignment

- [x] 1.1 Add failing worker tests proving `maxTurns` does not apply `tracker.finishLabel` and records a non-handoff stop reason.
- [x] 1.2 Update local `runIssueWorker` max-turns behavior to close the session without applying the finish label.
- [x] 1.3 Add/adjust SSH continuation tests proving `maxTurns` does not apply the finish label in the fallback path.
- [x] 1.4 Update SSH continuation max-turns behavior to stop without automatic finish-label handoff.
- [x] 1.5 Update session lifecycle tests so session close is asserted independently from successful issue handoff.

## 2. Progress Fingerprint Model

- [x] 2.1 Add failing unit tests for progress fingerprint creation from workspace/tracker signals without running validation commands.
- [x] 2.2 Implement a progress fingerprint helper under the scheduler/worker boundary using HEAD, short git status, untracked summary, tracker state, labels, and last worker event.
- [x] 2.3 Add tests for fingerprint change/reset behavior and repeated identical fingerprint counting.
- [x] 2.4 Extend runtime state types to carry per-issue progress metadata and stuck entries.

## 3. No-Progress Gate

- [x] 3.1 Add failing worker/scheduler tests showing an issue becomes stuck after the configured no-progress threshold.
- [x] 3.2 Implement no-progress threshold evaluation at turn boundaries for local workers.
- [x] 3.3 Add SSH continuation tests for no-progress threshold behavior.
- [x] 3.4 Gate dispatch/continuation so in-process stuck issues are not automatically re-run while tracker state remains active.
- [x] 3.5 Add tests proving tracker finish label or inactive state still releases stuck issues through normal reconciliation.

## 4. Observability

- [x] 4.1 Add runtime snapshot tests for progress/stuck state serialization.
- [x] 4.2 Add EventBus/status-server tests for progress fingerprint and stuck issue events.
- [x] 4.3 Update dashboard API/types and UI tests to display stuck issue reason without breaking existing empty states.
- [x] 4.4 Update CLI status formatting tests to include stuck issues when present.

## 5. Documentation And Verification

- [x] 5.1 Update README/PLAN wording to distinguish Symphony-compatible handoff from progress-gate enhancement.
- [x] 5.2 Update generated workflow guidance if needed so agents remain responsible for validation and handoff labels.
- [x] 5.3 Run `pnpm run check` from `typescript/`.
- [x] 5.4 Run `pnpm run test` from `typescript/`.
- [x] 5.5 Run `openspec validate align-symphony-core-progress-gate --strict`.
