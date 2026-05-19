import { spawn } from 'node:child_process';
import readline from 'node:readline';

import { z } from 'zod';

import type { CodebuddyCommand } from './build-codebuddy-command.js';

const rawSystemInitEventSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  session_id: z.string().optional(),
  model: z.string().optional(),
  permissionMode: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

const rawResultEventSchema = z.object({
  type: z.literal('result'),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  num_turns: z.number().int().nonnegative().optional(),
  usage: z.record(z.string(), z.number()).optional(),
});

const rawAssistantEventSchema = z.object({
  type: z.literal('assistant'),
}).passthrough();

const rawMessageEventSchema = z.object({
  type: z.literal('message'),
}).passthrough();

const rawSnapshotEventSchema = z.object({
  type: z.literal('file-history-snapshot'),
}).passthrough();

const rawEventSchema = z.union([
  rawSystemInitEventSchema,
  rawResultEventSchema,
  rawAssistantEventSchema,
  rawMessageEventSchema,
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
      event: 'turn_timed_out';
      payload: {
        timeoutMs: number;
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
  turnTimeoutMs?: number;
}

export interface RunCodebuddyTurnResult {
  events: CodebuddyRunnerEvent[];
  exitCode: number | null;
  stderr: string[];
}

function parseEventLine(line: string): CodebuddyRunnerEvent {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      event: 'malformed',
      payload: { line },
    };
  }

  const rawEvent = rawEventSchema.safeParse(parsed);
  if (!rawEvent.success) {
    return {
      event: 'malformed',
      payload: { line },
    };
  }

  const event = rawEvent.data;
  if (event.type === 'system' && event.subtype === 'init') {
    return {
      event: 'session_started',
      payload: {
        sessionId: event.session_id,
        model: event.model,
        permissionMode: event.permissionMode,
        tools: event.tools,
      },
    };
  }

  if (event.type === 'result') {
    if (event.is_error === true) {
      return {
        event: 'turn_failed',
        payload: {
          message: event.subtype,
        },
      };
    }

    return {
      event: 'turn_completed',
      payload: {
        durationMs: event.duration_ms,
        numTurns: event.num_turns,
        usage: event.usage,
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

  stdoutReader.on('line', (line) => {
    events.push(parseEventLine(line));
  });

  stderrReader.on('line', (line) => {
    stderrLines.push(line);
  });

  let timedOut = false;
  const timeoutHandle = input.turnTimeoutMs
    ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, input.turnTimeoutMs)
    : null;

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

  stdoutReader.close();
  stderrReader.close();

  if (timedOut && input.turnTimeoutMs) {
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

  const hasTerminalEvent = events.some(
    (event) => event.event === 'turn_completed' || event.event === 'turn_failed',
  );
  if (!hasTerminalEvent && exitCode !== 0) {
    events.push({
      event: 'turn_failed',
      payload: {
        exitCode,
        stderr: stderrLines,
      },
    });
  }

  return {
    events,
    exitCode,
    stderr: stderrLines,
  };
}
