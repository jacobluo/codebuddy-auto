## ADDED Requirements

### Requirement: Local worker records persistent transcript events

When `worker.kind === 'local'`, the per-issue SDK worker SHALL record transcript events for each prompt and stream message it sends or receives when transcript persistence is enabled.

#### Scenario: First turn prompt recorded
- **WHEN** a local worker starts turn 1 for an issue
- **THEN** the rendered task prompt sent to the SDK session MUST be recorded as a transcript event with role `user`
- **AND** the event MUST reference the issue id and turn index 1

#### Scenario: Continuation prompt recorded
- **WHEN** a local worker starts a continuation turn for an issue
- **THEN** the continuation guidance sent to the SDK session MUST be recorded as a transcript event with role `user`
- **AND** the event MUST identify the continuation turn index

#### Scenario: SDK stream messages recorded
- **WHEN** a local worker receives SDK stream messages during a turn
- **THEN** assistant text messages, session metadata, result messages, and unknown messages MUST be recorded as transcript events
- **AND** each recorded event MUST retain the raw SDK payload

#### Scenario: Local worker failure recorded
- **WHEN** a local worker classifies a turn as failed, timed out, or startup failed
- **THEN** it MUST record a transcript event describing the failure
- **AND** the event MUST include the error or timeout detail when available
