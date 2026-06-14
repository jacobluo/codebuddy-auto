import { spawn } from 'node:child_process';
import readline from 'node:readline';

import { z } from 'zod';

import type { TranscriptRole, TranscriptStore } from '../transcript/index.js';
import type { CodebuddyCommand } from './build-codebuddy-command.js';

const rawSystemInitEventSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  session_id: z.string().optional(),
  model: z.string().optional(),
  permissionMode: z.string().optional(),
  tools: z.array(z.string()).optional(),
}).passthrough();

const rawSystemEventSchema = z.object({
  type: z.literal('system'),
  subtype: z.string(),
}).passthrough();

const rawResultEventSchema = z.object({
  type: z.literal('result'),
  subtype: z.string().optional(),
  session_id: z.string().optional(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  num_turns: z.number().int().nonnegative().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  permission_denials: z.array(z.unknown()).optional(),
  errors: z.array(z.string()).optional(),
});

const rawAssistantEventSchema = z.object({
  type: z.literal('assistant'),
  message: z.object({
    content: z.array(z.object({
      type: z.string().optional(),
      text: z.string().optional(),
    }).passthrough()).optional(),
    usage: z.record(z.string(), z.unknown()).optional(),
    providerData: z.object({
      rawUsage: z.object({
        credit: z.number().optional(),
      }).partial().optional(),
    }).partial().optional(),
  }).partial().passthrough().optional(),
}).passthrough();

const rawMessageEventSchema = z.object({
  type: z.literal('message'),
}).passthrough();

const rawUserEventSchema = z.object({
  type: z.literal('user'),
}).passthrough();

const rawSnapshotEventSchema = z.object({
  type: z.literal('file-history-snapshot'),
}).passthrough();

const rawEventSchema = z.union([
  rawSystemInitEventSchema,
  rawSystemEventSchema,
  rawResultEventSchema,
  rawAssistantEventSchema,
  rawMessageEventSchema,
  rawUserEventSchema,
  rawSnapshotEventSchema,
]);

export type CodebuddyRunnerEvent =
  | {
      event: 'session_started';
      payload: {
        sessionId?: string;
        model?: string;
        permissionMode?: string;
        tools?: string[];
      };
    }
  | {
      event: 'turn_completed';
      payload: {
        durationMs?: number;
        numTurns?: number;
        usage?: Record<string, number>;
      };
    }
  | {
      event: 'turn_failed';
      payload: {
        message?: string;
        exitCode?: number;
        stderr?: string[];
      };
    }
  | {
      event: 'turn_input_required';
      payload: {
        message?: string;
        sessionId?: string;
        permissionDenials: number;
      };
    }
  | {
      event: 'approval_auto_approved';
      payload: {
        message?: string;
        sessionId?: string;
      };
    }
  | {
      event: 'turn_timed_out';
      payload: {
        timeoutMs: number;
      };
    }
  | {
      event: 'turn_stalled';
      payload: {
        timeoutMs: number;
      };
    }
  | {
      event: 'turn_read_timed_out';
      payload: {
        timeoutMs: number;
      };
    }
  | {
      event: 'notification';
      payload: {
        raw: Record<string, unknown>;
        message?: string;
        usage?: Record<string, number>;
        credit?: number;
      };
    }
  | {
      event: 'other_message';
      payload: {
        raw: Record<string, unknown>;
      };
    }
  | {
      event: 'malformed';
      payload: {
        line: string;
      };
    };

export interface RunCodebuddyTurnInput {
  command: CodebuddyCommand;
  prompt?: string;
  issueId?: string;
  transcriptStore?: TranscriptStore;
  transcriptSessionId?: number;
  turnIndex?: number;
  readTimeoutMs?: number;
  turnTimeoutMs?: number;
  stallTimeoutMs?: number;
  onEvent?: (event: CodebuddyRunnerEvent) => void;
}

export interface RunCodebuddyTurnResult {
  events: CodebuddyRunnerEvent[];
  exitCode: number | null;
  stderr: string[];
}

function normalizeUsageRecord(rawUsage: Record<string, unknown> | undefined): Record<string, number> | undefined {
  if (!rawUsage) {
    return undefined;
  }

  const entries = Object.entries(rawUsage).filter((entry): entry is [string, number] => {
    const value = entry[1];
    return typeof value === 'number' && Number.isFinite(value);
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function extractAssistantText(rawContent: unknown): string | undefined {
  if (!Array.isArray(rawContent)) {
    return undefined;
  }

  const textParts = rawContent
    .flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return [];
      }

      const text = 'text' in entry ? entry.text : undefined;
      return typeof text === 'string' && text.length > 0 ? [text] : [];
    });

  return textParts.length > 0 ? textParts.join('\n') : undefined;
}

function stripTerminalControlSequences(line: string): string {
  return line
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/^[\x00-\x1f]+/, '');
}

function parseEventLine(line: string): CodebuddyRunnerEvent {
  const sanitizedLine = stripTerminalControlSequences(line);
  let parsed: unknown;

  try {
    parsed = JSON.parse(sanitizedLine);
  } catch {
    return {
      event: 'malformed',
      payload: { line: sanitizedLine },
    };
  }

  const rawEvent = rawEventSchema.safeParse(parsed);
  if (!rawEvent.success) {
    return {
      event: 'malformed',
      payload: { line: sanitizedLine },
    };
  }

  const event = rawEvent.data;
  if (event.type === 'system') {
    if (event.subtype === 'init') {
      const initEvent = rawSystemInitEventSchema.parse(event);
      return {
        event: 'session_started',
        payload: {
          sessionId: initEvent.session_id,
          model: initEvent.model,
          permissionMode: initEvent.permissionMode,
          tools: initEvent.tools,
        },
      };
    }

    return {
      event: 'other_message',
      payload: {
        raw: event,
      },
    };
  }

  if (event.type === 'result') {
    if (event.subtype === 'approval_auto_approved') {
      return {
        event: 'approval_auto_approved',
        payload: {
          message: event.result ?? event.subtype,
          sessionId: event.session_id,
        },
      };
    }

    if ((event.permission_denials?.length ?? 0) > 0) {
      return {
        event: 'turn_input_required',
        payload: {
          message: event.result ?? event.subtype,
          sessionId: event.session_id,
          permissionDenials: event.permission_denials?.length ?? 0,
        },
      };
    }

    if (event.is_error === true) {
      const isMaxTurnsExceeded = event.errors?.some((e) => /max turns/i.test(e)) ?? false;
      if (isMaxTurnsExceeded) {
        return {
          event: 'turn_completed',
          payload: {
            durationMs: event.duration_ms,
            numTurns: event.num_turns,
            usage: normalizeUsageRecord(event.usage),
          },
        };
      }

      return {
        event: 'turn_failed',
        payload: {
          message: event.result ?? event.subtype,
        },
      };
    }

    return {
      event: 'turn_completed',
      payload: {
        durationMs: event.duration_ms,
        numTurns: event.num_turns,
        usage: normalizeUsageRecord(event.usage),
      },
    };
  }

  if (event.type === 'assistant') {
    return {
      event: 'notification',
      payload: {
        raw: event,
        message: extractAssistantText(event.message?.content),
        usage: normalizeUsageRecord(event.message?.usage),
        credit: event.message?.providerData?.rawUsage?.credit,
      },
    };
  }

  return {
    event: 'other_message',
    payload: {
      raw: event,
    },
  };
}

export async function runCodebuddyTurn(
  input: RunCodebuddyTurnInput,
): Promise<RunCodebuddyTurnResult> {
  let transcriptSequence = 0;
  const recordTranscriptEvent = (
    role: TranscriptRole,
    eventType: string,
    payload: Record<string, unknown>,
    text?: string,
  ): void => {
    if (!input.transcriptStore || input.transcriptSessionId === undefined || !input.issueId) {
      return;
    }
    if (role === 'assistant' && eventType === 'message' && (!text || text.trim().length === 0)) {
      return;
    }
    transcriptSequence += 1;
    input.transcriptStore.recordEvent({
      sessionId: input.transcriptSessionId,
      issueId: input.issueId,
      turnIndex: input.turnIndex,
      sequence: transcriptSequence,
      role,
      eventType,
      text,
      payload,
    });
  };

  if (input.prompt) {
    recordTranscriptEvent('user', 'prompt', { prompt: input.prompt }, input.prompt);
  }

  const child = spawn(input.command.command, input.command.args, {
    cwd: input.command.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = child.stdout;
  const stderr = child.stderr;
  if (!stdout || !stderr) {
    throw new Error('codebuddy subprocess pipes are unavailable');
  }

  const events: CodebuddyRunnerEvent[] = [];
  const stderrLines: string[] = [];
  const stdoutReader = readline.createInterface({ input: stdout, crlfDelay: Infinity });
  const stderrReader = readline.createInterface({ input: stderr, crlfDelay: Infinity });

  let receivedOutput = false;
  let readTimedOut = false;
  let readTimeoutHandle: NodeJS.Timeout | null = null;

  function clearReadTimer(): void {
    if (readTimeoutHandle) {
      clearTimeout(readTimeoutHandle);
      readTimeoutHandle = null;
    }
  }

  function markReadable(): void {
    if (receivedOutput) {
      return;
    }

    receivedOutput = true;
    clearReadTimer();
  }

  stdoutReader.on('line', (line) => {
    markReadable();
    refreshStallTimer();
    const sanitizedLine = stripTerminalControlSequences(line);
    let rawPayload: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(sanitizedLine) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        rawPayload = parsed as Record<string, unknown>;
      }
    } catch {
      rawPayload = undefined;
    }
    const event = parseEventLine(line);
    events.push(event);
    if (event.event === 'session_started') {
      recordTranscriptEvent('runtime', 'session_started', rawPayload ?? event.payload);
    } else if (event.event === 'notification') {
      recordTranscriptEvent('assistant', 'message', event.payload.raw, event.payload.message);
    } else if (event.event === 'turn_completed') {
      recordTranscriptEvent('result', 'turn_completed', rawPayload ?? event.payload);
    } else if (event.event === 'turn_failed') {
      recordTranscriptEvent('error', 'turn_failed', rawPayload ?? event.payload, event.payload.message);
    } else if (event.event === 'malformed') {
      recordTranscriptEvent('runtime', 'malformed', event.payload, event.payload.line);
    } else {
      const payload = 'raw' in event.payload && typeof event.payload.raw === 'object' && event.payload.raw !== null
        ? event.payload.raw as Record<string, unknown>
        : event.payload;
      recordTranscriptEvent('runtime', event.event, payload);
    }
    if (input.onEvent) {
      try {
        input.onEvent(event);
      } catch {
        // onEvent failure must not abort the runner
      }
    }
  });

  stderrReader.on('line', (line) => {
    markReadable();
    refreshStallTimer();
    stderrLines.push(line);
    recordTranscriptEvent('runtime', 'stderr', { line }, line);
  });

  let timedOut = false;
  let stalled = false;
  if (input.readTimeoutMs) {
    readTimeoutHandle = setTimeout(() => {
      readTimedOut = true;
      child.kill('SIGTERM');
    }, input.readTimeoutMs);
  }

  const timeoutHandle = input.turnTimeoutMs
    ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, input.turnTimeoutMs)
    : null;
  let stallTimeoutHandle: NodeJS.Timeout | null = null;

  function clearStallTimer(): void {
    if (stallTimeoutHandle) {
      clearTimeout(stallTimeoutHandle);
      stallTimeoutHandle = null;
    }
  }

  function refreshStallTimer(): void {
    if (!input.stallTimeoutMs) {
      return;
    }

    clearStallTimer();
    stallTimeoutHandle = setTimeout(() => {
      stalled = true;
      child.kill('SIGTERM');
    }, input.stallTimeoutMs);
  }

  refreshStallTimer();

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', (error) => {
      reject(error);
    });

    child.once('close', (code) => {
      resolve(code ?? 0);
    });
  });

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  clearReadTimer();
  clearStallTimer();

  stdoutReader.close();
  stderrReader.close();

  if (timedOut && input.turnTimeoutMs) {
    recordTranscriptEvent('error', 'turn_timed_out', { timeoutMs: input.turnTimeoutMs });
    return {
      events: [{
        event: 'turn_timed_out',
        payload: {
          timeoutMs: input.turnTimeoutMs,
        },
      }],
      exitCode: null,
      stderr: stderrLines,
    };
  }

  if (readTimedOut && input.readTimeoutMs) {
    recordTranscriptEvent('error', 'turn_read_timed_out', { timeoutMs: input.readTimeoutMs });
    return {
      events: [{
        event: 'turn_read_timed_out',
        payload: {
          timeoutMs: input.readTimeoutMs,
        },
      }],
      exitCode: null,
      stderr: stderrLines,
    };
  }

  if (stalled && input.stallTimeoutMs) {
    recordTranscriptEvent('error', 'turn_stalled', { timeoutMs: input.stallTimeoutMs });
    return {
      events: [{
        event: 'turn_stalled',
        payload: {
          timeoutMs: input.stallTimeoutMs,
        },
      }],
      exitCode: null,
      stderr: stderrLines,
    };
  }

  const hasTerminalEvent = events.some(
    (event) => event.event === 'turn_completed'
      || event.event === 'turn_failed'
      || event.event === 'turn_stalled'
      || event.event === 'turn_read_timed_out',
  );
  if (!hasTerminalEvent && exitCode !== 0) {
    const event: CodebuddyRunnerEvent = {
      event: 'turn_failed',
      payload: {
        exitCode,
        stderr: stderrLines,
      },
    };
    events.push(event);
    recordTranscriptEvent('error', 'turn_failed', event.payload);
  }

  return {
    events,
    exitCode,
    stderr: stderrLines,
  };
}
