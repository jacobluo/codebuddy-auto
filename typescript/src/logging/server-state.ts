import type { OrchestratorRuntimeState, ServiceConfig } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';

export interface ServerRefreshResult {
  requestedAt: string;
  queued: boolean;
}

export interface ServerStateController {
  getSnapshot(): string;
  getIssue(identifier: string): string | null;
  requestRefresh(): ServerRefreshResult;
  waitForNextRefresh(): Promise<void>;
}

export interface ServerStateSnapshot {
  state: OrchestratorRuntimeState;
  config: ServiceConfig;
  tracker: Tracker;
  getSnapshotJson(): string;
  getIssueJson(identifier: string): string | null;
}

export function createServerStateController(
  initial: ServerStateSnapshot,
): ServerStateController {
  let current = initial;
  let refreshRequestedAt: string | null = null;
  let pendingResolvers: Array<() => void> = [];

  return {
    getSnapshot(): string {
      return current.getSnapshotJson();
    },
    getIssue(identifier: string): string | null {
      return current.getIssueJson(identifier);
    },
    requestRefresh(): ServerRefreshResult {
      const requestedAt = new Date().toISOString();
      const queued = refreshRequestedAt === null;
      refreshRequestedAt = requestedAt;
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
      return {
        requestedAt,
        queued,
      };
    },
    async waitForNextRefresh(): Promise<void> {
      if (refreshRequestedAt !== null) {
        refreshRequestedAt = null;
        return;
      }

      await new Promise<void>((resolve) => {
        pendingResolvers.push(() => {
          refreshRequestedAt = null;
          resolve();
        });
      });
    },
  };
}
