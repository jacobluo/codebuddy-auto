## MODIFIED Requirements

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
