import type { Issue, RunningEntry } from '../spec/index.js';
import { ensureWorkspace } from '../workspace/index.js';

export interface RunAttemptContext {
  issue: Issue;
  runningEntry: RunningEntry;
  workspacePath: string;
  workspaceCreatedNow: boolean;
}

export async function createRunAttempt(
  issue: Issue,
  workspaceRoot: string,
): Promise<RunAttemptContext> {
  const workspace = await ensureWorkspace(workspaceRoot, issue.identifier);
  const startedAt = new Date().toISOString();

  return {
    issue,
    workspacePath: workspace.path,
    workspaceCreatedNow: workspace.createdNow,
    runningEntry: {
      issue,
      sessionId: null,
      startedAt,
      turnCount: 0,
      lastEvent: null,
      lastEventAt: null,
    },
  };
}
