## ADDED Requirements

### Requirement: Progress gate events

The SSE stream SHALL emit issue-scoped events when progress fingerprints are recorded and when an issue becomes stuck.

#### Scenario: progress fingerprint event emitted
- **WHEN** the runtime records a progress fingerprint for an issue
- **THEN** connected SSE clients receive an `issue_event`
- **AND** the event payload identifies the issue and progress-gate event type

#### Scenario: stuck event emitted
- **WHEN** the runtime marks an issue stuck
- **THEN** connected SSE clients receive an `issue_event`
- **AND** the event payload includes the stuck reason
