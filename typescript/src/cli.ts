import { Command } from 'commander';

import { createWorkflowRuntimeSource } from './config/index.js';
import { createLogger, createRuntimeSnapshot, formatRuntimeStatus } from './logging/index.js';
import { createRuntimeState, runDispatchCycle, startScheduler } from './scheduler/index.js';

export interface RunCliDependencies {
  createWorkflowRuntimeSource?: typeof createWorkflowRuntimeSource;
  startScheduler?: typeof startScheduler;
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
      const scheduler = (dependencies.startScheduler ?? startScheduler)(
        runtime.tracker,
        runtime.config,
        logger,
        {
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
      logger.info({ workflowPath: runtime.workflowPath }, 'scheduler_started');
      await (dependencies.waitForShutdownSignal ?? waitForShutdownSignal)();
      await scheduler.stop();
      logger.info({ workflowPath: runtime.workflowPath }, 'scheduler_stopped');
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
