export { ensureWorkspace } from './ensure-workspace.js';
export { removeWorkspace } from './remove-workspace.js';
export { getWorkspaceHookScript, runWorkspaceHook } from './run-workspace-hook.js';
export {
  assertWorkspacePathWithinRoot,
  resolveWorkspacePath,
  sanitizeWorkspaceKey,
} from './resolve-workspace-path.js';
export type { WorkspaceLifecycleConfig, WorkspaceState } from './ensure-workspace.js';
export type { RemoveWorkspaceResult } from './remove-workspace.js';
