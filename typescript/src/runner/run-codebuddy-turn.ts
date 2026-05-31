import type { EventBus } from '../logging/event-bus.js';
import type { ServiceConfig } from '../spec/index.js';
import type { CodebuddyCommand } from './build-codebuddy-command.js';

export type { CodebuddyRunnerEvent, RunCodebuddyTurnResult } from './run-codebuddy-turn-cli.js';
import { runCodebuddyTurn as runCodebuddyTurnCli, type RunCodebuddyTurnResult } from './run-codebuddy-turn-cli.js';
import { runCodebuddyTurnSdk } from './run-codebuddy-turn-sdk.js';
import type { CodebuddyRunnerEvent } from './run-codebuddy-turn-cli.js';
import type { Session } from '@tencent-ai/agent-sdk';

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
  /**
   * Live SDK session — REQUIRED when `config.worker.kind === 'local'`.
   * The caller (typically `runIssueWorker`) owns its lifecycle.
   *
   * If absent in local mode, this dispatcher errors out instead of
   * silently spawning a per-turn `query()` (the previous behaviour
   * which broke Symphony §10.3 long-lived-thread semantics).
   */
  session?: Session;
}

export async function runCodebuddyTurn(input: RunCodebuddyTurnInput): Promise<RunCodebuddyTurnResult> {
  if (input.config && input.config.worker.kind === 'local') {
    if (!input.session || !input.prompt) {
      throw new Error(
        "runCodebuddyTurn: SDK (worker.kind: 'local') path requires `session` and `prompt`. "
          + 'Use `runIssueWorker` for the local mode hot path; this dispatcher is reserved for SSH.',
      );
    }
    return runCodebuddyTurnSdk({
      session: input.session,
      prompt: input.prompt,
      config: input.config,
      onEvent: input.onEvent,
      eventBus: input.eventBus,
      issueId: input.issueId,
    });
  }

  // SSH worker (or no config provided): spawn a CodeBuddy CLI subprocess
  // per turn — the SSH path cannot host a long-lived session.
  return runCodebuddyTurnCli({
    command: input.command,
    readTimeoutMs: input.readTimeoutMs,
    turnTimeoutMs: input.turnTimeoutMs,
    stallTimeoutMs: input.stallTimeoutMs,
    onEvent: input.onEvent,
  });
}
