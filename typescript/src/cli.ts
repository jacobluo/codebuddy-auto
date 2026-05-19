import fs from 'node:fs/promises';
import { Command } from 'commander';

import { loadServiceConfig, validatePreflight } from './config/index.js';
import { createLogger } from './logging/index.js';
import { createRuntimeState, runDispatchCycle, startScheduler } from './scheduler/index.js';
import { createTracker } from './tracker/index.js';
import { loadWorkflow } from './workflow/index.js';

export async function runCli(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name('agentfirst-f1')
    .argument('[workflowPath]', 'path to WORKFLOW.md', 'WORKFLOW.md')
    .option('--check', 'load workflow and config, then exit')
    .option('--daemon', 'start polling scheduler and return after bootstrap')
    .allowExcessArguments(false);

  program.parse(argv);

  const workflowPath = program.args[0] ?? 'WORKFLOW.md';
  const options = program.opts<{ check?: boolean; daemon?: boolean }>();
  const logger = createLogger();

  try {
    const workflow = await loadWorkflow(workflowPath);
    const workflowSource = await fs.readFile(workflow.workflowPath, 'utf8');
    const config = loadServiceConfig(workflowSource, workflow.workflowPath);
    const preflight = validatePreflight(config);

    if (!preflight.ok) {
      for (const error of preflight.errors) {
        logger.error({ error }, 'preflight_failed');
      }
      return 1;
    }

    if (options.check) {
      logger.info({ workflowPath: workflow.workflowPath }, 'preflight_ok');
      return 0;
    }

    const tracker = createTracker(config);

    if (options.daemon) {
      startScheduler(tracker, config, logger);
      logger.info({ workflowPath: workflow.workflowPath }, 'scheduler_started');
      return 0;
    }

    const runtimeState = createRuntimeState();
    const dispatchPlan = await runDispatchCycle(runtimeState, tracker, config, workflow.promptTemplate);

    logger.info(
      {
        workflowPath: workflow.workflowPath,
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
