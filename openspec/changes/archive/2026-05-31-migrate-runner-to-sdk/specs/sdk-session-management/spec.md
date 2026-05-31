## ADDED Requirements

### Requirement: Session creation per issue

Each dispatched issue gets a dedicated SDK session that persists across multiple turns.

#### Scenario: session created on first dispatch
- **WHEN** an issue is dispatched for the first time
- **THEN** a new SDK session is created with `cwd` set to the issue workspace path

#### Scenario: session reused across continuation turns
- **WHEN** a continuation turn is triggered for a running issue
- **THEN** the existing session is reused (same in-memory context), not recreated

#### Scenario: session destroyed on issue release
- **WHEN** an issue is released (terminal state, reconciliation, or maxTurns)
- **THEN** the associated SDK session is closed/destroyed and removed from memory

### Requirement: canUseTool callback

SDK sessions are configured with a `canUseTool` callback for observability and future permission control.

#### Scenario: tool calls emitted to EventBus
- **WHEN** the agent requests a tool call during a session
- **THEN** the tool name and arguments are emitted as an `issue_event` to the EventBus

#### Scenario: canUseTool does not block by default
- **WHEN** `canUseTool` is invoked
- **THEN** it returns `true` (allow) in the default configuration

### Requirement: Timeout enforcement

SDK sessions are subject to wall-clock timeout independent of SDK internal behavior.

#### Scenario: turn exceeds turnTimeoutMs
- **WHEN** a `session.query()` call does not complete within `codebuddy.turnTimeoutMs`
- **THEN** the query is aborted and the turn is classified as `turn_timed_out`
