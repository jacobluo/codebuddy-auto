import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const initRuntimeDirectoryInputSchema = z.object({
  cwd: z.string().min(1),
  project: z.string().min(1).default('your-org/your-repo'),
  repoUrl: z.string().min(1).default('https://cnb.cool/your-org/your-repo.git'),
  force: z.boolean().default(false),
});

export interface InitRuntimeDirectoryInput {
  cwd: string;
  project?: string;
  repoUrl?: string;
  force?: boolean;
}

export interface InitRuntimeDirectoryResult {
  workflowPath: string;
  workspaceRoot: string;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const GENERIC_WORKFLOW_TEMPLATE = path.join('examples', 'workflows', 'cnb-generic.WORKFLOW.md');
const DEFAULT_PROJECT_PLACEHOLDER = 'your-org/your-repo';
const DEFAULT_REPO_URL_PLACEHOLDER = 'https://cnb.cool/your-org/your-repo.git';

function templatePathCandidates(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));

  return [
    path.resolve(moduleDir, '..', '..', GENERIC_WORKFLOW_TEMPLATE),
    path.resolve(moduleDir, '..', '..', '..', GENERIC_WORKFLOW_TEMPLATE),
    path.resolve(moduleDir, '..', '..', '..', '..', GENERIC_WORKFLOW_TEMPLATE),
  ];
}

async function readGenericWorkflowTemplate(): Promise<string> {
  for (const candidate of templatePathCandidates()) {
    if (await pathExists(candidate)) {
      return fs.readFile(candidate, 'utf8');
    }
  }

  throw new Error(`generic workflow template not found: ${GENERIC_WORKFLOW_TEMPLATE}`);
}

async function renderWorkflow(project: string, repoUrl: string): Promise<string> {
  const template = await readGenericWorkflowTemplate();

  return template
    .replaceAll(DEFAULT_REPO_URL_PLACEHOLDER, repoUrl)
    .replaceAll(DEFAULT_PROJECT_PLACEHOLDER, project);
}

export async function initRuntimeDirectory(input: InitRuntimeDirectoryInput): Promise<InitRuntimeDirectoryResult> {
  const parsed = initRuntimeDirectoryInputSchema.parse(input);
  const workflowPath = path.join(parsed.cwd, 'WORKFLOW.md');
  const workspaceRoot = path.join(parsed.cwd, '.codebuddy-auto', 'workspaces');

  if (!parsed.force && await pathExists(workflowPath)) {
    throw new Error('WORKFLOW.md already exists; rerun with --force to overwrite');
  }

  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(workflowPath, await renderWorkflow(parsed.project, parsed.repoUrl), 'utf8');

  return {
    workflowPath,
    workspaceRoot,
  };
}
