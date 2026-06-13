## ADDED Requirements

### Requirement: Dashboard bootstrap includes stuck issue state

The dashboard bootstrap payload SHALL include progress-gate state in the runtime snapshot when issues are stuck or have recorded progress metadata.

#### Scenario: stuck issue visible in bootstrap snapshot
- **WHEN** the runtime has marked an issue stuck
- **THEN** `GET /api/v1/dashboard/bootstrap` includes that issue in the bootstrap snapshot's stuck/progress state
- **AND** the payload includes the issue identifier and stuck reason

#### Scenario: no stuck issues remains backward compatible
- **WHEN** no issue has progress-gate state
- **THEN** `GET /api/v1/dashboard/bootstrap` still returns successfully
- **AND** existing dashboard fields remain present

