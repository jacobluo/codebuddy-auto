## ADDED Requirements

### Requirement: Dashboard historical issue list
The Dashboard SHALL expose historical issues that have persisted observability data.

#### Scenario: Historical issues load
- **WHEN** the Dashboard initializes successfully
- **THEN** it MUST request historical issue summaries from the status server
- **AND** it MUST render historical issues in a section separate from active work

#### Scenario: Historical issues unavailable
- **WHEN** the historical issue API returns an unavailable response
- **THEN** the Dashboard MUST show a scoped unavailable state for the history section
- **AND** active issue monitoring MUST remain usable

#### Scenario: Active issue deduplicated from history section
- **WHEN** an issue appears in both the live runtime snapshot and the historical issue summaries
- **THEN** the Dashboard MUST render the issue in the active work section
- **AND** it MUST NOT render a duplicate selectable row for the same issue in the historical section

### Requirement: Dashboard historical issue detail
The Dashboard SHALL allow operators to inspect persisted Events and Transcript data for selected historical issues.

#### Scenario: Historical issue selected
- **WHEN** an operator selects a historical issue row
- **THEN** the Events view MUST request persisted dashboard event history for that issue
- **AND** the Transcript view MUST request persisted transcript events for that issue

#### Scenario: Historical issue detail header
- **WHEN** a historical issue is selected
- **THEN** the issue detail panel MUST identify the selected issue using historical summary metadata
- **AND** it MUST avoid showing active-only metadata such as a workspace path unless that metadata is available

#### Scenario: Historical issue receives new realtime event
- **WHEN** a selected historical issue receives a later realtime issue event
- **THEN** the Dashboard MUST merge the realtime event with persisted event history without duplicating events that share the same id
- **AND** the selected issue MUST remain open
