import fs from 'node:fs/promises';

import { type ServiceConfig } from '../spec/index.js';
import { createTracker, type Tracker } from '../tracker/index.js';
import {
  createDisabledTranscriptStore,
  openSqliteTranscriptStore,
  type TranscriptStore,
} from '../transcript/index.js';
import { parseWorkflow, resolveWorkflowPath } from '../workflow/index.js';

import { loadServiceConfig } from './load-service-config.js';
import { validatePreflight } from './validate-preflight.js';

type Environment = NodeJS.ProcessEnv;

export interface WorkflowRuntimeSnapshot {
  workflowPath: string;
  promptTemplate: string;
  config: ServiceConfig;
  tracker: Tracker;
  transcriptStore: TranscriptStore;
}

export interface WorkflowRuntimeReloadResult {
  ok: boolean;
  errors: string[];
  workflowPath: string;
}

export interface WorkflowRuntimeSource {
  getCurrent(): WorkflowRuntimeSnapshot;
  reload(): Promise<WorkflowRuntimeReloadResult>;
  close(): void;
}

export interface CreateWorkflowRuntimeSourceDependencies {
  createTracker?: typeof createTracker;
  createDisabledTranscriptStore?: typeof createDisabledTranscriptStore;
  openSqliteTranscriptStore?: typeof openSqliteTranscriptStore;
}

async function loadSnapshot(
  workflowPath: string,
  env: Environment,
  createTrackerDependency: typeof createTracker,
  createDisabledTranscriptStoreDependency: typeof createDisabledTranscriptStore,
  openSqliteTranscriptStoreDependency: typeof openSqliteTranscriptStore,
): Promise<WorkflowRuntimeSnapshot> {
  const resolved = resolveWorkflowPath(workflowPath);
  const workflowSource = await fs.readFile(resolved.workflowPath, 'utf8');
  const workflow = parseWorkflow(workflowSource, resolved.workflowPath);
  const config = loadServiceConfig(workflowSource, workflow.workflowPath, env);
  const preflight = validatePreflight(config);

  if (!preflight.ok) {
    throw new Error(preflight.errors.join('; '));
  }

  return {
    workflowPath: workflow.workflowPath,
    promptTemplate: workflow.promptTemplate,
    config,
    tracker: createTrackerDependency(config),
    transcriptStore: config.transcript.enabled
      ? openSqliteTranscriptStoreDependency({ sqlitePath: config.transcript.sqlitePath })
      : createDisabledTranscriptStoreDependency(),
  };
}

export async function createWorkflowRuntimeSource(
  workflowPath: string,
  env: Environment = process.env,
  dependencies: CreateWorkflowRuntimeSourceDependencies = {},
): Promise<WorkflowRuntimeSource> {
  const createTrackerDependency = dependencies.createTracker ?? createTracker;
  const createDisabledTranscriptStoreDependency = dependencies.createDisabledTranscriptStore ?? createDisabledTranscriptStore;
  const openSqliteTranscriptStoreDependency = dependencies.openSqliteTranscriptStore ?? openSqliteTranscriptStore;
  let current = await loadSnapshot(
    workflowPath,
    env,
    createTrackerDependency,
    createDisabledTranscriptStoreDependency,
    openSqliteTranscriptStoreDependency,
  );

  return {
    getCurrent(): WorkflowRuntimeSnapshot {
      return current;
    },
    async reload(): Promise<WorkflowRuntimeReloadResult> {
      try {
        const next = await loadSnapshot(
          workflowPath,
          env,
          createTrackerDependency,
          createDisabledTranscriptStoreDependency,
          openSqliteTranscriptStoreDependency,
        );
        current.transcriptStore.close();
        current = next;
        return {
          ok: true,
          errors: [],
          workflowPath: current.workflowPath,
        };
      } catch (error) {
        return {
          ok: false,
          errors: [error instanceof Error ? error.message : String(error)],
          workflowPath: current.workflowPath,
        };
      }
    },
    close(): void {
      current.transcriptStore.close();
    },
  };
}
