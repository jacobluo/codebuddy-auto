/**
 * FakeSdk — deterministic test harness for `runIssueWorker`.
 *
 * The worker only consumes a small subset of the SDK Message union:
 *   - system / subtype 'init'  (session_started)
 *   - assistant                (notification, optional tool_use blocks)
 *   - result                   (turn boundary; success vs error)
 *
 * The fake describes each turn as a `TurnPlan` and replays its `messages`
 * when the worker iterates `session.stream()`. A turn ends as soon as a
 * `result` message is yielded — that is the worker's documented turn
 * boundary detector.
 *
 * `streamErrorOnTurn` lets a scenario inject an `Error` thrown by the
 * generator at a specific turn (used by §3.5 "stream error mid-turn").
 *
 * `streamHangsOnTurn` lets a scenario hang the generator forever, used by
 * §3.6 "wall-clock turnTimeoutMs". The hang resolves on `controller.abort()`.
 *
 * The fake does NOT itself enforce maxTurns or apply finish_label; those are
 * worker-side responsibilities that we want to verify against deterministic
 * input.
 *
 * Usage:
 *   const fake = createFakeSdk({
 *     turns: [
 *       { messages: [systemInit('s1'), assistantText('hello'), resultSuccess()] },
 *       { messages: [assistantText('done'), resultSuccess()] },
 *     ],
 *   });
 *   const session = fake.createSession({ cwd: '/tmp' });
 *   await session.connect();
 *   await session.send('first user prompt');
 *   for await (const m of session.stream()) { ... }
 */

import type {
  AssistantMessage,
  ContentBlock,
  Message,
  ResultMessage,
  Session,
  SystemMessage,
  UserMessage,
} from '@tencent-ai/agent-sdk';

// `Usage` is not part of the SDK's public exports, but the runtime shape is
// observable via assistant/result messages. We use a structurally-typed stub
// so the fake stays decoupled from upstream SDK internals.
type FakeUsage = {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  service_tier: string | null;
  server_tool_use: { web_search_requests: number };
  cache_creation: unknown;
};

export interface TurnPlan {
  /** Messages to yield, in order, when the worker iterates `session.stream()` for this turn. */
  messages: Message[];
  /**
   * If set, throw this error from `session.stream()` AFTER yielding all
   * preceding messages. Used to test mid-turn stream failure.
   */
  errorAfterMessages?: Error;
  /**
   * If true, after yielding `messages` the generator hangs forever (until
   * abort). Used to test wall-clock timeout.
   */
  hangAfterMessages?: boolean;
}

export interface ScenarioPlan {
  turns: TurnPlan[];
  /** Optional override for the session id reported by `Session.sessionId`. */
  sessionId?: string;
  /** Optional connect() failure (used by §3.8 startup_failed). */
  connectError?: Error;
}

export interface FakeSdk {
  createSession(options: { cwd: string; abortController?: AbortController }): Session;
  /** All sessions ever created by this fake (for test-side assertions). */
  sessions: FakeSession[];
}

export interface FakeSession extends Session {
  /** Messages passed to `send()`, in call order. Useful for asserting prompt + continuation guidance. */
  readonly sentMessages: ReadonlyArray<string>;
  /** Number of completed turns (each `send` corresponds to one turn). */
  readonly turnCount: number;
  /** Whether `close()` has been invoked. */
  readonly closed: boolean;
  /** Whether `connect()` has been invoked. */
  readonly connected: boolean;
}

const DEFAULT_USAGE: FakeUsage = {
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
  service_tier: null,
  server_tool_use: { web_search_requests: 0 },
  cache_creation: null,
};

let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function systemInit(sessionId: string, overrides: Partial<SystemMessage> = {}): SystemMessage {
  return {
    type: 'system',
    subtype: 'init',
    uuid: uniqueId('msg'),
    session_id: sessionId,
    cwd: '/tmp/fake',
    tools: ['Bash', 'Read', 'Write', 'Edit'],
    mcp_servers: [],
    model: 'fake-model',
    ...overrides,
  } as SystemMessage;
}

export function assistantText(sessionId: string, text: string): AssistantMessage {
  const block: ContentBlock = { type: 'text', text } as ContentBlock;
  return {
    type: 'assistant',
    uuid: uniqueId('msg'),
    session_id: sessionId,
    message: {
      id: uniqueId('asst'),
      type: 'message',
      role: 'assistant',
      model: 'fake-model',
      content: [block],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: DEFAULT_USAGE as unknown as AssistantMessage['message']['usage'],
    },
    parent_tool_use_id: null,
  };
}

export function assistantToolUse(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
): AssistantMessage {
  const block: ContentBlock = {
    type: 'tool_use',
    id: uniqueId('toolu'),
    name: toolName,
    input,
  } as ContentBlock;
  return {
    type: 'assistant',
    uuid: uniqueId('msg'),
    session_id: sessionId,
    message: {
      id: uniqueId('asst'),
      type: 'message',
      role: 'assistant',
      model: 'fake-model',
      content: [block],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: DEFAULT_USAGE as unknown as AssistantMessage['message']['usage'],
    },
    parent_tool_use_id: null,
  };
}

export function resultSuccess(sessionId: string, durationMs = 100): ResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    uuid: uniqueId('msg'),
    session_id: sessionId,
    duration_ms: durationMs,
    duration_api_ms: durationMs,
    is_error: false,
    num_turns: 1,
    result: 'ok',
    total_cost_usd: 0,
    usage: DEFAULT_USAGE as unknown as ResultMessage['usage'],
    permission_denials: [],
  } as ResultMessage;
}

export function resultError(
  sessionId: string,
  options: {
    subtype?: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd';
    errors?: string[];
    durationMs?: number;
  } = {},
): ResultMessage {
  return {
    type: 'result',
    subtype: options.subtype ?? 'error_during_execution',
    uuid: uniqueId('msg'),
    session_id: sessionId,
    duration_ms: options.durationMs ?? 100,
    duration_api_ms: options.durationMs ?? 100,
    is_error: true,
    num_turns: 1,
    total_cost_usd: 0,
    usage: DEFAULT_USAGE as unknown as ResultMessage['usage'],
    permission_denials: [],
    errors: options.errors,
  } as ResultMessage;
}

class FakeSessionImpl implements FakeSession {
  readonly sessionId: string;
  readonly _sent: string[] = [];
  private _turnCount = 0;
  private _connected = false;
  private _closed = false;
  private readonly plan: ScenarioPlan;
  private abortController?: AbortController;

  constructor(plan: ScenarioPlan, abortController?: AbortController) {
    this.sessionId = plan.sessionId ?? uniqueId('session');
    this.plan = plan;
    this.abortController = abortController;
  }

  get sentMessages(): ReadonlyArray<string> {
    return this._sent;
  }
  get turnCount(): number {
    return this._turnCount;
  }
  get connected(): boolean {
    return this._connected;
  }
  get closed(): boolean {
    return this._closed;
  }

  async connect(): Promise<void> {
    if (this.plan.connectError) {
      throw this.plan.connectError;
    }
    this._connected = true;
  }

  async send(message: string | UserMessage): Promise<void> {
    if (typeof message === 'string') {
      this._sent.push(message);
      return;
    }
    const content = message.message.content;
    this._sent.push(typeof content === 'string' ? content : JSON.stringify(content));
  }

  async *stream(): AsyncGenerator<Message, void> {
    const turn = this.plan.turns[this._turnCount];
    if (!turn) {
      // No more pre-planned turns: yield a default success result. The fake
      // is intentionally generous here; the worker is the entity that must
      // refuse to start a turn beyond its budget, not the fake.
      this._turnCount += 1;
      yield resultSuccess(this.sessionId);
      return;
    }

    for (const m of turn.messages) {
      if (this.abortController?.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      // Bump turnCount BEFORE yielding the result message — both the real
      // worker and tests typically `break` once they see a `result`, so the
      // post-yield bump would never run.
      if (m.type === 'result') {
        this._turnCount += 1;
      }
      yield m;
    }

    if (turn.errorAfterMessages) {
      // The result-bump above may already have run (rare); for an error
      // BEFORE result the turn is conceptually incomplete, so do not bump.
      throw turn.errorAfterMessages;
    }

    if (turn.hangAfterMessages) {
      // Hang until aborted.
      await new Promise<void>((_resolve, reject) => {
        if (!this.abortController) {
          // Without an abort controller a hung turn is a test bug.
          throw new Error('hangAfterMessages requires an AbortController');
        }
        this.abortController.signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }
  }

  close(): void {
    this._closed = true;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  // Stub remaining Session methods. The worker does not call these; they
  // exist so the fake satisfies the structural Session interface. Return
  // `any` because the SDK declares concrete return types we don't want to
  // import (RawLanguageModel etc.); these stubs are never exercised.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  async setPermissionMode(): Promise<void> {}
  getPermissionMode(): any {
    return 'bypassPermissions';
  }
  getModel(): string | undefined {
    return undefined;
  }
  async setModel(): Promise<void> {}
  async setConfig(): Promise<void> {}
  async getAvailableModes(): Promise<any> {
    return [];
  }
  async getAvailableModels(): Promise<any> {
    return [];
  }
  async getAvailableModelsRaw(): Promise<any> {
    return [];
  }
  async getAvailableCommands(): Promise<any> {
    return [];
  }
  async subscribeToCommands(): Promise<void> {}
  unsubscribeFromCommands(): void {}
  async interrupt(): Promise<void> {
    this.abortController?.abort();
  }
  hasPendingHistory(): boolean {
    return false;
  }
  setHooks(): void {}
  setCanUseTool(): void {}
  getCanUseTool(): undefined {
    return undefined;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function createFakeSdk(plan: ScenarioPlan): FakeSdk {
  const sessions: FakeSession[] = [];
  return {
    sessions,
    createSession(options): Session {
      const session = new FakeSessionImpl(plan, options.abortController);
      sessions.push(session);
      return session as unknown as Session;
    },
  };
}
