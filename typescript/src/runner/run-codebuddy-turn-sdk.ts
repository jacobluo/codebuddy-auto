import { query, type Message } from '@tencent-ai/agent-sdk';

import type { EventBus } from '../logging/event-bus.js';
import type { ServiceConfig } from '../spec/index.js';
import type { CodebuddyRunnerEvent, RunCodebuddyTurnResult } from './run-codebuddy-turn-cli.js';

export interface RunSdkTurnInput {
  prompt: string;
  workspacePath: string;
  config: ServiceConfig;
  resumeSessionId?: string;
  onEvent?: (event: CodebuddyRunnerEvent) => void;
  eventBus?: EventBus;
  issueId?: string;
}

function mapSdkMessage(msg: Message): CodebuddyRunnerEvent | null {
  const raw = msg as unknown as Record<string, unknown>;

  if (msg.type === 'system') {
    return {
      event: 'session_started',
      payload: {
        sessionId: typeof raw['session_id'] === 'string' ? raw['session_id'] : undefined,
        model: typeof raw['model'] === 'string' ? raw['model'] : undefined,
        permissionMode: typeof raw['permissionMode'] === 'string' ? raw['permissionMode'] : undefined,
        tools: Array.isArray(raw['tools']) ? raw['tools'] as string[] : undefined,
      },
    };
  }

  if (msg.type === 'assistant') {
    const message = raw['message'] as Record<string, unknown> | undefined;
    const content = message?.['content'];
    const usage = message?.['usage'] as Record<string, number> | undefined;

    let text: string | undefined;
    if (Array.isArray(content)) {
      const texts = content
        .filter((b): b is { type: string; text: string } => typeof b === 'object' && b !== null && 'text' in b && typeof (b as Record<string, unknown>)['text'] === 'string')
        .map((b) => (b as Record<string, unknown>)['text'] as string);
      text = texts.length > 0 ? texts.join('\n') : undefined;
    }

    // Parity with CLI runner: surface the per-turn credit cost from
    // `message.providerData.rawUsage.credit` so token-usage accounting picks
    // it up. Without this, SDK-mode runs lose credit tracking.
    let credit: number | undefined;
    const providerData = message?.['providerData'] as Record<string, unknown> | undefined;
    const rawUsage = providerData?.['rawUsage'] as Record<string, unknown> | undefined;
    const creditValue = rawUsage?.['credit'];
    if (typeof creditValue === 'number' && Number.isFinite(creditValue) && creditValue >= 0) {
      credit = creditValue;
    }

    return {
      event: 'notification',
      payload: {
        raw: raw,
        message: text,
        usage,
        credit,
      },
    };
  }

  if (msg.type === 'result') {
    const isError = raw['is_error'] === true;
    const errors = Array.isArray(raw['errors']) ? raw['errors'] as string[] : undefined;
    const isMaxTurnsExceeded = errors?.some((e) => /max turns/i.test(String(e))) ?? false;

    if (isError && !isMaxTurnsExceeded) {
      return {
        event: 'turn_failed',
        payload: {
          message: typeof raw['result'] === 'string' ? raw['result'] : typeof raw['subtype'] === 'string' ? raw['subtype'] : undefined,
        },
      };
    }

    const rawUsage = raw['usage'];
    const usage = typeof rawUsage === 'object' && rawUsage !== null
      ? Object.fromEntries(
          Object.entries(rawUsage as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'),
        )
      : undefined;

    return {
      event: 'turn_completed',
      payload: {
        durationMs: typeof raw['duration_ms'] === 'number' ? raw['duration_ms'] : undefined,
        numTurns: typeof raw['num_turns'] === 'number' ? raw['num_turns'] : undefined,
        usage: usage && Object.keys(usage).length > 0 ? usage : undefined,
      },
    };
  }

  return {
    event: 'other_message',
    payload: { raw },
  };
}

export async function runCodebuddyTurnSdk(input: RunSdkTurnInput): Promise<RunCodebuddyTurnResult> {
  const events: CodebuddyRunnerEvent[] = [];

  const options: Record<string, unknown> = {
    cwd: input.workspacePath,
    maxTurns: input.config.agent.maxTurns,
    permissionMode: input.config.codebuddy.permissionMode ?? 'bypassPermissions',
  };

  if (input.config.codebuddy.model && input.config.codebuddy.model.length > 0) {
    options.model = input.config.codebuddy.model;
  }

  if (input.config.codebuddy.settingSources && input.config.codebuddy.settingSources.length > 0) {
    options.settingSources = input.config.codebuddy.settingSources;
  }

  if (input.resumeSessionId) {
    options.resume = input.resumeSessionId;
  }

  if (input.config.codebuddy.allowedTools && input.config.codebuddy.allowedTools.length > 0) {
    options.allowedTools = input.config.codebuddy.allowedTools;
  }

  if (input.config.codebuddy.disallowedTools && input.config.codebuddy.disallowedTools.length > 0) {
    options.disallowedTools = input.config.codebuddy.disallowedTools;
  }

  if (input.config.codebuddy.mcpConfig) {
    // MCP config handled at SDK level if needed
  }

  const canUseTool = input.eventBus && input.issueId
    ? (toolName: string, toolInput: Record<string, unknown>) => {
        if (input.eventBus) {
          input.eventBus.emit({
            type: 'issue_event',
            timestamp: new Date().toISOString(),
            issueId: input.issueId,
            payload: { event: 'tool_call', tool: toolName, input: toolInput },
          });
        }
        return Promise.resolve({
          behavior: 'allow' as const,
          updatedInput: toolInput,
        });
      }
    : undefined;

  if (canUseTool) {
    options.canUseTool = canUseTool;
  }

  // Wall-clock timeout
  const abortController = new AbortController();
  let timeoutHandle: NodeJS.Timeout | null = null;
  let timedOut = false;

  if (input.config.codebuddy.turnTimeoutMs) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, input.config.codebuddy.turnTimeoutMs);
  }

  options.abortController = abortController;

  try {
    const q = query({ prompt: input.prompt, options: options as Parameters<typeof query>[0]['options'] });

    for await (const msg of q) {
      const mapped = mapSdkMessage(msg);
      if (mapped) {
        events.push(mapped);
        if (input.onEvent) {
          try {
            input.onEvent(mapped);
          } catch {
            // onEvent failure must not abort the turn
          }
        }
      }
    }
  } catch (error) {
    if (timedOut) {
      return {
        events: [{ event: 'turn_timed_out', payload: { timeoutMs: input.config.codebuddy.turnTimeoutMs ?? 0 } }],
        exitCode: null,
        stderr: [],
      };
    }

    // Other abort/error
    const message = error instanceof Error ? error.message : String(error);
    events.push({
      event: 'turn_failed',
      payload: { message },
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  return {
    events,
    exitCode: 0,
    stderr: [],
  };
}
