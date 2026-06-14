## ADDED Requirements

### Requirement: Historical issue index
The system SHALL expose a read-only historical issue index for issues that have persisted observability data.

#### Scenario: Issue with transcript sessions is listed
- **WHEN** an issue has one or more persisted transcript sessions
- **THEN** the historical issue index MUST include that issue
- **AND** the issue summary MUST include the issue id, best-known title, latest observed timestamp, session count, transcript event count, and dashboard event count

#### Scenario: Issue with only dashboard events is listed
- **WHEN** an issue has persisted dashboard events but no persisted transcript sessions
- **THEN** the historical issue index MUST include that issue
- **AND** the issue summary MUST provide a fallback display identifier derived from the issue id

#### Scenario: Historical index ordering
- **WHEN** multiple historical issues are returned
- **THEN** the system MUST order them by latest observed timestamp descending
- **AND** ties MUST be ordered by issue id for stable pagination

### Requirement: Historical issue API
The status server SHALL expose a JSON API for listing historical issue summaries.

#### Scenario: History requested
- **WHEN** a client requests `GET /api/v1/issues/history`
- **THEN** the server MUST return a JSON document containing historical issue summaries
- **AND** the response MUST include a pagination cursor when more historical issues are available

#### Scenario: History pagination requested
- **WHEN** a client requests historical issues with `limit` or `after` query parameters
- **THEN** the server MUST return only summaries matching those bounds
- **AND** the response MUST preserve historical index ordering

#### Scenario: History unavailable
- **WHEN** transcript persistence is disabled or unavailable
- **THEN** the history API MUST return an explicit unavailable error
- **AND** live runtime state and SSE endpoints MUST remain usable when configured

### Requirement: Historical issue selection model
Historical issue summaries SHALL be selectable by Dashboard clients without requiring the issue to be present in the live runtime snapshot.

#### Scenario: Historical issue selected
- **WHEN** a Dashboard client selects a historical issue summary
- **THEN** the client MUST be able to request persisted dashboard events for that issue id
- **AND** the client MUST be able to request persisted transcript events for that issue id

#### Scenario: Active issue also appears in history
- **WHEN** an active issue also has persisted historical data
- **THEN** the system MUST preserve the live issue row as the primary active-work representation
- **AND** the historical index MUST NOT create a duplicate active row in the active issue section
