import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

export interface WorkflowDefinition {
  config: Record<string, unknown>;
  promptTemplate: string;
  workflowPath: string;
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

export async function loadWorkflow(workflowPath: string): Promise<WorkflowDefinition> {
  const resolvedPath = path.resolve(workflowPath);
  const workflowSource = await fs.readFile(resolvedPath, 'utf8');
  return parseWorkflow(workflowSource, resolvedPath);
}
