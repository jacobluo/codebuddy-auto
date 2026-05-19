import fs from 'node:fs/promises';

import { assertWorkspacePathWithinRoot, resolveWorkspacePath, sanitizeWorkspaceKey } from './resolve-workspace-path.js';

export interface WorkspaceState {
  path: string;
  workspaceKey: string;
  createdNow: boolean;
}

export async function ensureWorkspace(workspaceRoot: string, issueIdentifier: string): Promise<WorkspaceState> {
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
  }

  return {
    path: workspacePath,
    workspaceKey: sanitizeWorkspaceKey(issueIdentifier),
    createdNow,
  };
}
