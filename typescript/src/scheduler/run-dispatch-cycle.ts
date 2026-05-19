import type { ServiceConfig } from '../spec/index.js';
import type { Tracker } from '../tracker/index.js';
import type { OrchestratorRuntimeState } from '../spec/index.js';
import { buildCodebuddyCommand, createRunAttempt, runCodebuddyTurn } from '../runner/index.js';
import { planDispatchCycle } from './plan-dispatch-cycle.js';
import { renderPrompt } from '../workflow/index.js';

export interface DispatchCycleResult {
  availableSlots: number;
  dispatchableIssueIds: string[];
  claimedIssueIds: string[];
}

export async function runDispatchCycle(
  state: OrchestratorRuntimeState,
  tracker: Tracker,
  config: ServiceConfig,
  promptTemplate = 'You are working on {{ issue.identifier }}: {{ issue.title }}',
): Promise<DispatchCycleResult> {
  const issues = await tracker.fetchCandidateIssues();
  const dispatchPlan = planDispatchCycle(state, issues, config);

  for (const issue of dispatchPlan.dispatchableIssues) {
    const runAttempt = await createRunAttempt(issue, config.workspace.root);
    const sessionId = `${issue.id}-turn-1`;
    const prompt = renderPrompt(promptTemplate, {
      issue,
      attempt: {
        turnCount: 1,
      },
    });
    const command = buildCodebuddyCommand({
      config,
      prompt,
      sessionId,
      workspacePath: runAttempt.workspacePath,
    });
    const turnResult = await runCodebuddyTurn({
      command,
      turnTimeoutMs: config.codebuddy.turnTimeoutMs,
    });

    const lastEvent = turnResult.events.at(-1)?.event ?? null;

    if (lastEvent !== 'turn_completed') {
      state.retryAttempts[issue.id] = {
        issueId: issue.id,
        identifier: issue.identifier,
        attempt: 1,
        dueAtMs: 10_000,
        error: lastEvent,
      };
      continue;
    }

    state.completed.add(issue.id);
    delete state.retryAttempts[issue.id];

    state.running[issue.id] = {
      ...runAttempt.runningEntry,
      sessionId,
      turnCount: 1,
      lastEvent,
      lastEventAt: new Date().toISOString(),
    };
    state.claimed.add(issue.id);
  }

  return {
    availableSlots: dispatchPlan.availableSlots,
    dispatchableIssueIds: dispatchPlan.dispatchableIssues.map((issue) => issue.id),
    claimedIssueIds: Array.from(state.claimed),
  };
}
