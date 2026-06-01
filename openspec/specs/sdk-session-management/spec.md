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

#### Scenario: session destroyed on issue release
- **WHEN** an issue is released (terminal state, reconciliation, finish_label, or maxTurns)
- **THEN** the associated SDK session is closed via `session.close()` exactly once
- **AND** the `Session` object and `WorkerHandle` are removed from the runtime state

### Requirement: canUseTool callback

SDK sessions are configured with a `canUseTool` callback for observability and future permission control.

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
