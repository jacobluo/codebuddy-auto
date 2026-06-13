import type { Issue } from '../spec/index.js';
import type { ServiceConfig } from '../spec/service-config.js';
import type { OrchestratorRuntimeState } from '../spec/runtime-state.js';
import { selectDispatchCandidates } from './select-dispatch-candidates.js';

export interface DispatchPlan {
  dispatchableIssues: Issue[];
  availableSlots: number;
}

function normalizeState(state: string): string {
  return state.toLowerCase();
}

function buildRunningStateCounts(state: OrchestratorRuntimeState): Map<string, number> {
  const counts = new Map<string, number>();

  for (const runningEntry of Object.values(state.running)) {
    const stateKey = normalizeState(runningEntry.issue.state);
    counts.set(stateKey, (counts.get(stateKey) ?? 0) + 1);
  }

  return counts;
}

export function planDispatchCycle(
  state: OrchestratorRuntimeState,
  issues: Issue[],
  config: ServiceConfig,
): DispatchPlan {
  const runningCount = Object.keys(state.running).length;
  const availableSlots = Math.max(config.agent.maxConcurrentAgents - runningCount, 0);
  const runningStateCounts = buildRunningStateCounts(state);

  const dispatchableIssues = selectDispatchCandidates({
    issues,
    activeStates: config.tracker.activeStates,
    terminalStates: config.tracker.terminalStates,
    runningIssueIds: new Set(Object.keys(state.running)),
    runningStateCounts,
    claimedIssueIds: state.claimed,
    stuckIssueIds: new Set(Object.keys(state.stuck)),
    maxConcurrentAgents: config.agent.maxConcurrentAgents,
    maxConcurrentAgentsByState: config.agent.maxConcurrentAgentsByState,
    runningCount,
  });

  return {
    dispatchableIssues,
    availableSlots,
  };
}
