import pino, { type Logger } from 'pino';

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

export function createLogger() {
  return pino({
    name: 'agentfirst-f1',
    level: process.env.LOG_LEVEL ?? 'info',
  });
}
