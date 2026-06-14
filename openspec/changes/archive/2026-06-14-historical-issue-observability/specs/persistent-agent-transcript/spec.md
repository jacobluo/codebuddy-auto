## ADDED Requirements

### Requirement: Historical issue summary reads
The transcript store SHALL provide read-only issue summaries derived from persisted transcript sessions, transcript events, and dashboard events.

#### Scenario: Summary combines transcript and dashboard evidence
- **WHEN** an issue has both transcript events and dashboard events
- **THEN** the summary MUST report counts for both data sources
- **AND** the summary latest observed timestamp MUST reflect the newest timestamp from either data source

#### Scenario: Summary preserves best-known issue metadata
- **WHEN** a transcript session stores an issue title
- **THEN** the summary MUST expose that title as the best-known title for the issue
- **AND** the summary MUST fall back to a stable issue-id display value when no title is available

## MODIFIED Requirements

### Requirement: Transcript read API

The status server SHALL expose a read-only API for retrieving transcript events for an issue.

#### Scenario: Issue transcript requested
- **WHEN** a client requests the transcript for an issue known to the transcript store
- **THEN** the server MUST respond with a JSON document containing the issue id and transcript events
- **AND** each event MUST include id, role, event type, created timestamp, and display text when available

#### Scenario: Historical issue transcript requested
- **WHEN** a client requests the transcript for an issue that is absent from the current runtime snapshot but known to the durable observability store
- **THEN** the server MUST respond with that issue's persisted transcript events
- **AND** the server MUST NOT return `transcript_not_found` only because the issue is no longer active

#### Scenario: Transcript pagination requested
- **WHEN** a client requests a transcript with `limit` or `after` query parameters
- **THEN** the server MUST return only events matching those bounds
- **AND** the response MUST preserve event ordering

#### Scenario: Transcript unavailable
- **WHEN** transcript persistence is disabled
- **THEN** transcript read endpoints MUST return an explicit unavailable error rather than an empty successful transcript

#### Scenario: Unknown issue transcript requested
- **WHEN** a client requests a transcript for an issue absent from both the current runtime snapshot and durable observability store
- **THEN** the server MUST return a not-found error
- **AND** the response MUST distinguish the unknown issue from a known historical issue with no events in the requested page
