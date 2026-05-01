## ADDED Requirements

### Requirement: Subprocess launch contract

The system SHALL launch CodeBuddy Code CLI as a child process with the per-issue workspace path as its working directory, so that Symphony §9.5 Invariant 1 (`cwd == workspace_path`) holds before any agent-controlled command executes.

#### Scenario: CLI launched in workspace cwd

- **WHEN** the runner dispatches an agent attempt for issue `#101`
- **THEN** the CodeBuddy CLI subprocess is started with `cwd` equal to the absolute workspace path for `#101`
- **AND** the subprocess PID, launch command, and cwd are recorded in the structured launch log with field `issue_identifier`

#### Scenario: Launch aborts when cwd is outside workspace root

- **WHEN** the computed cwd is not a descendant of the configured `workspace.root`
- **THEN** the launch aborts before spawning the subprocess
- **AND** the attempt transitions to `Failed` with reason `invalid_workspace_cwd`

### Requirement: Multi-turn session continuation on the same subprocess

The system SHALL reuse a single live CodeBuddy CLI session across continuation turns within one worker lifetime, so that Symphony §7.1 continuation semantics ("continuation turns SHOULD send only continuation guidance to the existing thread") are preserved without resending the full task prompt.

#### Scenario: Continuation turn reuses session

- **WHEN** the worker completes turn N successfully and the tracker issue state is still active
- **AND** turn count is below `agent.max_turns`
- **THEN** turn N+1 is started on the same CLI session without relaunching the subprocess
- **AND** the full task prompt is NOT resent; only continuation guidance is sent

#### Scenario: Session ends when worker exits

- **WHEN** the worker run finishes (success, failure, timeout, or cancellation)
- **THEN** the CodeBuddy CLI subprocess is terminated
- **AND** the `agent_session_id` is recorded in the exit log

### Requirement: Structured runtime events emitted to the orchestrator

The system SHALL translate CodeBuddy CLI output into structured runtime events that map to Symphony §10.4 event semantics (`session_started` / `turn_completed` / `turn_failed` / `turn_input_required` / `notification` / `other_message` / `malformed` — at minimum).

#### Scenario: Turn completion event emitted

- **WHEN** the CodeBuddy CLI signals successful turn completion
- **THEN** a `turn_completed` event is sent to the orchestrator callback
- **AND** the event contains `event`, `timestamp`, `agent_pid`, and optional `usage` fields

#### Scenario: Unrecognized output classified as malformed

- **WHEN** a CLI output line cannot be parsed into any known event shape
- **THEN** a `malformed` event is emitted containing the original line as payload
- **AND** the worker continues running (unrecognized output does not abort the turn)
