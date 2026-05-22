import fs from 'node:fs/promises';

import { type ServiceConfig } from '../spec/index.js';
import { createTracker, type Tracker } from '../tracker/index.js';
import { parseWorkflow, resolveWorkflowPath } from '../workflow/index.js';

import { loadServiceConfig } from './load-service-config.js';
import { validatePreflight } from './validate-preflight.js';

type Environment = NodeJS.ProcessEnv;

export interface WorkflowRuntimeSnapshot {
  workflowPath: string;
  promptTemplate: string;
  config: ServiceConfig;
  tracker: Tracker;
}

export interface WorkflowRuntimeReloadResult {
  ok: boolean;
  errors: string[];
  workflowPath: string;
}

export interface WorkflowRuntimeSource {
  getCurrent(): WorkflowRuntimeSnapshot;
  reload(): Promise<WorkflowRuntimeReloadResult>;
}

export interface CreateWorkflowRuntimeSourceDependencies {
  createTracker?: typeof createTracker;
}

async function loadSnapshot(
  workflowPath: string,
  env: Environment,
  createTrackerDependency: typeof createTracker,
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
  };
}

export async function createWorkflowRuntimeSource(
  workflowPath: string,
  env: Environment = process.env,
  dependencies: CreateWorkflowRuntimeSourceDependencies = {},
): Promise<WorkflowRuntimeSource> {
  const createTrackerDependency = dependencies.createTracker ?? createTracker;
  let current = await loadSnapshot(workflowPath, env, createTrackerDependency);

  return {
    getCurrent(): WorkflowRuntimeSnapshot {
      return current;
    },
    async reload(): Promise<WorkflowRuntimeReloadResult> {
      try {
        current = await loadSnapshot(workflowPath, env, createTrackerDependency);
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
  };
}
