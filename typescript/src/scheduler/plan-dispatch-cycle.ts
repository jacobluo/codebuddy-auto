import type { Issue } from '../spec/index.js';
import type { ServiceConfig } from '../spec/service-config.js';
import type { OrchestratorRuntimeState } from '../spec/runtime-state.js';
import { selectDispatchCandidates } from './select-dispatch-candidates.js';

export interface DispatchPlan {
  dispatchableIssues: Issue[];
  availableSlots: number;
}

export function planDispatchCycle(
  state: OrchestratorRuntimeState,
  issues: Issue[],
  config: ServiceConfig,
): DispatchPlan {
  const availableSlots = Math.max(config.agent.maxConcurrentAgents - Object.keys(state.running).length, 0);

  const dispatchableIssues = selectDispatchCandidates({
    issues,
    activeStates: config.tracker.activeStates,
    terminalStates: config.tracker.terminalStates,
    runningIssueIds: new Set(Object.keys(state.running)),
    claimedIssueIds: state.claimed,
    maxConcurrentAgents: config.agent.maxConcurrentAgents,
    runningCount: Object.keys(state.running).length,
  });

  return {
    dispatchableIssues,
    availableSlots,
  };
}
