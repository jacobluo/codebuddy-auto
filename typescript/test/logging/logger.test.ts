import { describe, expect, it } from 'vitest';

import { createIssueLogger, createLogger } from '../../src/logging/index.js';

describe('createLogger', () => {
  it('creates a named pino logger', () => {
    const logger = createLogger();

    expect(logger.bindings().name).toBe('agentfirst-f1');
  });

  it('adds structured runtime fields through child loggers', () => {
    const logger = createLogger();
    const child = logger.child({
      issueId: '1',
      issueIdentifier: '#1',
      sessionId: '1-turn-1',
    });

    expect(child.bindings()).toMatchObject({
      issueId: '1',
      issueIdentifier: '#1',
      sessionId: '1-turn-1',
      name: 'agentfirst-f1',
    });
  });

  it('builds issue-scoped child loggers with turn metadata', () => {
    const logger = createLogger();
    const child = createIssueLogger(logger, {
      issueId: '2',
      issueIdentifier: '#2',
      sessionId: 'session-2',
      turnCount: 3,
    });

    expect((child as ReturnType<typeof createLogger>)?.bindings()).toMatchObject({
      issueId: '2',
      issueIdentifier: '#2',
      sessionId: 'session-2',
      turnCount: 3,
      name: 'agentfirst-f1',
    });
  });

  it('returns the original logger when child() is unavailable', () => {
    const logger = {
      info() {
        return undefined;
      },
      error() {
        return undefined;
      },
    };

    expect(createIssueLogger(logger, {
      issueId: '3',
      issueIdentifier: '#3',
    })).toBe(logger);
  });
});
