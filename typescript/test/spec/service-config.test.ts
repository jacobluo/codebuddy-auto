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
});
