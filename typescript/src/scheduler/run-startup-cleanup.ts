import type { ServiceConfig } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';
import { removeWorkspace } from '../workspace/index.js';

export interface StartupCleanupResult {
  cleanedWorkspaceIssueIds: string[];
}

export interface StartupCleanupDependencies {
  removeWorkspace?: typeof removeWorkspace;
}

export async function runStartupCleanup(
  tracker: Tracker,
  config: ServiceConfig,
  dependencies: StartupCleanupDependencies = {},
): Promise<StartupCleanupResult> {
  const removeWorkspaceDependency = dependencies.removeWorkspace ?? removeWorkspace;
  const terminalIssues = await tracker.fetchIssuesByStates(config.tracker.terminalStates);
  const cleanedWorkspaceIssueIds: string[] = [];

  for (const issue of terminalIssues) {
    const result = await removeWorkspaceDependency(config.workspace.root, issue.identifier, config);
    if (result.removed) {
      cleanedWorkspaceIssueIds.push(issue.id);
    }
  }

  return {
    cleanedWorkspaceIssueIds,
  };
}
