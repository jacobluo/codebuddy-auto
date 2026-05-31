import type { Logger } from 'pino';

import { createRuntimeSnapshot, type EventBus } from '../logging/index.js';
import { createSdkSessionStore, type SdkSessionStore } from '../runner/index.js';
import type { OrchestratorRuntimeState, ServiceConfig } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';
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
}

export type SchedulerTickContextProvider =
  () => SchedulerTickContext | Promise<SchedulerTickContext>;

export interface StartSchedulerDependencies {
  state?: OrchestratorRuntimeState;
  eventBus?: EventBus;
  sessionStore?: SdkSessionStore;
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
  // Per-process SDK session store. Lives for the life of the scheduler so
  // entries created in dispatch survive across continuation ticks.
  const sessionStore = dependencies.sessionStore ?? createSdkSessionStore();
  const runOnce = dependencies.runSchedulerOnce ?? runSchedulerOnce;
  const startupCleanup = dependencies.runStartupCleanup ?? runStartupCleanup;
  const buildSnapshot = dependencies.createRuntimeSnapshot ?? createRuntimeSnapshot;
  const getTickContext = dependencies.getTickContext ?? (() => ({ tracker, config }));

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
        const result = await runOnce(state, tickContext.tracker, tickContext.config, { eventBus, sessionStore }, logger);
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
      sessionStore.clear();
    },
  };
}
