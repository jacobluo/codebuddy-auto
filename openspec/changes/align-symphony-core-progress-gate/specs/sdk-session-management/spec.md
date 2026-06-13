## MODIFIED Requirements

### Requirement: session destroyed on worker exit

Each SDK session SHALL be closed when its owning worker exits for any reason, including tracker handoff, inactive issue state, terminal issue state, graceful exit, timeout, failure, abort, or `maxTurns`. Closing the session MUST NOT imply the issue reached successful workflow handoff.

#### Scenario: session closed after finish label
- **WHEN** a worker observes the configured finish label and exits
- **THEN** the associated SDK session is closed exactly once
- **AND** the worker handle is removed from runtime state

#### Scenario: session closed after maxTurns without handoff
- **WHEN** a worker exits because `agent.maxTurns` was reached
- **THEN** the associated SDK session is closed exactly once
- **AND** the finish label is NOT applied automatically
- **AND** the runtime records the stop reason as `max_turns_reached`

