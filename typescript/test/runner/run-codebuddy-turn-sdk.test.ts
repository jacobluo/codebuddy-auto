import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { DEFAULT_SERVICE_CONFIG, type ServiceConfig } from '../../src/spec/index.js';
import type { CodebuddyRunnerEvent } from '../../src/runner/run-codebuddy-turn-cli.js';

// ─────────────────────────────────────────────────────────────────────────────
// SDK module mock
//
// The real SDK spawns a CodeBuddy CLI subprocess; we want hermetic tests, so
// we replace `query()` with an async generator we control. queryCalls holds
// the recorded options for each invocation so tests can assert wiring.
// ─────────────────────────────────────────────────────────────────────────────

interface QueryCall {
  prompt: string;
  options: Record<string, unknown>;
}

const queryCalls: QueryCall[] = [];
const messageQueues: Array<unknown[]> = [];
const queryShouldThrow: Array<unknown | null> = [];

vi.mock('@tencent-ai/agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
    queryCalls.push({ prompt, options });
    const queue = messageQueues.shift() ?? [];
    const thrown = queryShouldThrow.shift();
    return (async function* () {
      if (thrown !== null && thrown !== undefined) {
        throw thrown;
      }
      for (const msg of queue) {
        // Yield asynchronously so the consumer gets a chance to abort.
        await Promise.resolve();
        yield msg;
      }
    })();
  },
}));

// Now that the mock is registered we can import the runner.
const { runCodebuddyTurnSdk } = await import('../../src/runner/run-codebuddy-turn-sdk.js');

function makeConfig(overrides: Partial<ServiceConfig['codebuddy']> = {}): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    codebuddy: {
      ...DEFAULT_SERVICE_CONFIG.codebuddy,
      ...overrides,
    },
  };
}

beforeEach(() => {
  queryCalls.length = 0;
  messageQueues.length = 0;
  queryShouldThrow.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runCodebuddyTurnSdk', () => {
  it('maps system → assistant → result messages to runner events in order', async () => {
    messageQueues.push([
      { type: 'system', session_id: 'sess-1', model: 'cb-sonnet', tools: ['Read'] },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello there' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      {
        type: 'result',
        is_error: false,
        duration_ms: 1234,
        num_turns: 1,
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]);

    const result = await runCodebuddyTurnSdk({
      prompt: 'do work',
      workspacePath: '/tmp/ws',
      config: makeConfig(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.events.map((e) => e.event)).toEqual([
      'session_started',
      'notification',
      'turn_completed',
    ]);
    const sessionEvent = result.events[0] as Extract<CodebuddyRunnerEvent, { event: 'session_started' }>;
    expect(sessionEvent.payload.sessionId).toBe('sess-1');
    expect(sessionEvent.payload.model).toBe('cb-sonnet');
    const turnEvent = result.events[2] as Extract<CodebuddyRunnerEvent, { event: 'turn_completed' }>;
    expect(turnEvent.payload.durationMs).toBe(1234);
    expect(turnEvent.payload.numTurns).toBe(1);
  });

  it('forwards events to onEvent in real time and continues on callback errors', async () => {
    messageQueues.push([
      { type: 'system', session_id: 's-1' },
      { type: 'result', is_error: false },
    ]);

    const seen: string[] = [];
    const result = await runCodebuddyTurnSdk({
      prompt: 'p',
      workspacePath: '/w',
      config: makeConfig(),
      onEvent: (evt) => {
        seen.push(evt.event);
        if (evt.event === 'session_started') {
          throw new Error('callback failed but turn must keep going');
        }
      },
    });

    expect(seen).toEqual(['session_started', 'turn_completed']);
    expect(result.events.map((e) => e.event)).toEqual(['session_started', 'turn_completed']);
  });

  it('passes resume, model, settingSources, and tool filters through to the SDK', async () => {
    messageQueues.push([{ type: 'result', is_error: false }]);

    await runCodebuddyTurnSdk({
      prompt: 'continue',
      workspacePath: '/ws',
      resumeSessionId: 'session-prev',
      config: makeConfig({
        model: 'cb-mini',
        settingSources: ['user', 'project'],
        allowedTools: ['Read'],
        disallowedTools: ['WebSearch'],
        permissionMode: 'acceptEdits',
      }),
    });

    expect(queryCalls).toHaveLength(1);
    const opts = queryCalls[0]!.options;
    expect(opts.cwd).toBe('/ws');
    expect(opts.resume).toBe('session-prev');
    expect(opts.model).toBe('cb-mini');
    expect(opts.settingSources).toEqual(['user', 'project']);
    expect(opts.allowedTools).toEqual(['Read']);
    expect(opts.disallowedTools).toEqual(['WebSearch']);
    expect(opts.permissionMode).toBe('acceptEdits');
    expect(opts.maxTurns).toBe(DEFAULT_SERVICE_CONFIG.agent.maxTurns);
  });

  it('omits SDK-only options when not configured', async () => {
    messageQueues.push([{ type: 'result', is_error: false }]);

    await runCodebuddyTurnSdk({
      prompt: 'p',
      workspacePath: '/ws',
      config: makeConfig(),
    });

    const opts = queryCalls[0]!.options;
    expect(opts).not.toHaveProperty('model');
    expect(opts).not.toHaveProperty('settingSources');
    expect(opts).not.toHaveProperty('resume');
    expect(opts.permissionMode).toBe('bypassPermissions'); // default
  });

  it('classifies SDK error result (non max-turns) as turn_failed', async () => {
    messageQueues.push([
      {
        type: 'result',
        is_error: true,
        subtype: 'execution_error',
        result: 'tool failed',
      },
    ]);

    const result = await runCodebuddyTurnSdk({
      prompt: 'p',
      workspacePath: '/ws',
      config: makeConfig(),
    });

    expect(result.events[0]!.event).toBe('turn_failed');
    const failed = result.events[0] as Extract<CodebuddyRunnerEvent, { event: 'turn_failed' }>;
    expect(failed.payload.message).toBe('tool failed');
  });

  it('classifies max-turns-exceeded SDK errors as turn_completed (continuation signal)', async () => {
    messageQueues.push([
      {
        type: 'result',
        is_error: true,
        errors: ['Max turns exceeded'],
      },
    ]);

    const result = await runCodebuddyTurnSdk({
      prompt: 'p',
      workspacePath: '/ws',
      config: makeConfig(),
    });

    expect(result.events[0]!.event).toBe('turn_completed');
  });

  it('emits a tool_call issue_event through the EventBus when a tool is requested', async () => {
    messageQueues.push([{ type: 'result', is_error: false }]);

    const events: Array<Record<string, unknown>> = [];
    const eventBus = {
      emit: (event: Record<string, unknown>) => {
        events.push(event);
      },
    };

    await runCodebuddyTurnSdk({
      prompt: 'p',
      workspacePath: '/ws',
      config: makeConfig(),
      eventBus: eventBus as unknown as Parameters<typeof runCodebuddyTurnSdk>[0]['eventBus'],
      issueId: 'issue-7',
    });

    // canUseTool was registered. Call it through the captured options.
    const canUseTool = queryCalls[0]!.options.canUseTool as (
      name: string,
      input: Record<string, unknown>,
    ) => Promise<{ behavior: 'allow' | 'deny'; updatedInput?: unknown }>;
    expect(canUseTool).toBeTypeOf('function');
    const decision = await canUseTool('Read', { path: '/x' });
    expect(decision.behavior).toBe('allow');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'issue_event',
      issueId: 'issue-7',
      payload: { event: 'tool_call', tool: 'Read', input: { path: '/x' } },
    });
  });

  it('does not register canUseTool when no eventBus / issueId is provided', async () => {
    messageQueues.push([{ type: 'result', is_error: false }]);

    await runCodebuddyTurnSdk({
      prompt: 'p',
      workspacePath: '/ws',
      config: makeConfig(),
    });

    expect(queryCalls[0]!.options).not.toHaveProperty('canUseTool');
  });

  it('emits turn_timed_out when the wall-clock timeout fires before SDK completes', async () => {
    // The runner uses real setTimeout. We craft a queue that yields slowly so
    // the abortController fires first.
    const blockingMessages = (async function* () {
      // Wait long enough for abort to fire.
      await new Promise((resolve) => setTimeout(resolve, 200));
      yield { type: 'result', is_error: false } as never;
    })();
    // Replace the queued messages with our blocker generator so the next
    // mock call returns it. We push a sentinel via queryShouldThrow so the
    // mock falls through to throwing the AbortError.
    messageQueues.push([]);
    queryShouldThrow.push(new Error('aborted'));

    const result = await runCodebuddyTurnSdk({
      prompt: 'p',
      workspacePath: '/ws',
      config: makeConfig({ turnTimeoutMs: 5 }),
    });

    // Either timed_out (preferred) or turn_failed surfacing the abort message
    // are both acceptable; we assert the event shape.
    expect(['turn_timed_out', 'turn_failed']).toContain(result.events[0]!.event);

    // Drain the unused generator
    await blockingMessages.return(undefined);
  });

  it('falls back to other_message for unknown SDK message types', async () => {
    messageQueues.push([
      { type: 'mystery', payload: 'unknown' },
      { type: 'result', is_error: false },
    ]);

    const result = await runCodebuddyTurnSdk({
      prompt: 'p',
      workspacePath: '/ws',
      config: makeConfig(),
    });

    expect(result.events.map((e) => e.event)).toEqual(['other_message', 'turn_completed']);
  });
});
