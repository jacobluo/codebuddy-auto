# dashboard-web-frontend Specification

## Purpose
Defines the React Dashboard SPA shell, issue drill-down interactions, refresh and connection state behavior, and empty/error states.
## Requirements
### Requirement: Dashboard SPA shell
The system SHALL render the Dashboard as a single-page web application at `GET /` using a modular frontend shell instead of a server-generated inline HTML document.

#### Scenario: dashboard shell loads successfully
- **WHEN** a user opens `GET /`
- **THEN** the response loads the Dashboard SPA shell
- **AND** the page renders a header, configuration summary, metric grid, issue list panel, and live events panel

#### Scenario: first render uses bootstrap data
- **WHEN** the Dashboard SPA starts successfully
- **THEN** it initializes its visible state from the bootstrap API response before waiting for live SSE updates

### Requirement: Issue drill-down interaction
The Dashboard SPA SHALL allow the user to select a visible issue and inspect its live detail state without leaving the page.

#### Scenario: running issue selected
- **WHEN** the user selects a running issue from the issue list
- **THEN** that issue is shown as the active selection
- **AND** the live events panel updates to display the selected issue identifier and issue-specific event stream

#### Scenario: retrying issue selected
- **WHEN** the user selects a retrying issue from the issue list
- **THEN** the live events panel updates to the selected issue
- **AND** the issue list preserves the active selection state until another issue is chosen

### Requirement: Dashboard actions and connection state
The Dashboard SPA SHALL expose refresh and stream-connection state as first-class UI behaviors.

#### Scenario: manual refresh requested
- **WHEN** the user triggers the refresh action
- **THEN** the client sends a `POST /api/v1/refresh` request
- **AND** the page remains usable while waiting for the next state update

#### Scenario: stream connection changes
- **WHEN** the global SSE connection transitions between connecting, connected, reconnecting, or disconnected
- **THEN** the Dashboard header displays the current connection state
- **AND** the last successfully rendered snapshot remains visible until newer data arrives

### Requirement: Empty and error states
The Dashboard SPA SHALL provide explicit empty or error states for normal no-data and failed-load conditions.

#### Scenario: no issue selected
- **WHEN** the page has loaded and the user has not selected an issue
- **THEN** the live events panel shows an empty-state message instead of stale issue details

#### Scenario: bootstrap request fails
- **WHEN** the bootstrap API request fails before the first successful render
- **THEN** the page shows a recoverable error state
- **AND** the user is offered a way to retry initialization

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
