import type { SdkSessionStore } from '../runner/index.js';
import type { Issue, OrchestratorRuntimeState } from '../spec/index.js';
import type { WorkerHandleStore } from '../worker/index.js';

export interface ReleasedIssueRuntime {
  issueId: string;
  identifier: string;
  workspacePath: string;
  cleanupWorkspace: boolean;
}

export interface ReconcileRuntimeStateResult {
  releasedIssueIds: string[];
  releasedIssues: ReleasedIssueRuntime[];
  /**
   * Issue IDs whose live `IssueWorker` was asked to exit gracefully via
   * `WorkerHandleStore.requestGracefulExit`. The worker is responsible for
   * tearing down `state.running[issueId]` on its own; reconcile does not
   * delete the entry while a handle is alive.
   */
  gracefulExitRequestedIssueIds: string[];
}

function normalizeState(state: string): string {
  return state.toLowerCase();
}

export function reconcileRuntimeState(
  state: OrchestratorRuntimeState,
  trackerStates: Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>,
  terminalStates: string[],
  sessionStore?: SdkSessionStore,
  workerHandleStore?: WorkerHandleStore,
  finishLabel?: string,
): ReconcileRuntimeStateResult {
  const terminalStateSet = new Set(terminalStates.map(normalizeState));
  const normalizedFinishLabel = finishLabel?.toLowerCase();
  const releasedIssueIds: string[] = [];
  const releasedIssues: ReleasedIssueRuntime[] = [];
  const gracefulExitRequestedIssueIds: string[] = [];

  for (const [issueId, runningEntry] of Object.entries(state.running)) {
    const trackerState = trackerStates.get(issueId);
    const cleanupWorkspace = trackerState !== undefined && terminalStateSet.has(normalizeState(trackerState.state));
    const hasFinishLabel = trackerState !== undefined
      && normalizedFinishLabel !== undefined
      && trackerState.labels.some((label) => label.toLowerCase() === normalizedFinishLabel);

    if (trackerState && !cleanupWorkspace && !hasFinishLabel) {
      continue;
    }

    // Local mode: a live worker is mid-flight. Cooperatively ask it to
    // exit at the next turn boundary (Symphony §7.1) rather than ripping
    // `state.running` out from under it. The worker's `finally` block
    // deletes `state.running[issueId]` and the handle.
    if (workerHandleStore?.get(issueId)) {
      workerHandleStore.requestGracefulExit(issueId);
      gracefulExitRequestedIssueIds.push(issueId);
      continue;
    }

    delete state.running[issueId];
    delete state.retryAttempts[issueId];
    state.claimed.delete(issueId);
    state.completed.add(issueId);
    // Drop the per-issue SDK session entry when the scheduler releases
    // the issue (terminal state or tracker no longer reports it).
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
    gracefulExitRequestedIssueIds,
  };
}
