import { describe, expect, it } from 'vitest';

import { DEFAULT_SERVICE_CONFIG, type ServiceConfig } from '../../src/spec/index.js';
import type {
  TranscriptEvent,
  TranscriptEventInput,
  TranscriptSessionInput,
  TranscriptStore,
} from '../../src/transcript/index.js';
import type { CodebuddyRunnerEvent } from '../../src/runner/run-codebuddy-turn-cli.js';
import { runCodebuddyTurnSdk } from '../../src/runner/run-codebuddy-turn-sdk.js';
import {
  assistantText,
  assistantToolUse,
  createFakeSdk,
  resultError,
  resultSuccess,
  systemInit,
  type ScenarioPlan,
} from '../worker/fake-sdk.js';

function makeConfig(overrides: Partial<ServiceConfig['codebuddy']> = {}): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    codebuddy: { ...DEFAULT_SERVICE_CONFIG.codebuddy, ...overrides },
  };
}

async function runWithFake(plan: ScenarioPlan, prompt: string, config: ServiceConfig, abortController?: AbortController) {
  const fake = createFakeSdk(plan);
  const session = fake.createSession({ cwd: '/tmp/fake', abortController });
  await session.connect();
  const result = await runCodebuddyTurnSdk({
    session,
    prompt,
    config,
    abortController,
  });
  session.close();
  return result;
}

function createRecordingTranscriptStore(): {
  store: TranscriptStore;
  events: TranscriptEvent[];
} {
  const events: TranscriptEvent[] = [];
  return {
    events,
    store: {
      recordSession(_input: TranscriptSessionInput) {
        throw new Error('runCodebuddyTurnSdk should record against an existing transcript session');
      },
      recordEvent(input: TranscriptEventInput): TranscriptEvent {
        const event = {
          id: events.length + 1,
          sessionId: input.sessionId,
          issueId: input.issueId,
          turnIndex: input.turnIndex,
          sequence: input.sequence,
          role: input.role,
          eventType: input.eventType,
          text: input.text,
          payload: input.payload,
          createdAt: '2026-05-31T00:00:00.000Z',
        };
        events.push(event);
        return event;
      },
      listEvents(issueId: string): TranscriptEvent[] {
        return events.filter((event) => event.issueId === issueId);
      },
      recordDashboardEvent(input) {
        return input;
      },
      listDashboardEvents() {
        return [];
      },
      getLatestDashboardEventId() {
        return 0;
      },
      close() {
        return;
      },
    },
  };
}

describe('runCodebuddyTurnSdk', () => {
  it('maps system → assistant → result messages to runner events in order', async () => {
    const result = await runWithFake(
      {
        sessionId: 'sess-1',
        turns: [
          {
            messages: [
              systemInit('sess-1'),
              assistantText('sess-1', 'Hello there'),
              resultSuccess('sess-1', 1234),
            ],
          },
        ],
      },
      'do work',
      makeConfig(),
    );

    expect(result.exitCode).toBe(0);
    expect(result.events.map((e) => e.event)).toEqual(['session_started', 'notification', 'turn_completed']);
    const sessionEvent = result.events[0] as Extract<CodebuddyRunnerEvent, { event: 'session_started' }>;
    expect(sessionEvent.payload.sessionId).toBe('sess-1');
    const turnEvent = result.events[2] as Extract<CodebuddyRunnerEvent, { event: 'turn_completed' }>;
    expect(turnEvent.payload.durationMs).toBe(1234);
  });

  it('records prompts and raw SDK payloads when a transcript session is provided', async () => {
    const fake = createFakeSdk({
      sessionId: 'sess-1',
      turns: [
        {
          messages: [
            systemInit('sess-1'),
            assistantText('sess-1', 'Hello there'),
            resultSuccess('sess-1', 1234),
          ],
        },
      ],
    });
    const session = fake.createSession({ cwd: '/tmp' });
    await session.connect();
    const transcript = createRecordingTranscriptStore();

    const result = await runCodebuddyTurnSdk({
      session,
      prompt: 'do work',
      config: makeConfig(),
      issueId: 'issue-1',
      transcriptStore: transcript.store,
      transcriptSessionId: 10,
      turnIndex: 1,
    });

    expect(result.exitCode).toBe(0);
    expect(transcript.events.map((event) => [event.role, event.eventType, event.text])).toEqual([
      ['user', 'prompt', 'do work'],
      ['runtime', 'session_started', undefined],
      ['assistant', 'message', 'Hello there'],
      ['result', 'turn_completed', undefined],
    ]);
    expect(transcript.events[2]?.payload).toMatchObject({
      type: 'assistant',
    });
    session.close();
  });

  it('does not persist assistant messages that have no display text', async () => {
    const fake = createFakeSdk({
      sessionId: 'sess-empty',
      turns: [
        {
          messages: [
            systemInit('sess-empty'),
            assistantToolUse('sess-empty', 'Read', { file_path: 'README.md' }),
            assistantText('sess-empty', 'Visible answer'),
            resultSuccess('sess-empty', 100),
          ],
        },
      ],
    });
    const session = fake.createSession({ cwd: '/tmp' });
    await session.connect();
    const transcript = createRecordingTranscriptStore();

    await runCodebuddyTurnSdk({
      session,
      prompt: 'do work',
      config: makeConfig(),
      issueId: 'issue-1',
      transcriptStore: transcript.store,
      transcriptSessionId: 10,
      turnIndex: 1,
    });

    expect(transcript.events.filter((event) => event.role === 'assistant').map((event) => event.text)).toEqual([
      'Visible answer',
    ]);
    session.close();
  });

  it('forwards events to onEvent in real time and continues on callback errors', async () => {
    const fake = createFakeSdk({
      sessionId: 's-1',
      turns: [{ messages: [systemInit('s-1'), resultSuccess('s-1')] }],
    });
    const session = fake.createSession({ cwd: '/tmp' });
    await session.connect();

    const seen: string[] = [];
    const result = await runCodebuddyTurnSdk({
      session,
      prompt: 'p',
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

  it('classifies SDK error result (non max-turns) as turn_failed', async () => {
    const result = await runWithFake(
      {
        sessionId: 's-err',
        turns: [
          {
            messages: [
              resultError('s-err', { subtype: 'error_during_execution', errors: ['tool failed'] }),
            ],
          },
        ],
      },
      'p',
      makeConfig(),
    );

    expect(result.events[0]!.event).toBe('turn_failed');
  });

  it('classifies max-turns-exceeded SDK errors as turn_completed (continuation signal)', async () => {
    const result = await runWithFake(
      {
        sessionId: 's-mt',
        turns: [
          { messages: [resultError('s-mt', { subtype: 'error_max_turns', errors: ['Max turns exceeded'] })] },
        ],
      },
      'p',
      makeConfig(),
    );
    expect(result.events[0]!.event).toBe('turn_completed');
  });

  it('emits turn_timed_out when the wall-clock timeout fires before SDK completes', async () => {
    const ac = new AbortController();
    const result = await runWithFake(
      {
        sessionId: 's-hang',
        turns: [
          { messages: [systemInit('s-hang'), assistantText('s-hang', 'starting')], hangAfterMessages: true },
        ],
      },
      'p',
      makeConfig({ turnTimeoutMs: 10 }),
      ac,
    );

    expect(['turn_timed_out', 'turn_failed']).toContain(result.events[0]!.event);
  });

  it('falls back to other_message for unknown SDK message types', async () => {
    const result = await runWithFake(
      {
        sessionId: 's-mystery',
        turns: [
          {
            messages: [
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { type: 'mystery', payload: 'unknown' } as any,
              resultSuccess('s-mystery'),
            ],
          },
        ],
      },
      'p',
      makeConfig(),
    );
    expect(result.events.map((e) => e.event)).toEqual(['other_message', 'turn_completed']);
  });
});
