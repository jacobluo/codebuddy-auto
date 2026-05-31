## MODIFIED Requirements

### Requirement: Runner supports dual mode (SDK + CLI fallback)

The runner selects execution mode based on worker kind configuration.

#### Scenario: local worker uses SDK
- **WHEN** `config.worker.kind === 'local'`
- **THEN** the runner uses `@tencent-ai/agent-sdk` in-process to execute the agent turn

#### Scenario: SSH worker uses CLI subprocess
- **WHEN** `config.worker.kind === 'ssh'`
- **THEN** the runner falls back to the existing CLI subprocess path (spawn + NDJSON)

### Requirement: Event mapping from SDK messages

SDK async iterator messages are mapped to existing `CodebuddyRunnerEvent` types.

#### Scenario: system init message maps to session_started
- **WHEN** the SDK yields a message with `type === 'system'`
- **THEN** it is mapped to `{ event: 'session_started', payload: { sessionId, model, tools } }`

#### Scenario: assistant message maps to notification
- **WHEN** the SDK yields a message with `type === 'assistant'`
- **THEN** it is mapped to `{ event: 'notification', payload: { message, usage } }`

#### Scenario: result success maps to turn_completed
- **WHEN** the SDK yields a message with `type === 'result'` and `is_error === false`
- **THEN** it is mapped to `{ event: 'turn_completed', payload: { durationMs, numTurns, usage } }`

#### Scenario: result error maps to turn_failed
- **WHEN** the SDK yields a message with `type === 'result'` and `is_error === true` (excluding max turns exceeded)
- **THEN** it is mapped to `{ event: 'turn_failed', payload: { message } }`

#### Scenario: max turns exceeded still maps to turn_completed
- **WHEN** the SDK yields a result with `is_error === true` and errors containing "Max turns"
- **THEN** it is mapped to `{ event: 'turn_completed' }` (continuation semantics preserved)

### Requirement: onEvent callback compatibility

The `onEvent` callback introduced for EventBus integration continues to work with SDK mode.

#### Scenario: onEvent invoked per SDK message
- **WHEN** the SDK yields a message
- **THEN** after mapping to `CodebuddyRunnerEvent`, `onEvent` is called with the mapped event
