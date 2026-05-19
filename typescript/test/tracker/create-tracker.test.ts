import { describe, expect, it } from 'vitest';

import { createTracker, CnbTracker, LocalTracker } from '../../src/tracker/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

describe('createTracker', () => {
  it('creates a local tracker when configured', () => {
    const tracker = createTracker({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        kind: 'local',
      },
    });

    expect(tracker).toBeInstanceOf(LocalTracker);
  });

  it('creates a cnb tracker when configured', () => {
    const tracker = createTracker({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        kind: 'cnb',
        endpoint: 'https://api.cnb.cool',
        projectSlug: 'repo/demo',
        apiKey: 'token',
      },
    });

    expect(tracker).toBeInstanceOf(CnbTracker);
  });

  it('rejects unsupported tracker kinds', () => {
    expect(() =>
      createTracker({
        ...DEFAULT_SERVICE_CONFIG,
        tracker: {
          ...DEFAULT_SERVICE_CONFIG.tracker,
          kind: 'unknown',
        },
      }),
    ).toThrow('unsupported tracker kind: unknown');
  });
});
