import type { Issue, OrchestratorRuntimeState } from '../spec/index.js';

export interface ReconcileRuntimeStateResult {
  releasedIssueIds: string[];
}

function normalizeState(state: string): string {
  return state.toLowerCase();
}

export function reconcileRuntimeState(
  state: OrchestratorRuntimeState,
  trackerStates: Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>,
  terminalStates: string[],
): ReconcileRuntimeStateResult {
  const terminalStateSet = new Set(terminalStates.map(normalizeState));
  const releasedIssueIds: string[] = [];

  for (const issueId of Object.keys(state.running)) {
    const trackerState = trackerStates.get(issueId);
    if (trackerState && !terminalStateSet.has(normalizeState(trackerState.state))) {
      continue;
    }

    delete state.running[issueId];
    state.claimed.delete(issueId);
    state.completed.add(issueId);
    releasedIssueIds.push(issueId);
  }

  return {
    releasedIssueIds,
  };
}
