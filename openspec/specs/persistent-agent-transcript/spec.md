# persistent-agent-transcript Specification

## Purpose

Defines the durable local observability store for agent transcripts and Dashboard event history.

## Requirements

### Requirement: Transcript persistence configuration

The system SHALL expose transcript persistence configuration in workflow front matter under `transcript`.

#### Scenario: Default transcript persistence is enabled
- **WHEN** a workflow omits the `transcript` section
- **THEN** transcript persistence MUST be enabled
- **AND** the transcript database path MUST default to `.codebuddy-auto/transcripts.sqlite` resolved relative to the workflow directory

#### Scenario: Transcript persistence can be disabled explicitly
- **WHEN** a workflow sets `transcript.enabled` to `false`
- **THEN** the system MUST run without opening or writing a transcript database
- **AND** transcript read APIs MUST return a clear unavailable response

#### Scenario: Custom transcript path is resolved
- **WHEN** a workflow sets `transcript.sqlite_path` to a relative path
- **THEN** the path MUST be resolved relative to the workflow directory
- **AND** the resolved path MUST be included in typed service configuration

### Requirement: Durable transcript event store

The system SHALL persist agent transcript events to a local SQLite database as append-only records.

#### Scenario: Store initialized on startup
- **WHEN** transcript persistence is enabled and the daemon or check command loads a valid workflow
- **THEN** the transcript store MUST be opened
- **AND** required transcript tables and indexes MUST exist before issue work can be dispatched

#### Scenario: Event order is stable
- **WHEN** multiple transcript events are recorded for the same issue
- **THEN** the stored events MUST preserve a monotonically increasing order
- **AND** transcript API responses MUST return events in that order unless a query explicitly asks for a bounded suffix

#### Scenario: Raw payload retained
- **WHEN** a transcript event is recorded from an SDK or CLI stream message
- **THEN** the event MUST store a human-readable role and event type
- **AND** the event MUST store the raw payload as JSON for later inspection

### Requirement: Transcript event model

Transcript events SHALL identify the issue, session, turn, role, event type, display text, raw payload, and creation time when those values are available.

#### Scenario: User prompt event
- **WHEN** the system sends a rendered task prompt or continuation prompt to the agent
- **THEN** it MUST record a transcript event with role `user`
- **AND** the event type MUST identify whether the prompt is an initial task prompt or continuation prompt
- **AND** the display text MUST contain the exact prompt text sent to the agent

#### Scenario: Assistant message event
- **WHEN** the agent emits assistant text during a turn
- **THEN** the system MUST record a transcript event with role `assistant`
- **AND** the display text MUST contain the assistant text extracted from the stream message

#### Scenario: Assistant message without display text
- **WHEN** the agent emits an assistant stream message without display text
- **THEN** the system MUST NOT persist it as a user-visible transcript message

#### Scenario: Turn boundary event
- **WHEN** a turn completes, fails, or times out
- **THEN** the system MUST record a transcript event with role `result` or `error`
- **AND** the event MUST include the turn index when known
- **AND** the raw payload MUST include available usage, duration, error, or timeout details

### Requirement: Transcript read API

The status server SHALL expose a read-only API for retrieving transcript events for an issue.

#### Scenario: Issue transcript requested
- **WHEN** a client requests the transcript for an issue known to the transcript store
- **THEN** the server MUST respond with a JSON document containing the issue id and transcript events
- **AND** each event MUST include id, role, event type, created timestamp, and display text when available

#### Scenario: Transcript pagination requested
- **WHEN** a client requests a transcript with `limit` or `after` query parameters
- **THEN** the server MUST return only events matching those bounds
- **AND** the response MUST preserve event ordering

#### Scenario: Transcript unavailable
- **WHEN** transcript persistence is disabled
- **THEN** transcript read endpoints MUST return an explicit unavailable error rather than an empty successful transcript

### Requirement: Transcript persistence failure handling

The system SHALL fail clearly when transcript persistence is enabled but cannot be initialized.

#### Scenario: Database cannot be opened
- **WHEN** transcript persistence is enabled and the configured SQLite database cannot be opened or migrated
- **THEN** startup or check MUST fail with a clear error message
- **AND** issue work MUST NOT be dispatched

#### Scenario: Transcript write fails during a run
- **WHEN** recording a transcript event fails after the daemon has started
- **THEN** the current agent turn MUST be classified as failed
- **AND** the failure details MUST be available through realtime events and logs

### Requirement: Durable dashboard event log

The system SHALL persist Dashboard live events to the same local SQLite observability store as transcript data.

#### Scenario: EventBus emits dashboard events
- **WHEN** the daemon emits an `issue_event`, `scheduler_event`, or `state_snapshot`
- **THEN** the event MUST remain available through a read API after it has left the in-memory EventBus history
- **AND** event ids MUST remain monotonically increasing across daemon restarts when persistence is enabled

#### Scenario: Dashboard event history requested
- **WHEN** a client requests persisted dashboard events with `issueId`, `after`, or `limit`
- **THEN** the server MUST return matching events in id order
- **AND** the response MUST preserve the same payload shape used by the live SSE stream

#### Scenario: Dashboard events unavailable
- **WHEN** transcript persistence is disabled
- **THEN** persisted dashboard event history endpoints MUST return an explicit unavailable error
