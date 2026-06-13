## ADDED Requirements

### Requirement: Progress fingerprint recording

The system SHALL record a per-issue progress fingerprint at turn boundaries using observable workspace and tracker signals. The fingerprint MUST NOT require the scheduler to run or interpret project-specific verification commands.

#### Scenario: fingerprint recorded after completed turn
- **WHEN** an issue worker completes a turn
- **THEN** the runtime records a progress fingerprint for that issue
- **AND** the fingerprint includes workspace state and tracker state signals
- **AND** the fingerprint does not include full file contents

#### Scenario: verification command is not required
- **WHEN** a workflow has no validation hook configured
- **THEN** progress fingerprint recording still works
- **AND** the scheduler does not invent a project-specific validation command

### Requirement: No-progress detection

The system SHALL detect repeated no-progress turns for a running issue by comparing current and previous progress fingerprints for that issue.

#### Scenario: repeated identical fingerprints mark issue stuck
- **WHEN** an issue reaches the configured no-progress threshold with identical progress fingerprints
- **THEN** the runtime marks the issue as stuck
- **AND** the stuck reason identifies the repeated fingerprint condition
- **AND** the issue is not marked completed

#### Scenario: changed fingerprint resets no-progress count
- **WHEN** an issue's latest progress fingerprint differs from the previous fingerprint
- **THEN** the no-progress count for that issue resets
- **AND** the issue may continue if it remains active and below other limits

### Requirement: Max-turns stop is stuck state

The system SHALL treat `agent.maxTurns` exhaustion as a non-handoff stuck state rather than successful completion.

#### Scenario: maxTurns marks issue stuck
- **WHEN** an issue worker reaches `agent.maxTurns` without observing workflow handoff
- **THEN** the runtime marks the issue stuck with reason `max_turns_reached`
- **AND** the issue is not marked completed
- **AND** the finish label is not applied automatically

### Requirement: Stuck issues are held from further automatic work

The scheduler SHALL avoid dispatching or continuing an issue that is marked stuck in the current runtime process until operator action or tracker state changes make it eligible again.

#### Scenario: stuck issue not redispatched
- **WHEN** an issue is marked stuck
- **AND** the tracker still returns it as an active candidate
- **THEN** the scheduler does not dispatch another worker for that issue

#### Scenario: tracker handoff releases stuck issue
- **WHEN** a stuck issue later receives the configured finish label or leaves active states
- **THEN** reconciliation releases the issue according to the normal Symphony-compatible handoff rules
