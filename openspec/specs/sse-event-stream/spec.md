## ADDED Requirements

### Requirement: SSE endpoint availability

The status server exposes an SSE endpoint for real-time event streaming.

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

Events follow the standard SSE protocol.

#### Scenario: event framing
- **WHEN** an event is pushed to the client
- **THEN** it is formatted as `id: <monotonic-id>\nevent: <type>\ndata: <json>\n\n`

#### Scenario: JSON data payload
- **WHEN** the `data` field is read
- **THEN** it is a valid JSON object with fields: `issueId`, `event`, `payload`, `timestamp`

### Requirement: Reconnection replay

Clients can resume from where they left off.

#### Scenario: client sends Last-Event-ID
- **WHEN** a client reconnects with `Last-Event-ID: 42`
- **THEN** all events with `id > 42` still in history are replayed before live streaming begins

#### Scenario: history gap detected
- **WHEN** `Last-Event-ID` references an event no longer in history
- **THEN** the server sends a `state_snapshot` event first (full state) then continues live

### Requirement: Connection cleanup

Server resources are freed when clients disconnect.

#### Scenario: client disconnects
- **WHEN** the SSE connection closes (client navigates away / network drop)
- **THEN** the EventBus subscription is removed and no further writes to that response occur
