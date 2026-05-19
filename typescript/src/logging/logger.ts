import pino from 'pino';

export function createLogger() {
  return pino({
    name: 'agentfirst-f1',
    level: process.env.LOG_LEVEL ?? 'info',
  });
}
