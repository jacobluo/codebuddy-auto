import { describe, expect, it } from 'vitest';

import { createSdkSessionStore } from '../../src/runner/session-store.js';

describe('SdkSessionStore', () => {
  it('creates an entry on first dispatch', () => {
    const store = createSdkSessionStore();
    const entry = store.create('issue-1', 'session-abc', 1_700_000_000_000);

    expect(entry).toEqual({
      issueId: 'issue-1',
      sessionId: 'session-abc',
      createdAtMs: 1_700_000_000_000,
      lastTurnAtMs: 1_700_000_000_000,
      turnCount: 1,
    });
    expect(store.size()).toBe(1);
    expect(store.get('issue-1')).toEqual(entry);
  });

  it('rejects duplicate create() for the same issue', () => {
    const store = createSdkSessionStore();
    store.create('issue-1', 'session-abc');
    expect(() => store.create('issue-1', 'session-xyz')).toThrowError(/already exists/);
  });

  it('updates session id, lastTurnAtMs, and turnCount on recordTurn', () => {
    const store = createSdkSessionStore();
    store.create('issue-1', 'session-1', 1_700_000_000_000);
    const updated = store.recordTurn('issue-1', 'session-2', 1_700_000_001_000);

    expect(updated.sessionId).toBe('session-2');
    expect(updated.lastTurnAtMs).toBe(1_700_000_001_000);
    expect(updated.createdAtMs).toBe(1_700_000_000_000);
    expect(updated.turnCount).toBe(2);
  });

  it('lazily creates an entry on recordTurn when none exists (defensive)', () => {
    const store = createSdkSessionStore();
    const entry = store.recordTurn('issue-2', 'session-late', 1_700_000_005_000);
    expect(entry).toEqual({
      issueId: 'issue-2',
      sessionId: 'session-late',
      createdAtMs: 1_700_000_005_000,
      lastTurnAtMs: 1_700_000_005_000,
      turnCount: 1,
    });
    expect(store.size()).toBe(1);
  });

  it('destroy returns true once and is idempotent afterward', () => {
    const store = createSdkSessionStore();
    store.create('issue-1', 'session-abc');
    expect(store.destroy('issue-1')).toBe(true);
    expect(store.destroy('issue-1')).toBe(false);
    expect(store.size()).toBe(0);
    expect(store.get('issue-1')).toBeUndefined();
  });

  it('list and clear surface all live entries', () => {
    const store = createSdkSessionStore();
    store.create('a', 'sa');
    store.create('b', 'sb');
    expect(store.list().map((e) => e.issueId).sort()).toEqual(['a', 'b']);
    expect(store.size()).toBe(2);
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.list()).toEqual([]);
  });
});
