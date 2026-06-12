## ADDED Requirements

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
