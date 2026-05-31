/**
 * runCodebuddyTurnSdk — drive ONE turn on a pre-existing CodeBuddy SDK
 * Session. Session lifecycle (createSession + connect + close) is owned
 * by the caller (typically `runIssueWorker`).
 *
 * This was previously a per-turn `query({resume})` wrapper, which spawned
 * a new CLI subprocess every turn and broke Symphony §10.3 long-lived
 * thread semantics. The session-backed shape keeps the SDK CLI subprocess
 * alive across turns; the worker calls this once per turn over a stable
 * `Session` instance.
 *
 * The function does NOT call `createSession`, `connect`, `close`, or
 * `query()`.
 */

import type { Message, Session } from '@tencent-ai/agent-sdk';

import type { EventBus } from '../logging/event-bus.js';
import type { ServiceConfig } from '../spec/index.js';
import type { CodebuddyRunnerEvent, RunCodebuddyTurnResult } from './run-codebuddy-turn-cli.js';

export interface RunSdkTurnInput {
  /** Live SDK session, owned by the caller. Caller MUST have called connect(). */
  session: Session;
  /** User message for this turn. */
  prompt: string;
  config: ServiceConfig;
  /**
   * Wall-clock turn timeout source. The function attaches a timer and
   * aborts this controller on `codebuddy.turnTimeoutMs`. Callers SHOULD
   * pass the same controller they handed to `createSession({abortController})`
   * so the SDK transport observes the abort.
   */
  abortController?: AbortController;
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
    const subtype = typeof raw['subtype'] === 'string' ? raw['subtype'] as string : undefined;
    const errors = Array.isArray(raw['errors']) ? raw['errors'] as string[] : undefined;
    const isMaxTurnsExceeded
      = subtype === 'error_max_turns'
        || (errors?.some((e) => /max turns/i.test(String(e))) ?? false);

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

  const abortController = input.abortController ?? new AbortController();
  let timeoutHandle: NodeJS.Timeout | null = null;
  let timedOut = false;

  if (input.config.codebuddy.turnTimeoutMs) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, input.config.codebuddy.turnTimeoutMs);
  }

  try {
    await input.session.send(input.prompt);
    for await (const msg of input.session.stream()) {
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
      // Turn boundary: stop draining stream as soon as we observe a result.
      if (msg.type === 'result') {
        break;
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
