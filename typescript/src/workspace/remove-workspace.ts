import fs from 'node:fs/promises';
import path from 'node:path';

import type { ServiceConfig } from '../spec/index.js';

import { getWorkspaceHookScript, runWorkspaceHook } from './run-workspace-hook.js';
import { assertWorkspacePathWithinRoot, resolveWorkspacePath } from './resolve-workspace-path.js';
import type { WorkspaceLifecycleConfig } from './ensure-workspace.js';

export interface RemoveWorkspaceResult {
  workspacePath: string;
  removed: boolean;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

async function removeGitWorktree(
  sourceRoot: string,
  workspacePath: string,
  timeoutMs: number,
): Promise<void> {
  const hookResult = await runWorkspaceHook({
    script: `git worktree remove --force ${JSON.stringify(workspacePath)}`,
    workspacePath: sourceRoot,
    timeoutMs,
  });

  if (hookResult.timedOut || hookResult.exitCode !== 0) {
    throw new Error('git worktree removal failed');
  }
}

export async function removeWorkspace(
  workspaceRoot: string,
  issueIdentifier: string,
  config?: WorkspaceLifecycleConfig,
): Promise<RemoveWorkspaceResult> {
  const workspacePath = resolveWorkspacePath(workspaceRoot, issueIdentifier);
  assertWorkspacePathWithinRoot(workspaceRoot, workspacePath);

  try {
    const stat = await fs.stat(workspacePath);
    if (!stat.isDirectory()) {
      throw new Error('workspace path exists but is not a directory');
    }
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return {
        workspacePath,
        removed: false,
      };
    }

    throw error;
  }

  const beforeRemoveScript = config ? getWorkspaceHookScript(config as ServiceConfig, 'beforeRemove') : null;
  if (beforeRemoveScript && config) {
    await runWorkspaceHook({
      script: beforeRemoveScript,
      workspacePath,
      timeoutMs: config.hooks.timeoutMs,
    });
  }

  if (config?.workspace?.mode === 'git-worktree') {
    await removeGitWorktree(
      path.resolve(config.workspace.sourceRoot),
      workspacePath,
      config.hooks.timeoutMs,
    );
  } else {
    await fs.rm(workspacePath, { recursive: true, force: true });
  }

  return {
    workspacePath,
    removed: true,
  };
}
