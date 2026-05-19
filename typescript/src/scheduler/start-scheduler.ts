import type { Logger } from 'pino';

import { createRuntimeState } from './create-runtime-state.js';
import { runSchedulerOnce } from './run-scheduler-once.js';
import type { ServiceConfig } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';

export interface SchedulerRuntime {
  stop(): Promise<void>;
}

export interface StartSchedulerDependencies {
  runSchedulerOnce?: typeof runSchedulerOnce;
}

export function startScheduler(
  tracker: Tracker,
  config: ServiceConfig,
  logger: Pick<Logger, 'info' | 'error'>,
  dependencies: StartSchedulerDependencies = {},
): SchedulerRuntime {
  const state = createRuntimeState();
  const runOnce = dependencies.runSchedulerOnce ?? runSchedulerOnce;

  let stopped = false;
  let tickInFlight = false;
  let intervalHandle: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    if (stopped || tickInFlight) {
      return;
    }

    tickInFlight = true;

    try {
      const result = await runOnce(state, tracker, config);
      logger.info(
        {
          releasedIssueIds: result.releasedIssueIds,
          dispatchableCount: result.dispatch.dispatchableIssueIds.length,
          claimedCount: result.dispatch.claimedIssueIds.length,
        },
        'scheduler_tick_completed',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'scheduler_tick_failed');
    } finally {
      tickInFlight = false;
    }
  }

  void tick();
  intervalHandle = setInterval(() => {
    void tick();
  }, config.polling.intervalMs);

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },
  };
}
