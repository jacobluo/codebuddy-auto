import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startScheduler } from '../../src/scheduler/index.js';
import type { ServiceConfig } from '../../src/spec/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';
import type { Tracker } from '../../src/tracker/index.js';
import type { Logger } from 'pino';

class NoopTracker implements Tracker {
  async fetchCandidateIssues() {
    return [];
  }

  async fetchIssuesByStates() {
    return [];
  }

  async fetchIssueStatesByIds() {
    return new Map();
  }
}

function makeConfig(): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    tracker: {
      ...DEFAULT_SERVICE_CONFIG.tracker,
      kind: 'local',
      apiKey: 'token',
    },
    polling: {
      intervalMs: 5,
    },
  };
}

describe('startScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs an immediate tick and continues on the configured interval', async () => {
    const runOnce = vi.fn()
      .mockResolvedValueOnce({ releasedIssueIds: [], dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] } })
      .mockResolvedValueOnce({ releasedIssueIds: [], dispatch: { availableSlots: 9, dispatchableIssueIds: ['1'], claimedIssueIds: ['1'] } });
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runSchedulerOnce: runOnce,
    });

    await Promise.resolve();
    expect(runOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5);
    expect(runOnce).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });

  it('logs tick failures and keeps the interval alive', async () => {
    const runOnce = vi.fn()
      .mockRejectedValueOnce(new Error('tick failed'))
      .mockResolvedValueOnce({ releasedIssueIds: [], dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] } });
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runSchedulerOnce: runOnce,
    });

    await Promise.resolve();
    expect(logger.error).toHaveBeenCalledWith({ error: 'tick failed' }, 'scheduler_tick_failed');

    await vi.advanceTimersByTimeAsync(5);
    expect(runOnce).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });

  it('does not overlap ticks when one poll is still running', async () => {
    let resolveFirstTick: (() => void) | undefined;
    const runOnce = vi.fn().mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirstTick = () => resolve({
          releasedIssueIds: [],
          dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] },
        });
      }),
    );
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runSchedulerOnce: runOnce,
    });

    await Promise.resolve();
    expect(runOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15);
    expect(runOnce).toHaveBeenCalledTimes(1);

    const releaseFirstTick = resolveFirstTick;
    if (!releaseFirstTick) {
      throw new Error('first tick resolver was not initialized');
    }

    releaseFirstTick();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5);
    expect(runOnce).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });
});
