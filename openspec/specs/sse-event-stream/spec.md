# sse-event-stream Specification

## Purpose
Defines the status server's Server-Sent Events endpoint, event envelope, replay behavior, and connection cleanup guarantees for real-time dashboard observability.
## Requirements
### Requirement: SSE endpoint availability

The status server SHALL expose an SSE endpoint for real-time event streaming.

#### Scenario: global event stream
- **WHEN** a client connects to `GET /api/v1/events`
- **THEN** the response has `Content-Type: text/event-stream` and streams all events from the EventBus

#### Scenario: per-issue event stream
- **WHEN** a client connects to `GET /api/v1/events?issueId=3`
- **THEN** only events with `issueId === "3"` are streamed to that client

#### Scenario: connection kept alive
- **WHEN** no events are available
- **THEN** the server sends periodic `:keepalive` comments (every 15s) to prevent proxy timeout

### Requirement: SSE event format

Events follow the standard SSE protocol and SHALL expose a stable event envelope for Dashboard SPA consumers.

#### Scenario: event framing
- **WHEN** an event is pushed to the client
- **THEN** it is formatted as `id: <monotonic-id>\nevent: <type>\ndata: <json>\n\n`
- **AND** the SSE `event` field is one of `issue_event`, `scheduler_event`, or `state_snapshot`

#### Scenario: JSON data payload
- **WHEN** the `data` field is read
- **THEN** it is a valid JSON object with fields `type`, `timestamp`, and `payload`
- **AND** it includes `issueId` when the event is associated with a specific issue
- **AND** the JSON `type` matches the SSE `event` field

### Requirement: Reconnection replay

Clients MUST be able to resume from where they left off when event history is still available.

#### Scenario: client sends Last-Event-ID
- **WHEN** a client reconnects with `Last-Event-ID: 42`
- **THEN** all events with `id > 42` still in history are replayed before live streaming begins

#### Scenario: history gap detected
- **WHEN** `Last-Event-ID` references an event no longer in history
- **THEN** the server sends a `state_snapshot` event first (full state) then continues live

### Requirement: Connection cleanup

Server resources SHALL be freed when clients disconnect.

#### Scenario: client disconnects
- **WHEN** the SSE connection closes (client navigates away / network drop)
- **THEN** the EventBus subscription is removed and no further writes to that response occur

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

