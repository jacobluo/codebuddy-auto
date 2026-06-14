## ADDED Requirements

### Requirement: CLI fallback records persistent transcript events

When `worker.kind === 'ssh'`, each CodeBuddy CLI fallback turn SHALL record transcript events for the prompt passed to the CLI and the structured stream events parsed from CLI output when transcript persistence is enabled.

#### Scenario: CLI first-turn prompt recorded
- **WHEN** the SSH fallback starts turn 1 for an issue
- **THEN** the full rendered task prompt passed to the CLI MUST be recorded as a transcript event with role `user`
- **AND** the event MUST reference the issue id and turn index 1

#### Scenario: CLI continuation prompt recorded
- **WHEN** the SSH fallback starts a continuation turn for an issue
- **THEN** the continuation prompt passed to the CLI MUST be recorded as a transcript event with role `user`
- **AND** the event MUST identify the continuation turn index

#### Scenario: CLI stream events recorded
- **WHEN** the CLI emits structured stream-json events
- **THEN** recognized assistant text, system, message, and result events MUST be recorded as transcript events
- **AND** malformed or unrecognized events MUST be recorded with their raw payload when available

#### Scenario: CLI process failure recorded
- **WHEN** the CLI exits non-zero or the runner classifies the turn as timed out or failed
- **THEN** the failure MUST be recorded as a transcript event
- **AND** the event MUST include available exit code, stderr, timeout, or error message details
