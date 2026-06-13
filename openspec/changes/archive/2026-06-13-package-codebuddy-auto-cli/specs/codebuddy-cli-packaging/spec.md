## ADDED Requirements

### Requirement: Local CLI binary
The TypeScript package SHALL expose a local `codebuddy-auto` CLI binary after the package is built and linked or installed from a packed tarball.

#### Scenario: Binary metadata exists
- **WHEN** a user inspects the TypeScript package manifest
- **THEN** the manifest MUST define a `codebuddy-auto` binary pointing to the built CLI entry

#### Scenario: Built binary is directly executable
- **WHEN** a user builds the TypeScript package
- **THEN** the built CLI entry MUST contain a Node.js shebang

### Requirement: Local package contents
The TypeScript package SHALL include the files needed for local operation when packed.

#### Scenario: Packed package includes runtime build
- **WHEN** a user packs the TypeScript package
- **THEN** the package MUST include the built server CLI and dashboard assets

#### Scenario: Packed package includes operator assets
- **WHEN** a user packs the TypeScript package
- **THEN** the package MUST include workflow examples and CNB harness templates

### Requirement: Local installation documentation
The project SHALL document local installation workflows that do not require an npm account.

#### Scenario: User reads local installation docs
- **WHEN** a user reads the installation documentation
- **THEN** the documentation MUST explain source build plus `pnpm link --global`

#### Scenario: User reads tarball installation docs
- **WHEN** a user reads the installation documentation
- **THEN** the documentation MUST explain `pnpm pack` followed by local global installation
