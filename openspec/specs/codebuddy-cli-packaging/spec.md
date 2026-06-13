# codebuddy-cli-packaging Specification

## Purpose
TBD - created by archiving change package-codebuddy-auto-cli. Update Purpose after archive.
## Requirements
### Requirement: Local CLI binary
The project SHALL expose a local `codebuddy-auto` CLI binary from the repository root after the TypeScript implementation is built and the root package is linked or installed from a packed tarball.

#### Scenario: Root binary metadata exists
- **WHEN** a user inspects the repository root package manifest
- **THEN** the manifest MUST define a `codebuddy-auto` binary pointing to the built TypeScript CLI entry

#### Scenario: Built binary is directly executable
- **WHEN** a user builds the project from the repository root
- **THEN** the built TypeScript CLI entry MUST contain a Node.js shebang

#### Scenario: Nested package binary remains available
- **WHEN** a user inspects the nested TypeScript package manifest
- **THEN** the manifest MUST continue to define a `codebuddy-auto` binary for direct TypeScript package development

### Requirement: Local package contents
The root package SHALL include the files needed for local operation when packed.

#### Scenario: Packed root package includes runtime build
- **WHEN** a user packs the repository root package
- **THEN** the package MUST include the built TypeScript server CLI and dashboard assets

#### Scenario: Packed root package includes operator assets
- **WHEN** a user packs the repository root package
- **THEN** the package MUST include workflow examples and CNB harness templates

#### Scenario: Packed root package excludes source tests
- **WHEN** a user packs the repository root package
- **THEN** the package MUST NOT include TypeScript source test files

### Requirement: Local installation documentation
The project SHALL document root-level local installation workflows that do not require an npm account.

#### Scenario: User reads local installation docs
- **WHEN** a user reads the installation documentation
- **THEN** the documentation MUST explain source build plus root-level `pnpm link --global`

#### Scenario: User reads tarball installation docs
- **WHEN** a user reads the installation documentation
- **THEN** the documentation MUST explain root-level `pnpm pack` followed by local global installation

