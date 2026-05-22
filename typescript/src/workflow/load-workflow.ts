import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

export interface WorkflowDefinition {
  config: Record<string, unknown>;
  promptTemplate: string;
  workflowPath: string;
}

export interface WorkflowPathResolution {
  workflowPath: string;
  explicit: boolean;
}

const FRONT_MATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function ensureObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('workflow front matter must decode to an object');
  }
  return value as Record<string, unknown>;
}

export function parseWorkflow(workflowSource: string, workflowPath: string): WorkflowDefinition {
  const match = workflowSource.match(FRONT_MATTER_PATTERN);
  if (!match) {
    return {
      config: {},
      promptTemplate: workflowSource.trim(),
      workflowPath,
    };
  }

  const frontMatter = match[1];
  const body = match[2] ?? '';
  if (frontMatter === undefined) {
    throw new Error('workflow front matter could not be extracted');
  }

  const parsed = parse(frontMatter);
  const config = parsed == null ? {} : ensureObject(parsed);

  return {
    config,
    promptTemplate: body.trim(),
    workflowPath,
  };
}

export function resolveWorkflowPath(
  workflowPath = 'WORKFLOW.md',
  cwd = process.cwd(),
): WorkflowPathResolution {
  if (path.isAbsolute(workflowPath)) {
    return {
      workflowPath,
      explicit: true,
    };
  }

  const usesDefaultPath = workflowPath === 'WORKFLOW.md';

  return {
    workflowPath: path.resolve(cwd, workflowPath),
    explicit: !usesDefaultPath,
  };
}

export async function loadWorkflow(workflowPath: string): Promise<WorkflowDefinition> {
  const resolved = resolveWorkflowPath(workflowPath);
  const workflowSource = await fs.readFile(resolved.workflowPath, 'utf8');
  return parseWorkflow(workflowSource, resolved.workflowPath);
}
