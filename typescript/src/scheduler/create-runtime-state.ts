import type { OrchestratorRuntimeState } from '../spec/index.js';

export function createRuntimeState(): OrchestratorRuntimeState {
  return {
    running: {},
    claimed: new Set(),
    retryAttempts: {},
    runners: {},
    completed: new Set(),
    progress: {},
    stuck: {},
  };
}
