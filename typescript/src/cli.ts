import { createInterface } from 'node:readline/promises';
import { z } from 'zod';

import { createWorkflowRuntimeSource, initRuntimeDirectory, type WorkflowRuntimeSource } from './config/index.js';
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
import type { OrchestratorRuntimeState, ServiceConfig } from './spec/index.js';

export interface RunCliDependencies {
  createWorkflowRuntimeSource?: typeof createWorkflowRuntimeSource;
  initRuntimeDirectory?: typeof initRuntimeDirectory;
  promptInitOptions?: (defaults: InitCliPromptDefaults) => Promise<Partial<InitCliPromptDefaults>>;
  startScheduler?: typeof startScheduler;
  startStatusServer?: typeof startStatusServer;
  waitForShutdownSignal?: () => Promise<void>;
}

interface InitCliPromptDefaults {
  project: string;
  repoUrl: string;
}

const initCliOptionsSchema = z.object({
  project: z.string().min(1).optional(),
  repoUrl: z.string().min(1).optional(),
  force: z.boolean(),
});

const runCliOptionsSchema = z.object({
  mode: z.enum(['run-once', 'check', 'daemon', 'status']),
  workflowPath: z.string().min(1),
  reload: z.boolean(),
  model: z.string().min(1).optional(),
});

type RunCliOptions = z.infer<typeof runCliOptionsSchema>;

const DEFAULT_INIT_PROJECT = 'your-org/your-repo';
const DEFAULT_WORKFLOW_PATH = 'WORKFLOW.md';
const LEGACY_MODE_FLAGS = new Set(['--check', '--daemon', '--status']);
const MODE_COMMANDS = new Set(['check', 'daemon', 'status']);

function defaultRepoUrlForProject(project: string): string {
  return `https://cnb.cool/${project}.git`;
}

function parseInitCliOptions(args: string[]): z.infer<typeof initCliOptionsSchema> {
  const options: {
    project?: string;
    repoUrl?: string;
    force: boolean;
  } = {
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--project') {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error('--project requires a value');
      }
      options.project = value;
      index += 1;
      continue;
    }
    if (arg === '--repo-url') {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error('--repo-url requires a value');
      }
      options.repoUrl = value;
      index += 1;
      continue;
    }

    throw new Error(`unknown init option: ${arg ?? ''}`);
  }

  return initCliOptionsSchema.parse(options);
}

function parseRunCliOptions(args: string[]): RunCliOptions {
  const firstArg = args[0];

  if (firstArg !== undefined && LEGACY_MODE_FLAGS.has(firstArg)) {
    throw new Error(`${firstArg} has been removed; use '${firstArg.slice(2)}' command instead`);
  }

  const mode = firstArg !== undefined && MODE_COMMANDS.has(firstArg)
    ? firstArg as 'check' | 'daemon' | 'status'
    : 'run-once';
  const remainingArgs = mode === 'run-once' ? args : args.slice(1);
  let workflowPath = DEFAULT_WORKFLOW_PATH;
  let reload = false;
  let model: string | undefined;
  let sawWorkflowPath = false;

  for (let index = 0; index < remainingArgs.length; index += 1) {
    const arg = remainingArgs[index];
    if (arg === undefined) {
      continue;
    }

    if (LEGACY_MODE_FLAGS.has(arg)) {
      throw new Error(`${arg} has been removed; use '${arg.slice(2)}' command instead`);
    }

    if (arg === '--reload') {
      reload = true;
      continue;
    }

    if (arg === '--model') {
      const value = remainingArgs[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--model requires a value');
      }
      model = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    }

    if (sawWorkflowPath) {
      throw new Error(`unexpected argument: ${arg}`);
    }

    workflowPath = arg;
    sawWorkflowPath = true;
  }

  if (mode === 'status' && reload) {
    throw new Error('--reload is not supported for status');
  }

  return runCliOptionsSchema.parse({
    mode,
    workflowPath,
    reload,
    model,
  });
}

function applyRunCliOverrides(config: ServiceConfig, options: RunCliOptions): ServiceConfig {
  if (!options.model) {
    return config;
  }

  return {
    ...config,
    codebuddy: {
      ...config.codebuddy,
      model: options.model,
    },
  };
}

async function promptInitOptions(defaults: InitCliPromptDefaults): Promise<InitCliPromptDefaults> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const projectAnswer = (await terminal.question(`CNB project slug (${defaults.project}): `)).trim();
    const project = projectAnswer.length > 0 ? projectAnswer : defaults.project;
    const repoUrlDefault = projectAnswer.length > 0 ? defaultRepoUrlForProject(project) : defaults.repoUrl;
    const repoUrlAnswer = (await terminal.question(`Repository clone URL (${repoUrlDefault}): `)).trim();

    return {
      project,
      repoUrl: repoUrlAnswer.length > 0 ? repoUrlAnswer : repoUrlDefault,
    };
  } finally {
    terminal.close();
  }
}

async function resolveInitOptions(
  parsed: z.infer<typeof initCliOptionsSchema>,
  dependencies: RunCliDependencies,
): Promise<z.infer<typeof initCliOptionsSchema> & InitCliPromptDefaults> {
  const projectDefault = parsed.project ?? DEFAULT_INIT_PROJECT;
  const defaults = {
    project: projectDefault,
    repoUrl: parsed.repoUrl ?? defaultRepoUrlForProject(projectDefault),
  };
  const needsPrompt = parsed.project === undefined || parsed.repoUrl === undefined;
  const canPrompt = dependencies.promptInitOptions !== undefined || (
    process.stdin.isTTY === true && process.stdout.isTTY === true
  );

  if (needsPrompt && canPrompt) {
    const answers = dependencies.promptInitOptions
      ? await dependencies.promptInitOptions(defaults)
      : await promptInitOptions(defaults);
    const promptedProject = answers.project ?? defaults.project;
    return {
      force: parsed.force,
      project: promptedProject,
      repoUrl: answers.repoUrl ?? (
        answers.project !== undefined && parsed.repoUrl === undefined
          ? defaultRepoUrlForProject(promptedProject)
          : defaults.repoUrl
      ),
    };
  }

  return {
    force: parsed.force,
    project: defaults.project,
    repoUrl: defaults.repoUrl,
  };
}

async function runInitCommand(
  argv: string[],
  dependencies: RunCliDependencies,
): Promise<number> {
  const logger = createLogger();

  try {
    const options = await resolveInitOptions(parseInitCliOptions(argv.slice(3)), dependencies);
    const result = await (dependencies.initRuntimeDirectory ?? initRuntimeDirectory)({
      cwd: process.cwd(),
      project: options.project,
      repoUrl: options.repoUrl,
      force: options.force,
    });
    process.stdout.write(`Initialized codebuddy-auto runtime in ${process.cwd()}\n`);
    process.stdout.write(`- ${result.workflowPath}\n`);
    process.stdout.write(`- ${result.workspaceRoot}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'init_failed');
    return 1;
  }
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
  if (argv[2] === 'init') {
    return runInitCommand(argv, dependencies);
  }
  const logger = createLogger();
  let runtimeSource: WorkflowRuntimeSource | null = null;

  try {
    const options = parseRunCliOptions(argv.slice(2));
    runtimeSource = await (dependencies.createWorkflowRuntimeSource ?? createWorkflowRuntimeSource)(options.workflowPath);

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
    const runtimeConfig = applyRunCliOverrides(runtime.config, options);

    if (options.mode === 'check') {
      logger.info({ workflowPath: runtime.workflowPath }, 'preflight_ok');
      return 0;
    }

    if (options.mode === 'status') {
      const snapshot = createRuntimeSnapshot(createRuntimeState());
      process.stdout.write(formatRuntimeStatus(snapshot));
      return 0;
    }

    if (options.mode === 'daemon') {
      const activeRuntimeSource = runtimeSource;
      const runtimeState = createRuntimeState();
      const eventBus = createEventBus({
        getDashboardEventStore: () => activeRuntimeSource.getCurrent().transcriptStore,
      });
      const schedulerDependencies = {
        state: runtimeState,
        eventBus,
        getTickContext: async () => {
          if (options.reload) {
            const reload = await activeRuntimeSource.reload();
            if (!reload.ok) {
              for (const error of reload.errors) {
                logger.error({ error, workflowPath: reload.workflowPath }, 'reload_failed');
              }
            }
          }

          const currentRuntime = activeRuntimeSource.getCurrent();
          return {
            tracker: currentRuntime.tracker,
            config: applyRunCliOverrides(currentRuntime.config, options),
            transcriptStore: currentRuntime.transcriptStore,
          };
        },
      };

      let stopRefreshLoop = false;
      let scheduler: ReturnType<typeof startScheduler> | null = null;
      let statusServer: StatusServerRuntime | null = null;
      let refreshLoop: Promise<void> | null = null;
      let statusController: ReturnType<typeof createServerStateController> | null = null;

      try {
        if (runtime.config.server.port !== undefined) {
          statusController = createServerStateController({
            state: runtimeState,
            config: runtimeConfig,
            tracker: runtime.tracker,
            getSnapshotJson: () => JSON.stringify(createRuntimeSnapshot(runtimeState)),
            getIssueJson: (identifier) => getIssueStatusJson(runtimeState, identifier),
          });
          statusServer = await (dependencies.startStatusServer ?? startStatusServer)(
            runtimeConfig,
            statusController,
            eventBus,
            runtime.transcriptStore,
          );
          logger.info(
            {
              workflowPath: runtime.workflowPath,
              address: statusServer.address(),
            },
            'status_server_started',
          );
        }

        scheduler = (dependencies.startScheduler ?? startScheduler)(
          runtime.tracker,
          runtimeConfig,
          logger,
          schedulerDependencies,
        );
        if (statusController) {
          refreshLoop = runStatusRefreshLoop(scheduler, statusController, () => stopRefreshLoop);
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
        if (scheduler) {
          await scheduler.stop();
          logger.info({ workflowPath: runtime.workflowPath }, 'scheduler_stopped');
        }
      }

      return 0;
    }

    const runtimeState = createRuntimeState();
    const dispatchPlan = await runDispatchCycle(
      runtimeState,
      runtime.tracker,
      runtimeConfig,
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
  } finally {
    runtimeSource?.close();
  }
}
