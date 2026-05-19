import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/logging/index.js';

describe('createLogger', () => {
  it('creates a named pino logger', () => {
    const logger = createLogger();

    expect(logger.bindings().name).toBe('agentfirst-f1');
  });
});
