import type { RuntimeLogger, EventBus } from '../logging/index.js';
import type { SdkSessionStore } from '../runner/index.js';
import type { ServiceConfig, OrchestratorRuntimeState } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';
import { removeWorkspace } from '../workspace/index.js';
import type { WorkerHandleStore, CreateSessionOptions } from '../worker/index.js';
import { reconcileRuntimeState } from './reconcile-runtime-state.js';
import { runContinuationCycle } from './run-continuation-cycle.js';
import { runDispatchCycle, type DispatchCycleResult } from './run-dispatch-cycle.js';

export interface SchedulerOnceDependencies {
  runContinuationCycle?: typeof runContinuationCycle;
  runDispatchCycle?: typeof runDispatchCycle;
  removeWorkspace?: typeof removeWorkspace;
  eventBus?: EventBus;
  sessionStore?: SdkSessionStore;
  /**
   * Local-mode worker glue. When `worker.kind === 'local'`, `runDispatchCycle`
   * uses `handleStore` + `createSession` + (optional) `getConfig` to start
   * long-lived `runIssueWorker` promises instead of running the legacy
   * single-turn dispatch path. Continuation cycle is skipped in this mode
   * because the worker drives its own turn loop (Symphony §10.3).
   */
  workerHandleStore?: WorkerHandleStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSession?: (opts: CreateSessionOptions) => any;
  getConfig?: () => ServiceConfig;
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
        dependencies.sessionStore,
        dependencies.workerHandleStore,
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

  // Continuation cycle is only meaningful in SSH mode. Local mode drives
  // its turn loop inside the per-issue IssueWorker, which keeps the SDK
  // session alive across turns (Symphony §10.3).
  if (config.worker.kind === 'ssh') {
    const continuationRunner = dependencies.runContinuationCycle ?? runContinuationCycle;
    const continuation = await continuationRunner(state, config, logger, tracker, dependencies.eventBus, dependencies.sessionStore);
    continuedIssueIds = continuation.continuedIssueIds;
  }

  const dispatchRunner = dependencies.runDispatchCycle ?? runDispatchCycle;
  const localDeps = (config.worker.kind === 'local'
    && dependencies.workerHandleStore
    && dependencies.createSession)
    ? {
      handleStore: dependencies.workerHandleStore,
      createSession: dependencies.createSession,
      getConfig: dependencies.getConfig,
    }
    : undefined;
  const dispatch = await dispatchRunner(
    state,
    tracker,
    config,
    undefined,
    logger,
    dependencies.eventBus,
    dependencies.sessionStore,
    localDeps,
  );

  return {
    releasedIssueIds,
    continuedIssueIds,
    dispatch,
    reconciliationError,
    cleanedWorkspaceIssueIds,
  };
}
