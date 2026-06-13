## ADDED Requirements

### Requirement: Operator scheduler modes use subcommands
The system SHALL expose operator-facing scheduler modes as top-level subcommands.

#### Scenario: Check command validates the workflow
- **WHEN** an operator runs `codebuddy-auto check`
- **THEN** the system loads `WORKFLOW.md`, validates runtime configuration, and exits without starting the scheduler loop

#### Scenario: Daemon command starts the scheduler loop
- **WHEN** an operator runs `codebuddy-auto daemon`
- **THEN** the system loads `WORKFLOW.md` and starts the polling scheduler until shutdown

#### Scenario: Status command prints runtime status
- **WHEN** an operator runs `codebuddy-auto status`
- **THEN** the system prints a human-readable runtime status snapshot and exits

#### Scenario: Workflow path follows the mode command
- **WHEN** an operator runs `codebuddy-auto check ./ops/WORKFLOW.md`
- **THEN** the system uses `./ops/WORKFLOW.md` as the workflow path for that command

#### Scenario: Reload remains a command option
- **WHEN** an operator runs `codebuddy-auto daemon --reload`
- **THEN** the system reloads workflow/config before daemon ticks using the existing reload behavior

### Requirement: Legacy scheduler mode flags are removed
The system MUST NOT accept `--check`, `--daemon`, or `--status` as top-level scheduler mode selectors.

#### Scenario: Legacy check flag is rejected
- **WHEN** an operator runs `codebuddy-auto --check`
- **THEN** the system rejects the invocation before loading `WORKFLOW.md`

#### Scenario: Legacy daemon flag is rejected
- **WHEN** an operator runs `codebuddy-auto --daemon`
- **THEN** the system rejects the invocation before starting the scheduler
