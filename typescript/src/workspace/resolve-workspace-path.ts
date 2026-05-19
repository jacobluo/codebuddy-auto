import path from 'node:path';

const INVALID_SEGMENT_PATTERN = /[^A-Za-z0-9._-]/g;

export function sanitizeWorkspaceKey(issueIdentifier: string): string {
  return issueIdentifier.replace(INVALID_SEGMENT_PATTERN, '_');
}

export function resolveWorkspacePath(workspaceRoot: string, issueIdentifier: string): string {
  const absoluteRoot = path.resolve(workspaceRoot);
  const workspaceKey = sanitizeWorkspaceKey(issueIdentifier);
  return path.join(absoluteRoot, workspaceKey);
}

export function assertWorkspacePathWithinRoot(workspaceRoot: string, workspacePath: string): void {
  const absoluteRoot = path.resolve(workspaceRoot);
  const absoluteWorkspacePath = path.resolve(workspacePath);
  const relativePath = path.relative(absoluteRoot, absoluteWorkspacePath);

  if (
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('workspace path escapes configured workspace root');
  }
}
