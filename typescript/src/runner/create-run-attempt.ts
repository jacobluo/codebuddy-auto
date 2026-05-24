import type { Issue, RunningEntry } from '../spec/index.js';
import { ensureWorkspace, type WorkspaceLifecycleConfig } from '../workspace/index.js';
import { createEmptyTokenUsageUpdate } from './token-usage.js';

export interface RunAttemptContext {
  issue: Issue;
  runningEntry: RunningEntry;
  workspacePath: string;
  workspaceCreatedNow: boolean;
}

export async function createRunAttempt(
  issue: Issue,
  workspaceRoot: string,
  config?: WorkspaceLifecycleConfig,
): Promise<RunAttemptContext> {
  const workspace = await ensureWorkspace(workspaceRoot, issue.identifier, config);
  const startedAt = new Date().toISOString();

  return {
    issue,
    workspacePath: workspace.path,
    workspaceCreatedNow: workspace.createdNow,
    runningEntry: {
      issue,
      workspacePath: workspace.path,
      sessionId: null,
      startedAt,
      turnCount: 0,
      lastEvent: null,
      lastEventAt: null,
      secondsRunning: 0,
      tokenUsage: createEmptyTokenUsageUpdate().totals,
      lastReportedTotals: createEmptyTokenUsageUpdate().lastReportedTotals,
    },
  };
}
