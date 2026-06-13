## ADDED Requirements

### Requirement: Initialize Scheduler Runtime Directory

The CLI SHALL provide an `init` command that initializes the current working directory as a runnable `codebuddy-auto` scheduler runtime directory.

#### Scenario: Initialize with editable defaults

- **WHEN** the user runs `codebuddy-auto init`
- **THEN** the system MUST create `WORKFLOW.md` in the current directory
- **AND** the generated workflow MUST contain editable placeholder values for `tracker.projectSlug` and the target repository clone URL
- **AND** the generated workflow MUST use root-local workspace paths suitable for running `codebuddy-auto check` from the same directory after required environment variables are loaded

#### Scenario: Interactive initialization asks for project options

- **WHEN** the user runs `codebuddy-auto init` in an interactive terminal
- **THEN** the system MUST ask for the CNB project slug
- **AND** the system MUST ask for the target repository clone URL
- **AND** the generated workflow MUST use the supplied answers

#### Scenario: Initialize with CNB project options

- **WHEN** the user runs `codebuddy-auto init --project relaxorg/symphony_repo_crm --repo-url https://cnb.cool/relaxorg/symphony_repo_crm.git`
- **THEN** the system MUST create `WORKFLOW.md` in the current directory
- **AND** the generated workflow MUST configure `tracker.projectSlug` as `relaxorg/symphony_repo_crm`
- **AND** the generated workflow MUST clone `https://cnb.cool/relaxorg/symphony_repo_crm.git` in `hooks.after_create`
- **AND** the generated workflow MUST use root-local workspace paths suitable for running `codebuddy-auto check` from the same directory

#### Scenario: Create workspace root

- **WHEN** initialization succeeds
- **THEN** the system MUST create `.codebuddy-auto/workspaces` under the current directory

#### Scenario: Leave credential files unmanaged

- **WHEN** initialization succeeds
- **THEN** the system MUST NOT create `.env`
- **AND** the system MUST NOT create `.env.example`
- **AND** any existing `.env` file MUST remain unchanged

### Requirement: Preserve Existing Initialization Files

The CLI SHALL protect existing initialization files unless the user explicitly opts into replacement.

#### Scenario: Existing workflow blocks init

- **WHEN** the user runs `codebuddy-auto init` in a directory that already contains `WORKFLOW.md`
- **THEN** the system MUST return a non-zero exit code
- **AND** the system MUST leave the existing `WORKFLOW.md` unchanged

#### Scenario: Force overwrites workflow

- **WHEN** the user runs `codebuddy-auto init --force` in a directory that already contains `WORKFLOW.md`
- **THEN** the system MUST replace `WORKFLOW.md` with generated content
