import pino, { type DestinationStream, type Logger } from 'pino';
import { z } from 'zod';

export interface RuntimeLogger {
  info: Logger['info'];
  error: Logger['error'];
  child?: (bindings: Record<string, unknown>) => RuntimeLogger;
}

export interface IssueLoggerContext {
  issueId: string;
  issueIdentifier: string;
  sessionId?: string | null;
  turnCount?: number;
}

export type LogFormat = 'human' | 'json';

export interface CreateLoggerOptions {
  destination?: DestinationStream;
  env?: Readonly<Record<string, string | undefined>>;
  format?: LogFormat;
  isTty?: boolean;
}

const logFormatSchema = z.enum(['human', 'json']).optional();
const logLevelSchema = z.string().min(1).optional();
const logRecordSchema = z.object({
  level: z.number(),
  msg: z.string().optional(),
}).passthrough();

const PINO_LEVEL_LABELS: Readonly<Record<number, string>> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

const STANDARD_PINO_FIELDS = new Set([
  'level',
  'time',
  'pid',
  'hostname',
  'name',
  'msg',
]);

export function createIssueLogger(
  logger: RuntimeLogger | undefined,
  context: IssueLoggerContext,
): RuntimeLogger | undefined {
  if (!logger) {
    return undefined;
  }

  if (typeof logger.child !== 'function') {
    return logger;
  }

  return logger.child({
    issueId: context.issueId,
    issueIdentifier: context.issueIdentifier,
    sessionId: context.sessionId ?? undefined,
    turnCount: context.turnCount,
  });
}

function resolveLogFormat(options: CreateLoggerOptions): LogFormat {
  if (options.format !== undefined) {
    return options.format;
  }

  const env = options.env ?? process.env;
  const envFormat = logFormatSchema.parse(env.LOG_FORMAT);
  if (envFormat !== undefined) {
    return envFormat;
  }

  return (options.isTty ?? process.stdout.isTTY) === true ? 'human' : 'json';
}

function resolveLogLevel(env: Readonly<Record<string, string | undefined>>): string {
  return logLevelSchema.parse(env.LOG_LEVEL) ?? 'info';
}

function getDefaultDestination(): DestinationStream {
  return {
    write(message: string) {
      process.stdout.write(message);
    },
  };
}

function formatLogValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (typeof value === 'string') {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function formatHumanReadableLogLine(line: string): string {
  try {
    const parsed: unknown = JSON.parse(line);
    const record = logRecordSchema.parse(parsed);
    const level = PINO_LEVEL_LABELS[record.level] ?? String(record.level);
    const message = record.msg === undefined ? '' : ` ${record.msg}`;
    const fields = Object.entries(record)
      .filter(([key]) => !STANDARD_PINO_FIELDS.has(key))
      .map(([key, value]) => `${key}=${formatLogValue(value)}`);
    const fieldText = fields.length > 0 ? ` ${fields.join(' ')}` : '';

    return `[${level}]${message}${fieldText}\n`;
  } catch {
    return line.endsWith('\n') ? line : `${line}\n`;
  }
}

function createHumanReadableDestination(destination: DestinationStream): DestinationStream {
  return {
    write(message: string) {
      for (const line of message.split('\n')) {
        if (line.length === 0) {
          continue;
        }

        destination.write(formatHumanReadableLogLine(line));
      }
    },
  };
}

export function createLogger(options: CreateLoggerOptions = {}) {
  const env = options.env ?? process.env;
  const destination = options.destination ?? getDefaultDestination();
  const format = resolveLogFormat(options);

  return pino({
    name: 'codebuddy-auto',
    level: resolveLogLevel(env),
  }, format === 'human' ? createHumanReadableDestination(destination) : destination);
}
