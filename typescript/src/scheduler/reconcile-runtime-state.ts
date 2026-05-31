import type { SdkSessionStore } from '../runner/index.js';
import type { Issue, OrchestratorRuntimeState } from '../spec/index.js';

export interface ReleasedIssueRuntime {
  issueId: string;
  identifier: string;
  workspacePath: string;
  cleanupWorkspace: boolean;
}

export interface ReconcileRuntimeStateResult {
  releasedIssueIds: string[];
  releasedIssues: ReleasedIssueRuntime[];
}

function normalizeState(state: string): string {
  return state.toLowerCase();
}

export function reconcileRuntimeState(
  state: OrchestratorRuntimeState,
  trackerStates: Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>,
  terminalStates: string[],
  sessionStore?: SdkSessionStore,
): ReconcileRuntimeStateResult {
  const terminalStateSet = new Set(terminalStates.map(normalizeState));
  const releasedIssueIds: string[] = [];
  const releasedIssues: ReleasedIssueRuntime[] = [];

  for (const [issueId, runningEntry] of Object.entries(state.running)) {
    const trackerState = trackerStates.get(issueId);
    const cleanupWorkspace = trackerState !== undefined && terminalStateSet.has(normalizeState(trackerState.state));

    if (trackerState && !cleanupWorkspace) {
      continue;
    }

    delete state.running[issueId];
    delete state.retryAttempts[issueId];
    state.claimed.delete(issueId);
    state.completed.add(issueId);
    // Task 5.3: drop the per-issue SDK session entry when the scheduler
    // releases the issue (terminal state or tracker no longer reports it).
    sessionStore?.destroy(issueId);
    releasedIssueIds.push(issueId);
    releasedIssues.push({
      issueId,
      identifier: runningEntry.issue.identifier,
      workspacePath: runningEntry.workspacePath,
      cleanupWorkspace,
    });
  }

  return {
    releasedIssueIds,
    releasedIssues,
  };
}
