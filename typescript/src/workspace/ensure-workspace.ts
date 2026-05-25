import fs from 'node:fs/promises';
import path from 'node:path';

import type { ServiceConfig } from '../spec/index.js';

import { getWorkspaceHookScript, runWorkspaceHook } from './run-workspace-hook.js';
import { assertWorkspacePathWithinRoot, resolveWorkspacePath, sanitizeWorkspaceKey } from './resolve-workspace-path.js';

export interface WorkspaceState {
  path: string;
  workspaceKey: string;
  createdNow: boolean;
}

export interface WorkspaceLifecycleConfig {
  hooks: ServiceConfig['hooks'];
  workspace?: ServiceConfig['workspace'];
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

async function runGitWorktreeCommand(
  sourceRoot: string,
  script: string,
  timeoutMs: number,
  errorMessage: string,
): Promise<void> {
  const hookResult = await runWorkspaceHook({
    script,
    workspacePath: sourceRoot,
    timeoutMs,
  });

  if (hookResult.timedOut || hookResult.exitCode !== 0) {
    throw new Error(errorMessage);
  }
}

async function ensureWorkspaceDirectory(workspacePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(workspacePath);
    if (!stat.isDirectory()) {
      throw new Error('workspace path exists but is not a directory');
    }
    return false;
  } catch (error) {
    if (getErrorCode(error) !== 'ENOENT') {
      throw error;
    }

    await fs.mkdir(workspacePath, { recursive: true });
    return true;
  }
}

async function ensureGitWorktree(
  sourceRoot: string,
  workspacePath: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const stat = await fs.stat(workspacePath);
    if (!stat.isDirectory()) {
      throw new Error('workspace path exists but is not a directory');
    }
    return false;
  } catch (error) {
    if (getErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(workspacePath), { recursive: true });
  await runGitWorktreeCommand(
    sourceRoot,
    'git worktree prune',
    timeoutMs,
    'git worktree prune failed',
  );
  await runGitWorktreeCommand(
    sourceRoot,
    `git worktree add --detach ${JSON.stringify(workspacePath)} HEAD`,
    timeoutMs,
    'git worktree initialization failed',
  );

  return true;
}

async function runAfterCreateHook(
  config: WorkspaceLifecycleConfig | undefined,
  workspacePath: string,
): Promise<void> {
  if (!config) {
    return;
  }

  const afterCreateScript = getWorkspaceHookScript(config as ServiceConfig, 'afterCreate');
  if (!afterCreateScript) {
    return;
  }

  const hookResult = await runWorkspaceHook({
    script: afterCreateScript,
    workspacePath,
    timeoutMs: config.hooks.timeoutMs,
  });

  if (hookResult.timedOut || hookResult.exitCode !== 0) {
    throw new Error('afterCreate hook failed for workspace creation');
  }
}

async function rollbackCreatedWorkspace(
  workspacePath: string,
  config: WorkspaceLifecycleConfig | undefined,
): Promise<void> {
  if ((config?.workspace?.mode ?? 'directory') === 'git-worktree') {
    const sourceRoot = path.resolve(config?.workspace?.sourceRoot ?? path.dirname(workspacePath));
    await runGitWorktreeCommand(
      sourceRoot,
      `git worktree remove --force ${JSON.stringify(workspacePath)}`,
      config?.hooks.timeoutMs ?? 60_000,
      'git worktree rollback failed',
    );
    return;
  }

  await fs.rm(workspacePath, { recursive: true, force: true });
}

export async function ensureWorkspace(
  workspaceRoot: string,
  issueIdentifier: string,
  config?: WorkspaceLifecycleConfig,
): Promise<WorkspaceState> {
  const workspacePath = resolveWorkspacePath(workspaceRoot, issueIdentifier);
  assertWorkspacePathWithinRoot(workspaceRoot, workspacePath);

  const createdNow = (config?.workspace?.mode ?? 'directory') === 'git-worktree'
    ? await ensureGitWorktree(
        path.resolve(config?.workspace?.sourceRoot ?? workspaceRoot),
        workspacePath,
        config?.hooks.timeoutMs ?? 60_000,
      )
    : await ensureWorkspaceDirectory(workspacePath);

  if (createdNow) {
    try {
      await runAfterCreateHook(config, workspacePath);
    } catch (error) {
      await rollbackCreatedWorkspace(workspacePath, config);
      throw error;
    }
  }

  return {
    path: workspacePath,
    workspaceKey: sanitizeWorkspaceKey(issueIdentifier),
    createdNow,
  };
}
