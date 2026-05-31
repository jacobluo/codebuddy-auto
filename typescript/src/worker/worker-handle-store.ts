/**
 * WorkerHandleStore — runtime registry of live per-issue worker handles.
 *
 * Used only when `worker.kind === 'local'`. The store owns the mapping from
 * issue id → `WorkerHandle`; the worker async function reads
 * `gracefulExitRequested` at every turn boundary, and `reconcileRuntimeState`
 * sets the flag when the issue's tracker state goes terminal.
 *
 * `release()` is idempotent — calling it on an already-released issue returns
 * `false` rather than throwing, so reconcile sweeps and worker `finally`
 * blocks can both call it without coordination.
 *
 * `requestGracefulExit()` is also idempotent: flipping the flag a second time
 * is a no-op. The worker is the only reader; the only mutation is "false →
 * true".
 *
 * Backed by an in-memory Map. Not persisted across daemon restarts (Symphony
 * "scheduler state intentionally NOT persisted"; see design Non-Goal #1).
 */

import type { WorkerHandle } from '../spec/index.js';

export interface WorkerHandleStore {
  /** Register a fresh handle for an issue. Throws if one already exists. */
  register(issueId: string, handle: WorkerHandle): void;
  /** Look up a handle. Returns `undefined` if no live worker. */
  get(issueId: string): WorkerHandle | undefined;
  /** All currently live handles. Useful for diagnostics + shutdown sweep. */
  list(): WorkerHandle[];
  /**
   * Remove a handle. Returns `true` if a handle was removed, `false` if the
   * issue had no live worker. Safe to call multiple times.
   */
  release(issueId: string): boolean;
  /**
   * Cooperatively ask the worker for `issueId` to exit at its next turn
   * boundary. Returns `true` when a live handle was found and flagged,
   * `false` when no handle exists. Idempotent: re-asking is a no-op.
   */
  requestGracefulExit(issueId: string): boolean;
}

class InMemoryWorkerHandleStore implements WorkerHandleStore {
  private readonly handles = new Map<string, WorkerHandle>();

  register(issueId: string, handle: WorkerHandle): void {
    if (this.handles.has(issueId)) {
      throw new Error(
        `worker handle already exists for issue ${issueId}; call release() first`,
      );
    }
    this.handles.set(issueId, handle);
  }

  get(issueId: string): WorkerHandle | undefined {
    return this.handles.get(issueId);
  }

  list(): WorkerHandle[] {
    return Array.from(this.handles.values());
  }

  release(issueId: string): boolean {
    return this.handles.delete(issueId);
  }

  requestGracefulExit(issueId: string): boolean {
    const handle = this.handles.get(issueId);
    if (!handle) {
      return false;
    }
    handle.gracefulExitRequested = true;
    return true;
  }
}

export function createWorkerHandleStore(): WorkerHandleStore {
  return new InMemoryWorkerHandleStore();
}
