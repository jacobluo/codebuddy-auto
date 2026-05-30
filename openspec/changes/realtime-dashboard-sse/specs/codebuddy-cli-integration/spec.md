## MODIFIED Requirements

### Requirement: Runner supports streaming event callback

The `runCodebuddyTurn` function accepts an optional callback for real-time event emission.

#### Scenario: onEvent callback invoked per NDJSON line
- **WHEN** `runCodebuddyTurn` is called with `onEvent` callback
- **THEN** each parsed `CodebuddyRunnerEvent` is passed to `onEvent` synchronously as soon as it is parsed, before being accumulated in the batch result

#### Scenario: onEvent is optional and backward-compatible
- **WHEN** `runCodebuddyTurn` is called without `onEvent`
- **THEN** behavior is identical to before (events only available in the returned result)

#### Scenario: onEvent failure does not abort the turn
- **WHEN** `onEvent` callback throws an error
- **THEN** the error is silently caught and the runner continues processing stdout normally
