import { describe, expect, it } from 'vitest';

import { createIssueLogger, createLogger } from '../../src/logging/index.js';

function createCaptureDestination() {
  let output = '';

  return {
    destination: {
      write(chunk: string) {
        output += chunk;
      },
    },
    read() {
      return output;
    },
  };
}

describe('createLogger', () => {
  it('creates a named pino logger', () => {
    const logger = createLogger();

    expect(logger.bindings().name).toBe('codebuddy-auto');
  });

  it('formats TTY logs as human-readable lines by default', () => {
    const capture = createCaptureDestination();
    const logger = createLogger({
      destination: capture.destination,
      env: {},
      isTty: true,
    });

    logger.info({
      workflowPath: 'WORKFLOW.md',
      availableSlots: 2,
      dispatchableCount: 1,
    }, 'scheduler_initialized');

    expect(capture.read()).toBe(
      '[info] scheduler_initialized workflowPath=WORKFLOW.md availableSlots=2 dispatchableCount=1\n',
    );
  });

  it('keeps JSON logs when LOG_FORMAT=json', () => {
    const capture = createCaptureDestination();
    const logger = createLogger({
      destination: capture.destination,
      env: { LOG_FORMAT: 'json' },
      isTty: true,
    });

    logger.info({ workflowPath: 'WORKFLOW.md' }, 'preflight_ok');

    expect(JSON.parse(capture.read())).toMatchObject({
      name: 'codebuddy-auto',
      level: 30,
      workflowPath: 'WORKFLOW.md',
      msg: 'preflight_ok',
    });
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
      name: 'codebuddy-auto',
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
      name: 'codebuddy-auto',
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
