## ADDED Requirements

### Requirement: Fetch candidate issues by label and state

The system SHALL query cnb.cool for issues that are in configured active states AND carry the `agent-ready` label, returning a normalized list conforming to Symphony §4.1.1 Issue shape.

#### Scenario: Only labeled open issues are candidates

- **WHEN** the orchestrator calls `fetchCandidateIssues()`
- **THEN** the result contains only cnb issues where `state == open` AND labels include `agent-ready`
- **AND** each result has fields `id`, `identifier`, `title`, `description`, `state`, `priority`, `labels`, `created_at`, `updated_at`
- **AND** issues with the `skip-agent` label are excluded

#### Scenario: Fetch failure does not crash orchestrator

- **WHEN** the cnb API returns a network error or non-2xx status
- **THEN** `fetchCandidateIssues()` returns a typed error (category `cnb_api_request` or `cnb_api_status`)
- **AND** the orchestrator skips dispatch for this tick (Symphony §14.2) but reconciliation continues

### Requirement: Refresh issue states by id for reconciliation

The system SHALL fetch current states for a list of issue ids, so that Symphony §8.5 active-run reconciliation can detect terminal / inactive state transitions without polling the full candidate list.

#### Scenario: Batch state refresh

- **WHEN** the orchestrator calls `fetchIssueStatesByIds(['101', '102', '103'])`
- **THEN** the result is a map `id -> { state, labels }` covering all requested ids that still exist
- **AND** ids that no longer exist in cnb are omitted from the result (not returned with null)

#### Scenario: Empty input short-circuits

- **WHEN** `fetchIssueStatesByIds([])` is called
- **THEN** the result is an empty map
- **AND** no cnb API call is made

### Requirement: Blocker relationship via `blocked-by:#N` label convention

The system SHALL parse labels matching the pattern `blocked-by:#<number>` to populate the `Issue.blocked_by` field with normalized blocker references, so that Symphony §8.2 blocker gating ("Todo + non-terminal blocker = not eligible") is enforceable under cnb which lacks native issue dependencies.

#### Scenario: Issue with blocker label is gated

- **WHEN** issue `#101` has labels `['agent-ready', 'blocked-by:#102']`
- **AND** issue `#102` is in state `open` (non-terminal)
- **THEN** the normalized `Issue` for `#101` has `blocked_by = [{ id: '102', identifier: '#102', state: 'open' }]`
- **AND** the dispatch engine does NOT dispatch `#101` (Symphony §8.2 Todo blocker rule)

#### Scenario: Blocker resolved when referenced issue terminal

- **WHEN** issue `#101` has label `blocked-by:#102`
- **AND** issue `#102` is in state `closed` (terminal)
- **THEN** `blocked_by = [{ id: '102', identifier: '#102', state: 'closed' }]`
- **AND** the dispatch engine may dispatch `#101` (all blockers are terminal)
