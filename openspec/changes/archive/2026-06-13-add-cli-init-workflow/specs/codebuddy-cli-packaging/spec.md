## ADDED Requirements

### Requirement: Document Init-first Local Usage

The package documentation SHALL describe local CLI usage starting from `codebuddy-auto init` rather than requiring users to invoke checked-in example workflow paths directly.

#### Scenario: User follows local installation docs

- **WHEN** a user reads the local CLI installation section
- **THEN** the documented first-run flow MUST include `codebuddy-auto init`
- **AND** the documented validation flow MUST use root-local `codebuddy-auto check`
- **AND** the documented environment flow MUST tell users to export required environment variables or source their own credential file manually
