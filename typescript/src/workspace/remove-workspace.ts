import fs from 'node:fs/promises';

import type { ServiceConfig } from '../spec/index.js';

import { getWorkspaceHookScript, runWorkspaceHook } from './run-workspace-hook.js';
import { assertWorkspacePathWithinRoot, resolveWorkspacePath } from './resolve-workspace-path.js';

export interface RemoveWorkspaceResult {
  workspacePath: string;
  removed: boolean;
}

export async function removeWorkspace(
  workspaceRoot: string,
  issueIdentifier: string,
  config?: Pick<ServiceConfig, 'hooks'>,
): Promise<RemoveWorkspaceResult> {
  const workspacePath = resolveWorkspacePath(workspaceRoot, issueIdentifier);
  assertWorkspacePathWithinRoot(workspaceRoot, workspacePath);

  try {
    const stat = await fs.stat(workspacePath);
    if (!stat.isDirectory()) {
      throw new Error('workspace path exists but is not a directory');
    }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT') {
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

  await fs.rm(workspacePath, { recursive: true, force: true });

  return {
    workspacePath,
    removed: true,
  };
}
