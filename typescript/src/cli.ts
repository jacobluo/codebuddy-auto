import { Command } from 'commander';

import { createWorkflowRuntimeSource } from './config/index.js';
import {
  createEventBus,
  createLogger,
  createRuntimeSnapshot,
  createServerStateController,
  formatRuntimeStatus,
  startStatusServer,
  type StatusServerRuntime,
} from './logging/index.js';
import { createRuntimeState, runDispatchCycle, startScheduler } from './scheduler/index.js';
import type { OrchestratorRuntimeState } from './spec/index.js';

export interface RunCliDependencies {
  createWorkflowRuntimeSource?: typeof createWorkflowRuntimeSource;
  startScheduler?: typeof startScheduler;
  startStatusServer?: typeof startStatusServer;
  waitForShutdownSignal?: () => Promise<void>;
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;

    const finish = (): void => {
      if (resolved) {
        return;
      }

      resolved = true;
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolve();
    };

    process.on('SIGINT', finish);
    process.on('SIGTERM', finish);
  });
}

function getIssueStatusJson(
  state: OrchestratorRuntimeState,
  identifier: string,
): string | null {
  for (const entry of Object.values(state.running)) {
    if (entry.issue.identifier === identifier || entry.issue.id === identifier) {
      return JSON.stringify({
        issueId: entry.issue.id,
        issueIdentifier: entry.issue.identifier,
        status: 'running',
        workspace: {
          path: entry.workspacePath,
        },
        sessionId: entry.sessionId,
        turnCount: entry.turnCount,
        lastEvent: entry.lastEvent,
        lastEventAt: entry.lastEventAt,
        secondsRunning: entry.secondsRunning,
        tokenUsage: entry.tokenUsage,
      });
    }
  }

  for (const entry of Object.values(state.retryAttempts)) {
    if (entry.identifier === identifier || entry.issueId === identifier) {
      return JSON.stringify({
        issueId: entry.issueId,
        issueIdentifier: entry.identifier,
        status: 'retrying',
        retry: {
          mode: entry.mode,
          attempt: entry.attempt,
          dueAtMs: entry.dueAtMs,
          error: entry.error,
        },
      });
    }
  }

  if (state.completed.has(identifier)) {
    return JSON.stringify({
      issueId: identifier,
      issueIdentifier: identifier,
      status: 'completed',
    });
  }

  return null;
}

async function runStatusRefreshLoop(
  scheduler: ReturnType<typeof startScheduler>,
  controller: ReturnType<typeof createServerStateController>,
  isStopping: () => boolean,
): Promise<void> {
  while (true) {
    await controller.waitForNextRefresh();
    if (isStopping()) {
      return;
    }
    await scheduler.requestTick();
  }
}

async function stopStatusServer(
  server: StatusServerRuntime | null,
  workflowPath: string,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  if (!server) {
    return;
  }

  await server.close();
  logger.info({ workflowPath }, 'status_server_stopped');
}

export async function runCli(argv: string[], dependencies: RunCliDependencies = {}): Promise<number> {
  const program = new Command();
  program
    .name('agentfirst-f1')
    .argument('[workflowPath]', 'path to WORKFLOW.md', 'WORKFLOW.md')
    .option('--check', 'load workflow and config, then exit')
    .option('--status', 'print a human-readable runtime status snapshot and exit')
    .option('--reload', 'reload workflow/config from disk before running the requested action')
    .option('--daemon', 'start polling scheduler and return after bootstrap')
    .allowExcessArguments(false);

  program.parse(argv);

  const workflowPath = program.args[0] ?? 'WORKFLOW.md';
  const options = program.opts<{ check?: boolean; status?: boolean; reload?: boolean; daemon?: boolean }>();
  const logger = createLogger();

  try {
    if (Number(options.check === true) + Number(options.status === true) + Number(options.daemon === true) > 1) {
      logger.error({ error: '--check, --status, and --daemon are mutually exclusive' }, 'startup_failed');
      return 1;
    }

    const runtimeSource = await (dependencies.createWorkflowRuntimeSource ?? createWorkflowRuntimeSource)(workflowPath);

    if (options.reload) {
      const reload = await runtimeSource.reload();
      if (!reload.ok) {
        for (const error of reload.errors) {
          logger.error({ error, workflowPath: reload.workflowPath }, 'reload_failed');
        }
        return 1;
      }

      logger.info({ workflowPath: reload.workflowPath }, 'reload_succeeded');
    }

    const runtime = runtimeSource.getCurrent();

    if (options.check) {
      logger.info({ workflowPath: runtime.workflowPath }, 'preflight_ok');
      return 0;
    }

    if (options.status) {
      const snapshot = createRuntimeSnapshot(createRuntimeState());
      process.stdout.write(formatRuntimeStatus(snapshot));
      return 0;
    }

    if (options.daemon) {
      const runtimeState = createRuntimeState();
      const eventBus = createEventBus();
      const scheduler = (dependencies.startScheduler ?? startScheduler)(
        runtime.tracker,
        runtime.config,
        logger,
        {
          state: runtimeState,
          eventBus,
          getTickContext: async () => {
            if (options.reload) {
              const reload = await runtimeSource.reload();
              if (!reload.ok) {
                for (const error of reload.errors) {
                  logger.error({ error, workflowPath: reload.workflowPath }, 'reload_failed');
                }
              }
            }

            const currentRuntime = runtimeSource.getCurrent();
            return {
              tracker: currentRuntime.tracker,
              config: currentRuntime.config,
            };
          },
        },
      );

      let stopRefreshLoop = false;
      let statusServer: StatusServerRuntime | null = null;
      let refreshLoop: Promise<void> | null = null;
      let statusController: ReturnType<typeof createServerStateController> | null = null;

      try {
        if (runtime.config.server.port !== undefined) {
          statusController = createServerStateController({
            state: runtimeState,
            config: runtime.config,
            tracker: runtime.tracker,
            getSnapshotJson: () => JSON.stringify(createRuntimeSnapshot(runtimeState)),
            getIssueJson: (identifier) => getIssueStatusJson(runtimeState, identifier),
          });
          statusServer = await (dependencies.startStatusServer ?? startStatusServer)(runtime.config, statusController, eventBus);
          refreshLoop = runStatusRefreshLoop(scheduler, statusController, () => stopRefreshLoop);
          logger.info(
            {
              workflowPath: runtime.workflowPath,
              address: statusServer.address(),
            },
            'status_server_started',
          );
        }

        logger.info({ workflowPath: runtime.workflowPath }, 'scheduler_started');
        await (dependencies.waitForShutdownSignal ?? waitForShutdownSignal)();
      } finally {
        stopRefreshLoop = true;
        if (statusController) {
          statusController.requestRefresh();
        }
        if (refreshLoop) {
          await refreshLoop;
        }
        await stopStatusServer(statusServer, runtime.workflowPath, logger);
        await scheduler.stop();
        logger.info({ workflowPath: runtime.workflowPath }, 'scheduler_stopped');
      }

      return 0;
    }

    const runtimeState = createRuntimeState();
    const dispatchPlan = await runDispatchCycle(
      runtimeState,
      runtime.tracker,
      runtime.config,
      runtime.promptTemplate,
    );

    logger.info(
      {
        workflowPath: runtime.workflowPath,
        availableSlots: dispatchPlan.availableSlots,
        dispatchableCount: dispatchPlan.dispatchableIssueIds.length,
      },
      'scheduler_initialized',
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'startup_failed');
    return 1;
  }
}
