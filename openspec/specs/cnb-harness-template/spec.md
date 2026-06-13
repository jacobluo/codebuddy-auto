# cnb-harness-template Specification

## Purpose
TBD - created by archiving change add-cnb-harness-template. Update Purpose after archive.
## Requirements
### Requirement: Canonical CNB issue template
The project SHALL provide a canonical CNB issue template for agent-ready tasks.

#### Scenario: Template contains scheduler label
- **WHEN** a user inspects the canonical CNB issue template
- **THEN** the template MUST declare the `agent-ready` label as the scheduler candidate label

#### Scenario: Template captures task contract fields
- **WHEN** a user inspects the canonical CNB issue template
- **THEN** the template MUST include required fields for task type, problem, expected behavior, and verification

### Requirement: Harness template installation
The project SHALL provide a local installation path that copies the canonical CNB issue template into a business repository.

#### Scenario: Install into repository without existing template
- **WHEN** a user installs the CNB harness template into a target repository without an existing agent-ready template
- **THEN** the target repository MUST contain `.cnb/ISSUE_TEMPLATE/agent-ready.yml` with the canonical template content

#### Scenario: Existing template is preserved by default
- **WHEN** a user installs the CNB harness template into a target repository that already has `.cnb/ISSUE_TEMPLATE/agent-ready.yml`
- **THEN** the existing file MUST NOT be overwritten by default

#### Scenario: Explicit overwrite refreshes template
- **WHEN** a user installs the CNB harness template with an explicit overwrite option
- **THEN** the existing `.cnb/ISSUE_TEMPLATE/agent-ready.yml` MUST be replaced with the canonical template content

### Requirement: Harness usage documentation
The project SHALL document how business repositories use the installed CNB issue template with `codebuddy-auto`.

#### Scenario: User reads harness documentation
- **WHEN** a user reads the harness documentation
- **THEN** the documentation MUST explain that CNB issue templates take effect in the business repository and that `codebuddy-auto` maintains the canonical source

#### Scenario: User reads label guidance
- **WHEN** a user reads the harness documentation
- **THEN** the documentation MUST explain that `agent-ready`, `skip-agent`, and `agent-finish` labels need to exist in the business repository

