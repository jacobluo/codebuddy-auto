import type { RuntimeLogger } from '../logging/index.js';
import type { ServiceConfig, OrchestratorRuntimeState } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';
import { removeWorkspace } from '../workspace/index.js';
import { reconcileRuntimeState } from './reconcile-runtime-state.js';
import { runContinuationCycle } from './run-continuation-cycle.js';
import { runDispatchCycle, type DispatchCycleResult } from './run-dispatch-cycle.js';

export interface SchedulerOnceDependencies {
  runContinuationCycle?: typeof runContinuationCycle;
  runDispatchCycle?: typeof runDispatchCycle;
  removeWorkspace?: typeof removeWorkspace;
}

export interface SchedulerOnceResult {
  releasedIssueIds: string[];
  continuedIssueIds: string[];
  dispatch: DispatchCycleResult;
  reconciliationError: string | null;
  cleanedWorkspaceIssueIds: string[];
}

export async function runSchedulerOnce(
  state: OrchestratorRuntimeState,
  tracker: Tracker,
  config: ServiceConfig,
  dependencies: SchedulerOnceDependencies = {},
  logger?: RuntimeLogger,
): Promise<SchedulerOnceResult> {
  const nowMs = Date.now();

  for (const [issueId, retryEntry] of Object.entries(state.retryAttempts)) {
    if (retryEntry.dueAtMs > nowMs || state.running[issueId]) {
      continue;
    }

    delete state.retryAttempts[issueId];
    state.claimed.delete(issueId);
  }

  const issueIds = Object.keys(state.running);
  const removeWorkspaceDependency = dependencies.removeWorkspace ?? removeWorkspace;
  let releasedIssueIds: string[] = [];
  let continuedIssueIds: string[] = [];
  let reconciliationError: string | null = null;
  let cleanedWorkspaceIssueIds: string[] = [];

  if (issueIds.length > 0) {
    try {
      const trackerStates = await tracker.fetchIssueStatesByIds(issueIds);
      const reconciliation = reconcileRuntimeState(
        state,
        trackerStates,
        config.tracker.terminalStates,
      );
      releasedIssueIds = reconciliation.releasedIssueIds;

      for (const issue of reconciliation.releasedIssues.filter((entry) => entry.cleanupWorkspace)) {
        try {
          const result = await removeWorkspaceDependency(config.workspace.root, issue.identifier, config);
          if (result.removed) {
            cleanedWorkspaceIssueIds.push(issue.issueId);
          }
        } catch (error) {
          if (reconciliationError === null) {
            reconciliationError = error instanceof Error ? error.message : String(error);
          }
        }
      }
    } catch (error) {
      reconciliationError = error instanceof Error ? error.message : String(error);
    }
  }

  const continuationRunner = dependencies.runContinuationCycle ?? runContinuationCycle;
  const continuation = await continuationRunner(state, config, logger, tracker);
  continuedIssueIds = continuation.continuedIssueIds;

  const dispatchRunner = dependencies.runDispatchCycle ?? runDispatchCycle;
  const dispatch = await dispatchRunner(state, tracker, config, undefined, logger);

  return {
    releasedIssueIds,
    continuedIssueIds,
    dispatch,
    reconciliationError,
    cleanedWorkspaceIssueIds,
  };
}
