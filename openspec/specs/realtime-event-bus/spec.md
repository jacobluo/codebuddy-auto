# realtime-event-bus Specification

## Purpose

Defines the in-process event bus used to distribute scheduler, issue, and runtime snapshot events to dashboard and status consumers.

## Requirements

### Requirement: EventBus emit

EventBus SHALL accept realtime events and distribute them to all registered subscribers.

#### Scenario: emit an event to all subscribers
- **WHEN** `eventBus.emit(event)` is called with a valid `DashboardEvent`
- **THEN** all active subscribers receive the event synchronously

#### Scenario: emit does not throw when subscriber callback fails
- **WHEN** a subscriber callback throws an error during emit
- **THEN** the error is silently caught and remaining subscribers still receive the event

### Requirement: EventBus subscribe / unsubscribe

Consumers SHALL be able to register and deregister listeners.

#### Scenario: subscribe returns an unsubscribe function
- **WHEN** `eventBus.subscribe(listener)` is called
- **THEN** it returns a function that, when called, removes the listener from future emits

#### Scenario: unsubscribed listener no longer receives events
- **WHEN** the unsubscribe function is called
- **THEN** subsequent `emit()` calls do not invoke that listener

### Requirement: EventBus history

EventBus SHALL maintain a bounded in-memory history for reconnection replay.

#### Scenario: per-issue history capped at 200 events
- **WHEN** more than 200 events with the same `issueId` are emitted
- **THEN** `history(issueId)` returns only the most recent 200

#### Scenario: global history capped at 1000 events
- **WHEN** more than 1000 total events are emitted
- **THEN** `history()` (without issueId) returns only the most recent 1000

#### Scenario: history filtered by issueId
- **WHEN** `history(issueId)` is called
- **THEN** only events with matching `issueId` are returned

### Requirement: DashboardEvent schema

All events flowing through the bus MUST conform to a stable schema.

#### Scenario: valid event structure
- **WHEN** an event is emitted
- **THEN** it has `id` (monotonic number), `type` (enum), `timestamp` (ISO string), optional `issueId`, and `payload`

#### Scenario: event types
- **WHEN** an event is created
- **THEN** `type` is one of: `issue_event`, `scheduler_event`, `state_snapshot`
