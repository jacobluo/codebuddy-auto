## MODIFIED Requirements

### Requirement: Per-turn tracker re-check before next send

After every successful `turn_completed`, the worker SHALL re-fetch the issue from the tracker before sending the next user message and SHALL break the turn loop without sending another message if any of the following holds:

- The issue is no longer in an active state (Symphony §7.1).
- The issue carries the `tracker.finishLabel` label.
- The current `turnCount` has reached `agent.maxTurns`.

Reaching `agent.maxTurns` MUST NOT be treated as successful workflow handoff and MUST NOT automatically apply `tracker.finishLabel`.

#### Scenario: Issue moved to terminal state mid-flight
- **WHEN** turn N completes successfully
- **AND** before sending turn N+1 the worker re-fetches the tracker and finds the issue is no longer active
- **THEN** the worker breaks the loop without sending turn N+1
- **AND** `session.close()` is called
- **AND** the `agent-finish` label is NOT applied

#### Scenario: Agent applied finish_label mid-flight
- **WHEN** turn N completes successfully
- **AND** the re-fetched issue contains the configured `tracker.finishLabel`
- **THEN** the worker breaks the loop without sending turn N+1
- **AND** the finish label is NOT re-applied
- **AND** the worker logs `issue_continuation_completed_finish_label`

#### Scenario: maxTurns reached
- **WHEN** turn N completes and `turnCount === agent.maxTurns`
- **THEN** the worker breaks the loop
- **AND** the finish label is NOT applied
- **AND** the worker emits or records `max_turns_reached` as a non-handoff stop condition

