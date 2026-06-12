# dashboard-bootstrap-api Specification

## Purpose
Defines the Dashboard SPA bootstrap endpoint that provides configuration, initial runtime snapshot, repository metadata, and server time for first render.
## Requirements
### Requirement: Dashboard bootstrap endpoint availability
The status server SHALL expose a bootstrap endpoint for the Dashboard SPA at `GET /api/v1/dashboard/bootstrap`.

#### Scenario: bootstrap endpoint requested
- **WHEN** a client sends `GET /api/v1/dashboard/bootstrap`
- **THEN** the server responds with a JSON document suitable for initial Dashboard rendering

#### Scenario: bootstrap endpoint uses current runtime state
- **WHEN** the bootstrap endpoint responds
- **THEN** the payload reflects the current runtime state known to the status server at request time

### Requirement: Bootstrap payload structure
The bootstrap response SHALL include the frontend-visible configuration and state needed to render the Dashboard before SSE updates begin.

#### Scenario: bootstrap payload contains dashboard inputs
- **WHEN** the client reads the bootstrap response body
- **THEN** it includes a configuration summary, an initial runtime snapshot, and server time metadata

#### Scenario: bootstrap payload includes repository metadata
- **WHEN** tracker repository metadata is available
- **THEN** the bootstrap payload includes a repository URL for dashboard navigation

#### Scenario: bootstrap payload handles missing repository metadata
- **WHEN** tracker repository metadata is unavailable
- **THEN** the bootstrap payload still returns successfully
- **AND** the repository URL field is empty or null rather than omitted through an error
