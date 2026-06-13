# sdk-session-management Specification

## Purpose

Defines how the CodeBuddy Agent SDK session lifecycle maps to issue lifecycle, including session creation, reuse across continuation turns, destruction on release, tool-call observability via canUseTool, and wall-clock timeout enforcement.
## Requirements
### Requirement: Session creation per issue

Each dispatched issue gets a dedicated SDK session that persists across multiple turns. When `worker.kind === 'local'`, this is realized by the per-issue `IssueWorker` (see capability `sdk-multi-turn-worker`), which holds exactly one `Session` for the issue's full lifetime. The SDK CLI subprocess associated with that session MUST remain alive across all continuation turns and MUST be torn down only when the worker exits.

The system MUST NOT call `query()` once per turn against the same `sessionId`. Per-turn `query()` invocations spawn a fresh CLI subprocess and break the SPEC §10.3 long-lived-thread guarantee even when `resume` is set.

#### Scenario: session created on first dispatch
- **WHEN** an issue is dispatched for the first time and `worker.kind === 'local'`
- **THEN** a new SDK session is created via the session API (e.g., `createSession`) with `cwd` set to the issue workspace path
- **AND** the resulting `Session` object is stored on the per-issue `WorkerHandle`

#### Scenario: session reused across continuation turns
- **WHEN** a continuation turn is triggered for a running issue
- **THEN** the existing `Session` object is reused for `session.send` and `session.stream`
- **AND** no new SDK session is created for the continuation turn
- **AND** the underlying CLI subprocess used by the SDK is NOT respawned between turns

### Requirement: session destroyed on worker exit

Each SDK session SHALL be closed when its owning worker exits for any reason, including tracker handoff, inactive issue state, terminal issue state, graceful exit, timeout, failure, abort, or `maxTurns`. Closing the session MUST NOT imply the issue reached successful workflow handoff.

#### Scenario: session closed after finish label
- **WHEN** a worker observes the configured finish label and exits
- **THEN** the associated SDK session is closed exactly once
- **AND** the worker handle is removed from runtime state

#### Scenario: session closed after maxTurns without handoff
- **WHEN** a worker exits because `agent.maxTurns` was reached
- **THEN** the associated SDK session is closed exactly once
- **AND** the finish label is NOT applied automatically
- **AND** the runtime records the stop reason as `max_turns_reached`

### Requirement: canUseTool callback

SDK sessions SHALL be configured with a `canUseTool` callback for observability and future permission control.

#### Scenario: tool calls emitted to EventBus
- **WHEN** the agent requests a tool call during a session
- **THEN** the tool name and arguments are emitted as an `issue_event` to the EventBus

#### Scenario: canUseTool does not block by default
- **WHEN** `canUseTool` is invoked
- **THEN** it returns `true` (allow) in the default configuration

### Requirement: Timeout enforcement

SDK sessions are subject to wall-clock timeout independent of SDK internal behavior. Each turn MUST be wrapped by an `AbortController` whose `abort()` is called when the turn exceeds `codebuddy.turnTimeoutMs`.

#### Scenario: turn exceeds turnTimeoutMs
- **WHEN** a `session.send` + `session.stream()` turn does not yield a `result` message within `codebuddy.turnTimeoutMs`
- **THEN** the abort controller is signaled
- **AND** the turn is classified as `turn_timed_out`
- **AND** the worker exits the loop without starting another turn

