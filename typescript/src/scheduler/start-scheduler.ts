import type { Logger } from 'pino';

import { createRuntimeSnapshot, type EventBus } from '../logging/index.js';
import { createSdkSession } from '../runner/create-sdk-session.js';
import { createSdkSessionStore, type SdkSessionStore } from '../runner/index.js';
import type { OrchestratorRuntimeState, ServiceConfig } from '../spec/index.js';
import type { TranscriptStore } from '../transcript/index.js';
import type { Tracker } from '../tracker/index.js';
import {
  createWorkerHandleStore,
  type CreateSessionOptions,
  type WorkerHandleStore,
} from '../worker/index.js';
import { createRuntimeState } from './create-runtime-state.js';
import { runSchedulerOnce } from './run-scheduler-once.js';
import { runStartupCleanup } from './run-startup-cleanup.js';

export interface SchedulerRuntime {
  requestTick(): Promise<void>;
  stop(): Promise<void>;
}

export interface SchedulerTickContext {
  tracker: Tracker;
  config: ServiceConfig;
  transcriptStore?: TranscriptStore;
}

export type SchedulerTickContextProvider =
  () => SchedulerTickContext | Promise<SchedulerTickContext>;

export interface StartSchedulerDependencies {
  state?: OrchestratorRuntimeState;
  eventBus?: EventBus;
  /**
   * Per-process SDK session store, only used by the legacy SSH path.
   * Local mode owns its sessions inside `runIssueWorker` via `WorkerHandle`.
   */
  sessionStore?: SdkSessionStore;
  /**
   * Per-process worker handle store. Local mode uses this as the
   * cooperative graceful-exit channel between `reconcileRuntimeState`
   * and the live `IssueWorker`. SSH mode leaves it empty.
   */
  workerHandleStore?: WorkerHandleStore;
  /**
   * SDK session factory. Used by the local-mode dispatch path. Tests
   * inject FakeSdk-backed factories; production uses `createSdkSession`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSession?: (opts: CreateSessionOptions) => any;
  transcriptStore?: TranscriptStore;
  runSchedulerOnce?: typeof runSchedulerOnce;
  runStartupCleanup?: typeof runStartupCleanup;
  createRuntimeSnapshot?: typeof createRuntimeSnapshot;
  getTickContext?: SchedulerTickContextProvider;
}

export function startScheduler(
  tracker: Tracker,
  config: ServiceConfig,
  logger: Pick<Logger, 'info' | 'error' | 'warn'>,
  dependencies: StartSchedulerDependencies = {},
): SchedulerRuntime {
  const state = dependencies.state ?? createRuntimeState();
  const eventBus = dependencies.eventBus;
  // SSH path keeps the legacy session token store. Local path leaves
  // `sessionStore` undefined so reconcile / dispatch don't accidentally
  // mutate it.
  const sessionStore = config.worker.kind === 'ssh'
    ? (dependencies.sessionStore ?? createSdkSessionStore())
    : undefined;
  const workerHandleStore = config.worker.kind === 'local'
    ? (dependencies.workerHandleStore ?? createWorkerHandleStore())
    : undefined;
  const createSession = dependencies.createSession
    ?? (config.worker.kind === 'local' ? createSdkSession : undefined);
  const runOnce = dependencies.runSchedulerOnce ?? runSchedulerOnce;
  const startupCleanup = dependencies.runStartupCleanup ?? runStartupCleanup;
  const buildSnapshot = dependencies.createRuntimeSnapshot ?? createRuntimeSnapshot;
  const getTickContext: SchedulerTickContextProvider = dependencies.getTickContext ?? (() => ({ tracker, config }));

  let stopped = false;
  let tickInFlight = false;
  let intervalHandle: NodeJS.Timeout | null = null;
  let currentTickPromise: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (stopped || tickInFlight) {
      return;
    }

    tickInFlight = true;
    currentTickPromise = (async () => {
      try {
        const tickContext = await getTickContext();
        const result = await runOnce(state, tickContext.tracker, tickContext.config, {
          eventBus,
          sessionStore,
          workerHandleStore,
          createSession,
          transcriptStore: tickContext.transcriptStore ?? dependencies.transcriptStore,
          getConfig: () => tickContext.config,
        }, logger);
        const snapshot = buildSnapshot(state);
        snapshot.cleanedWorkspaceIssueIds = result.cleanedWorkspaceIssueIds;
        logger.info(
          {
            releasedIssueIds: result.releasedIssueIds,
            cleanedWorkspaceIssueIds: result.cleanedWorkspaceIssueIds,
            continuedIssueIds: result.continuedIssueIds,
            dispatchableCount: result.dispatch.dispatchableIssueIds.length,
            claimedCount: result.dispatch.claimedIssueIds.length,
            reconciliationError: result.reconciliationError,
            snapshot,
          },
          'scheduler_tick_completed',
        );
        if (eventBus) {
          eventBus.emit({
            type: 'state_snapshot',
            timestamp: new Date().toISOString(),
            payload: snapshot as unknown as Record<string, unknown>,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, 'scheduler_tick_failed');
      } finally {
        tickInFlight = false;
        currentTickPromise = null;
      }
    })();

    await currentTickPromise;
  }

  const startupPromise = (async () => {
    try {
      const tickContext = await getTickContext();
      const result = await startupCleanup(tickContext.tracker, tickContext.config);
      logger.info(
        {
          cleanedWorkspaceIssueIds: result.cleanedWorkspaceIssueIds,
          cleanupError: result.cleanupError,
        },
        'startup_cleanup_completed',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error: message }, 'startup_cleanup_failed');
    }

    if (!stopped) {
      void tick();
      intervalHandle = setInterval(() => {
        void tick();
      }, config.polling.intervalMs);
    }
  })();

  return {
    async requestTick(): Promise<void> {
      await startupPromise;
      await tick();
    },
    async stop(): Promise<void> {
      stopped = true;
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      await startupPromise;
      if (currentTickPromise) {
        await currentTickPromise;
      }
      // Drop any remaining SDK session entries on shutdown so test runs and
      // restarts don't leak entries to the next process.
      sessionStore?.clear();
    },
  };
}
