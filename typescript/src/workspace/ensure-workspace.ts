import fs from 'node:fs/promises';

import type { ServiceConfig } from '../spec/index.js';

import { getWorkspaceHookScript, runWorkspaceHook } from './run-workspace-hook.js';
import { assertWorkspacePathWithinRoot, resolveWorkspacePath, sanitizeWorkspaceKey } from './resolve-workspace-path.js';

export interface WorkspaceState {
  path: string;
  workspaceKey: string;
  createdNow: boolean;
}

export async function ensureWorkspace(
  workspaceRoot: string,
  issueIdentifier: string,
  config?: Pick<ServiceConfig, 'hooks'>,
): Promise<WorkspaceState> {
  const workspacePath = resolveWorkspacePath(workspaceRoot, issueIdentifier);
  assertWorkspacePathWithinRoot(workspaceRoot, workspacePath);

  let createdNow = false;

  try {
    const stat = await fs.stat(workspacePath);
    if (!stat.isDirectory()) {
      throw new Error('workspace path exists but is not a directory');
    }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== 'ENOENT') {
      throw error;
    }

    await fs.mkdir(workspacePath, { recursive: true });
    createdNow = true;

    const afterCreateScript = config ? getWorkspaceHookScript(config as ServiceConfig, 'afterCreate') : null;
    if (afterCreateScript && config) {
      const hookResult = await runWorkspaceHook({
        script: afterCreateScript,
        workspacePath,
        timeoutMs: config.hooks.timeoutMs,
      });

      if (hookResult.timedOut || hookResult.exitCode !== 0) {
        throw new Error('afterCreate hook failed for workspace creation');
      }
    }
  }

  return {
    path: workspacePath,
    workspaceKey: sanitizeWorkspaceKey(issueIdentifier),
    createdNow,
  };
}
