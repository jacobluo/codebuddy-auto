import { describe, expect, it } from 'vitest';

import { DEFAULT_SERVICE_CONFIG, serviceConfigSchema } from '../../src/spec/index.js';

describe('serviceConfigSchema', () => {
  it('accepts the default config', () => {
    expect(serviceConfigSchema.parse(DEFAULT_SERVICE_CONFIG)).toEqual(DEFAULT_SERVICE_CONFIG);
  });

  it('rejects invalid concurrency values', () => {
    expect(() =>
      serviceConfigSchema.parse({
        ...DEFAULT_SERVICE_CONFIG,
        agent: {
          ...DEFAULT_SERVICE_CONFIG.agent,
          maxConcurrentAgents: 0,
        },
      }),
    ).toThrow();
  });

  it('rejects non-positive turn timeout values', () => {
    expect(() =>
      serviceConfigSchema.parse({
        ...DEFAULT_SERVICE_CONFIG,
        codebuddy: {
          ...DEFAULT_SERVICE_CONFIG.codebuddy,
          turnTimeoutMs: 0,
        },
      }),
    ).toThrow();
  });
});
