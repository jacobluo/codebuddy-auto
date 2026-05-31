import { describe, expect, it } from 'vitest';

import { createWorkerHandleStore } from '../../src/worker/worker-handle-store.js';
import type { WorkerHandle } from '../../src/spec/index.js';

function makeHandle(issueId: string, overrides: Partial<WorkerHandle> = {}): WorkerHandle {
  return {
    issueId,
    sessionId: null,
    startedAt: '2026-05-31T00:00:00.000Z',
    turnCount: 0,
    gracefulExitRequested: false,
    ...overrides,
  };
}

describe('createWorkerHandleStore', () => {
  it('register + get round-trips a handle', () => {
    const store = createWorkerHandleStore();
    const handle = makeHandle('issue-1');

    store.register('issue-1', handle);

    expect(store.get('issue-1')).toBe(handle);
  });

  it('returns undefined for an unknown issue', () => {
    const store = createWorkerHandleStore();
    expect(store.get('missing')).toBeUndefined();
  });

  it('throws when registering a duplicate issue id', () => {
    const store = createWorkerHandleStore();
    store.register('issue-1', makeHandle('issue-1'));

    expect(() => store.register('issue-1', makeHandle('issue-1'))).toThrowError(
      /worker handle already exists/i,
    );
  });

  it('list() returns all live handles', () => {
    const store = createWorkerHandleStore();
    const a = makeHandle('a');
    const b = makeHandle('b');

    store.register('a', a);
    store.register('b', b);

    expect(store.list()).toEqual(expect.arrayContaining([a, b]));
    expect(store.list()).toHaveLength(2);
  });

  it('release removes a handle and is idempotent', () => {
    const store = createWorkerHandleStore();
    store.register('issue-1', makeHandle('issue-1'));

    expect(store.release('issue-1')).toBe(true);
    expect(store.get('issue-1')).toBeUndefined();

    // calling again on an already-released issue is a no-op (returns false)
    expect(store.release('issue-1')).toBe(false);
  });

  it('requestGracefulExit flips the flag on the live handle', () => {
    const store = createWorkerHandleStore();
    const handle = makeHandle('issue-1', { gracefulExitRequested: false });
    store.register('issue-1', handle);

    expect(store.requestGracefulExit('issue-1')).toBe(true);

    const stored = store.get('issue-1');
    expect(stored?.gracefulExitRequested).toBe(true);
  });

  it('requestGracefulExit returns false when no handle is registered', () => {
    const store = createWorkerHandleStore();
    expect(store.requestGracefulExit('absent')).toBe(false);
  });

  it('requestGracefulExit is idempotent', () => {
    const store = createWorkerHandleStore();
    store.register('issue-1', makeHandle('issue-1'));

    expect(store.requestGracefulExit('issue-1')).toBe(true);
    expect(store.requestGracefulExit('issue-1')).toBe(true);
    expect(store.get('issue-1')?.gracefulExitRequested).toBe(true);
  });
});
