import { TranscriptStoreUnavailableError, type TranscriptStore } from '../transcript/index.js';

export interface DashboardEvent {
  id: number;
  type: 'issue_event' | 'scheduler_event' | 'state_snapshot';
  timestamp: string;
  issueId?: string;
  payload: Record<string, unknown>;
}

export interface EventBus {
  emit(event: Omit<DashboardEvent, 'id'>): void;
  subscribe(listener: (event: DashboardEvent) => void): () => void;
  history(issueId?: string, limit?: number): DashboardEvent[];
}

const DEFAULT_GLOBAL_LIMIT = 1000;
const DEFAULT_ISSUE_LIMIT = 200;

export function createEventBus(options?: {
  globalLimit?: number;
  issueLimit?: number;
  getDashboardEventStore?: () => TranscriptStore | undefined;
}): EventBus {
  const globalLimit = options?.globalLimit ?? DEFAULT_GLOBAL_LIMIT;
  const issueLimit = options?.issueLimit ?? DEFAULT_ISSUE_LIMIT;
  const getDashboardEventStore = options?.getDashboardEventStore;

  let nextId = getInitialNextId(getDashboardEventStore);
  const globalHistory: DashboardEvent[] = [];
  const issueHistories = new Map<string, DashboardEvent[]>();
  const listeners = new Set<(event: DashboardEvent) => void>();

  function trimArray(arr: DashboardEvent[], limit: number): void {
    if (arr.length > limit) {
      arr.splice(0, arr.length - limit);
    }
  }

  function getPersistentHistory(issueId?: string, limit?: number): DashboardEvent[] | null {
    const store = getDashboardEventStore?.();
    if (!store) {
      return null;
    }

    try {
      const effectiveLimit = limit ?? (issueId ? issueLimit : globalLimit);
      return store.listDashboardEvents({ issueId, limit: effectiveLimit });
    } catch (error) {
      if (error instanceof TranscriptStoreUnavailableError) {
        return null;
      }
      return null;
    }
  }

  function persistDashboardEvent(event: DashboardEvent): void {
    const store = getDashboardEventStore?.();
    if (!store) {
      return;
    }

    try {
      store.recordDashboardEvent(event);
    } catch {
      // Durable dashboard event logging is observability-only; live orchestration must continue.
    }
  }

  return {
    emit(partial: Omit<DashboardEvent, 'id'>): void {
      const event: DashboardEvent = { ...partial, id: nextId++ };

      globalHistory.push(event);
      trimArray(globalHistory, globalLimit);

      if (event.issueId) {
        let issueHistory = issueHistories.get(event.issueId);
        if (!issueHistory) {
          issueHistory = [];
          issueHistories.set(event.issueId, issueHistory);
        }
        issueHistory.push(event);
        trimArray(issueHistory, issueLimit);
      }

      persistDashboardEvent(event);

      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Subscriber failure must not affect other subscribers or the emitter
        }
      }
    },

    subscribe(listener: (event: DashboardEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    history(issueId?: string, limit?: number): DashboardEvent[] {
      const persistentHistory = getPersistentHistory(issueId, limit);
      if (persistentHistory) {
        return persistentHistory;
      }

      const source = issueId ? (issueHistories.get(issueId) ?? []) : globalHistory;
      if (limit !== undefined && limit < source.length) {
        return source.slice(-limit);
      }
      return [...source];
    },
  };
}

function getInitialNextId(getDashboardEventStore?: () => TranscriptStore | undefined): number {
  const store = getDashboardEventStore?.();
  if (!store) {
    return 1;
  }

  try {
    return store.getLatestDashboardEventId() + 1;
  } catch (error) {
    if (error instanceof TranscriptStoreUnavailableError) {
      return 1;
    }
    return 1;
  }
}
