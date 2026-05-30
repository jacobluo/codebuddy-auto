import { describe, expect, it, vi } from 'vitest';

import { createEventBus, type DashboardEvent } from '../../src/logging/event-bus.js';

describe('EventBus', () => {
  it('emits events to all subscribers', () => {
    const bus = createEventBus();
    const received: DashboardEvent[] = [];
    bus.subscribe((event) => received.push(event));

    bus.emit({ type: 'scheduler_event', timestamp: '2026-01-01T00:00:00Z', payload: { event: 'tick' } });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ id: 1, type: 'scheduler_event', payload: { event: 'tick' } });
  });

  it('assigns monotonically increasing ids', () => {
    const bus = createEventBus();
    const received: DashboardEvent[] = [];
    bus.subscribe((event) => received.push(event));

    bus.emit({ type: 'scheduler_event', timestamp: '2026-01-01T00:00:00Z', payload: {} });
    bus.emit({ type: 'scheduler_event', timestamp: '2026-01-01T00:00:01Z', payload: {} });
    bus.emit({ type: 'scheduler_event', timestamp: '2026-01-01T00:00:02Z', payload: {} });

    expect(received.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('unsubscribe prevents further delivery', () => {
    const bus = createEventBus();
    const received: DashboardEvent[] = [];
    const unsub = bus.subscribe((event) => received.push(event));

    bus.emit({ type: 'scheduler_event', timestamp: '2026-01-01T00:00:00Z', payload: {} });
    unsub();
    bus.emit({ type: 'scheduler_event', timestamp: '2026-01-01T00:00:01Z', payload: {} });

    expect(received).toHaveLength(1);
  });

  it('does not throw when a subscriber callback fails', () => {
    const bus = createEventBus();
    const good: DashboardEvent[] = [];
    bus.subscribe(() => { throw new Error('bad subscriber'); });
    bus.subscribe((event) => good.push(event));

    expect(() => {
      bus.emit({ type: 'scheduler_event', timestamp: '2026-01-01T00:00:00Z', payload: {} });
    }).not.toThrow();

    expect(good).toHaveLength(1);
  });

  it('returns global history up to the limit', () => {
    const bus = createEventBus({ globalLimit: 3 });

    for (let i = 0; i < 5; i++) {
      bus.emit({ type: 'scheduler_event', timestamp: `2026-01-01T00:00:0${i}Z`, payload: { i } });
    }

    const history = bus.history();
    expect(history).toHaveLength(3);
    expect(history[0]?.payload).toEqual({ i: 2 });
    expect(history[2]?.payload).toEqual({ i: 4 });
  });

  it('returns per-issue history filtered and capped', () => {
    const bus = createEventBus({ issueLimit: 2 });

    bus.emit({ type: 'issue_event', timestamp: '2026-01-01T00:00:00Z', issueId: 'A', payload: { n: 1 } });
    bus.emit({ type: 'issue_event', timestamp: '2026-01-01T00:00:01Z', issueId: 'B', payload: { n: 2 } });
    bus.emit({ type: 'issue_event', timestamp: '2026-01-01T00:00:02Z', issueId: 'A', payload: { n: 3 } });
    bus.emit({ type: 'issue_event', timestamp: '2026-01-01T00:00:03Z', issueId: 'A', payload: { n: 4 } });

    const historyA = bus.history('A');
    expect(historyA).toHaveLength(2);
    expect(historyA[0]?.payload).toEqual({ n: 3 });
    expect(historyA[1]?.payload).toEqual({ n: 4 });

    const historyB = bus.history('B');
    expect(historyB).toHaveLength(1);
  });

  it('returns empty array for unknown issueId', () => {
    const bus = createEventBus();
    expect(bus.history('nonexistent')).toEqual([]);
  });

  it('respects optional limit parameter in history', () => {
    const bus = createEventBus();
    for (let i = 0; i < 10; i++) {
      bus.emit({ type: 'scheduler_event', timestamp: '2026-01-01T00:00:00Z', payload: { i } });
    }

    const limited = bus.history(undefined, 3);
    expect(limited).toHaveLength(3);
    expect(limited[0]?.payload).toEqual({ i: 7 });
  });
});
