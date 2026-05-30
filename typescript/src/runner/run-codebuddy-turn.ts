import type { EventBus } from '../logging/event-bus.js';
import type { ServiceConfig } from '../spec/index.js';
import type { CodebuddyCommand } from './build-codebuddy-command.js';

export type { CodebuddyRunnerEvent, RunCodebuddyTurnResult } from './run-codebuddy-turn-cli.js';
import { runCodebuddyTurn as runCodebuddyTurnCli, type RunCodebuddyTurnResult } from './run-codebuddy-turn-cli.js';
import { runCodebuddyTurnSdk } from './run-codebuddy-turn-sdk.js';
import type { CodebuddyRunnerEvent } from './run-codebuddy-turn-cli.js';

export interface RunCodebuddyTurnInput {
  command: CodebuddyCommand;
  prompt?: string;
  workspacePath?: string;
  config?: ServiceConfig;
  resumeSessionId?: string;
  readTimeoutMs?: number;
  turnTimeoutMs?: number;
  stallTimeoutMs?: number;
  onEvent?: (event: CodebuddyRunnerEvent) => void;
  eventBus?: EventBus;
  issueId?: string;
}

export async function runCodebuddyTurn(input: RunCodebuddyTurnInput): Promise<RunCodebuddyTurnResult> {
  // If config is present and worker is local, use SDK
  if (input.config && input.config.worker.kind === 'local' && input.prompt && input.workspacePath) {
    return runCodebuddyTurnSdk({
      prompt: input.prompt,
      workspacePath: input.workspacePath,
      config: input.config,
      resumeSessionId: input.resumeSessionId,
      onEvent: input.onEvent,
      eventBus: input.eventBus,
      issueId: input.issueId,
    });
  }

  // Fallback to CLI subprocess (SSH worker or no config/prompt provided)
  return runCodebuddyTurnCli({
    command: input.command,
    readTimeoutMs: input.readTimeoutMs,
    turnTimeoutMs: input.turnTimeoutMs,
    stallTimeoutMs: input.stallTimeoutMs,
    onEvent: input.onEvent,
  });
}

