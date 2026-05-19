import type { ServiceConfig, OrchestratorRuntimeState } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';
import { reconcileRuntimeState } from './reconcile-runtime-state.js';
import { runDispatchCycle, type DispatchCycleResult } from './run-dispatch-cycle.js';

export interface SchedulerOnceDependencies {
  runDispatchCycle?: typeof runDispatchCycle;
}

export interface SchedulerOnceResult {
  releasedIssueIds: string[];
  dispatch: DispatchCycleResult;
}

export async function runSchedulerOnce(
  state: OrchestratorRuntimeState,
  tracker: Tracker,
  config: ServiceConfig,
  dependencies: SchedulerOnceDependencies = {},
): Promise<SchedulerOnceResult> {
  const issueIds = Object.keys(state.running);
  const trackerStates = issueIds.length > 0
    ? await tracker.fetchIssueStatesByIds(issueIds)
    : new Map();

  const reconciliation = reconcileRuntimeState(
    state,
    trackerStates,
    config.tracker.terminalStates,
  );

  const dispatchRunner = dependencies.runDispatchCycle ?? runDispatchCycle;
  const dispatch = await dispatchRunner(state, tracker, config);

  return {
    releasedIssueIds: reconciliation.releasedIssueIds,
    dispatch,
  };
}
