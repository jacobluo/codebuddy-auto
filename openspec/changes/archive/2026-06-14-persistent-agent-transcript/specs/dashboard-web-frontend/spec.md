## ADDED Requirements

### Requirement: Dashboard transcript view

The Dashboard SHALL provide a per-issue Transcript view that is distinct from the existing realtime Events view.

#### Scenario: Operator opens transcript for selected issue
- **WHEN** an operator selects an issue in the Dashboard and switches to the Transcript view
- **THEN** the Dashboard MUST request that issue's transcript from the status server
- **AND** it MUST render stored transcript events for that issue

#### Scenario: Transcript newest first
- **WHEN** transcript events include turn indexes
- **THEN** the Dashboard MUST present newer transcript events above older transcript events
- **AND** it MUST visually distinguish user, assistant, tool, result, error, and runtime roles

#### Scenario: Events view remains realtime
- **WHEN** an operator switches between Events and Transcript views
- **THEN** the existing live event stream MUST remain available
- **AND** transcript history MUST NOT replace or remove realtime scheduler events

#### Scenario: Events view loads persisted history
- **WHEN** an operator selects an issue with persisted dashboard events
- **THEN** the Dashboard MUST request that issue's event history from the status server
- **AND** it MUST append later realtime SSE events without duplicating events that share the same id

#### Scenario: Transcript unavailable state
- **WHEN** transcript persistence is disabled or the transcript API returns unavailable
- **THEN** the Dashboard MUST show a clear unavailable state for the Transcript view
- **AND** the Events view MUST remain usable

### Requirement: Dashboard transcript refresh

The Dashboard SHALL allow transcript data to reflect newly recorded events without requiring a full page reload.

#### Scenario: Selected issue receives new realtime event
- **WHEN** the selected issue receives a realtime issue event while the Transcript view is active
- **THEN** the Dashboard MUST be able to refresh or re-request transcript data for that issue
- **AND** the refreshed transcript MUST preserve event ordering

#### Scenario: Transcript API error
- **WHEN** the transcript API request fails
- **THEN** the Dashboard MUST show an error state scoped to the Transcript view
- **AND** the rest of the Dashboard MUST remain usable
