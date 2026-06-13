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

async function flushSchedulerTick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('startScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs startup cleanup before the first tick and continues on the configured interval', async () => {
    const runStartupCleanup = vi.fn().mockResolvedValue({ cleanedWorkspaceIssueIds: ['cleanup-1'], cleanupError: null });
    const runOnce = vi.fn()
      .mockResolvedValueOnce({ releasedIssueIds: [], cleanedWorkspaceIssueIds: [], continuedIssueIds: [], dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] }, reconciliationError: null })
      .mockResolvedValueOnce({ releasedIssueIds: [], cleanedWorkspaceIssueIds: [], continuedIssueIds: [], dispatch: { availableSlots: 9, dispatchableIssueIds: ['1'], claimedIssueIds: ['1'] }, reconciliationError: null });
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runStartupCleanup,
      runSchedulerOnce: runOnce,
    });

    await flushSchedulerTick();
    expect(runStartupCleanup).toHaveBeenCalledTimes(1);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ cleanedWorkspaceIssueIds: ['cleanup-1'], cleanupError: null }, 'startup_cleanup_completed');

    await vi.advanceTimersByTimeAsync(5);
    expect(runOnce).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });

  it('logs startup cleanup partial errors in the success payload and still proceeds to ticking', async () => {
    const runStartupCleanup = vi.fn().mockResolvedValue({
      cleanedWorkspaceIssueIds: [],
      cleanupError: 'cleanup failed',
    });
    const runOnce = vi.fn().mockResolvedValue({
      releasedIssueIds: [],
      cleanedWorkspaceIssueIds: [],
      continuedIssueIds: [],
      dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] },
      reconciliationError: null,
    });
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runStartupCleanup,
      runSchedulerOnce: runOnce,
    });

    await flushSchedulerTick();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith({ cleanedWorkspaceIssueIds: [], cleanupError: 'cleanup failed' }, 'startup_cleanup_completed');
    expect(runOnce).toHaveBeenCalledTimes(1);

    await scheduler.stop();
  });

  it('warns when startup cleanup itself throws before ticking', async () => {
    const runStartupCleanup = vi.fn().mockRejectedValue(new Error('startup unavailable'));
    const runOnce = vi.fn().mockResolvedValue({
      releasedIssueIds: [],
      cleanedWorkspaceIssueIds: [],
      continuedIssueIds: [],
      dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] },
      reconciliationError: null,
    });
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runStartupCleanup,
      runSchedulerOnce: runOnce,
    });

    await flushSchedulerTick();
    expect(logger.warn).toHaveBeenCalledWith({ error: 'startup unavailable' }, 'startup_cleanup_failed');
    expect(runOnce).toHaveBeenCalledTimes(1);

    await scheduler.stop();
  });

  it('logs tick failures and keeps the interval alive', async () => {
    const runOnce = vi.fn()
      .mockRejectedValueOnce(new Error('tick failed'))
      .mockResolvedValueOnce({ releasedIssueIds: [], cleanedWorkspaceIssueIds: [], continuedIssueIds: [], dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] }, reconciliationError: null });
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runSchedulerOnce: runOnce,
      runStartupCleanup: vi.fn().mockResolvedValue({ cleanedWorkspaceIssueIds: [], cleanupError: null }),
    });

    await flushSchedulerTick();
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
          cleanedWorkspaceIssueIds: [],
          continuedIssueIds: [],
          dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] },
          reconciliationError: null,
        });
      }),
    );
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runSchedulerOnce: runOnce,
      runStartupCleanup: vi.fn().mockResolvedValue({ cleanedWorkspaceIssueIds: [], cleanupError: null }),
    });

    await flushSchedulerTick();
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

  it('waits for an in-flight tick to finish before stop resolves', async () => {
    let resolveTick: (() => void) | undefined;
    const runOnce = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveTick = () => resolve({
          releasedIssueIds: [],
          cleanedWorkspaceIssueIds: [],
          continuedIssueIds: [],
          dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] },
          reconciliationError: null,
        });
      }),
    );
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runSchedulerOnce: runOnce,
      runStartupCleanup: vi.fn().mockResolvedValue({ cleanedWorkspaceIssueIds: [], cleanupError: null }),
    });

    await flushSchedulerTick();
    const stopPromise = scheduler.stop();

    let settled = false;
    void stopPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    const finishTick = resolveTick;
    if (!finishTick) {
      throw new Error('tick resolver was not initialized');
    }

    finishTick();
    await stopPromise;
    expect(settled).toBe(true);
  });

  it('emits reconciliation errors in the success log payload', async () => {
    const runOnce = vi.fn().mockResolvedValue({
      releasedIssueIds: [],
      cleanedWorkspaceIssueIds: [],
      continuedIssueIds: ['1'],
      dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] },
      reconciliationError: 'tracker refresh failed',
    });
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;
    const createRuntimeSnapshot = vi.fn(() => ({
      generatedAt: '2026-05-20T00:00:00Z',
      counts: { running: 0, retrying: 0, claimed: 0, completed: 0 },
      cleanedWorkspaceIssueIds: [],
      totals: {
        secondsRunning: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 0,
      },
      running: [],
      retrying: [],
      progress: [],
      stuck: [],
      completedIssueIds: [],
    }));

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runSchedulerOnce: runOnce,
      runStartupCleanup: vi.fn().mockResolvedValue({ cleanedWorkspaceIssueIds: [], cleanupError: null }),
      createRuntimeSnapshot,
    });

    await flushSchedulerTick();
    expect(logger.info).toHaveBeenCalledWith(
      {
        releasedIssueIds: [],
        cleanedWorkspaceIssueIds: [],
        continuedIssueIds: ['1'],
        dispatchableCount: 0,
        claimedCount: 0,
        reconciliationError: 'tracker refresh failed',
        snapshot: {
          generatedAt: '2026-05-20T00:00:00Z',
          counts: { running: 0, retrying: 0, claimed: 0, completed: 0 },
          cleanedWorkspaceIssueIds: [],
          totals: {
            secondsRunning: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            creditCost: 0,
          },
          running: [],
          retrying: [],
          progress: [],
          stuck: [],
          completedIssueIds: [],
        },
      },
      'scheduler_tick_completed',
    );

    await scheduler.stop();
  });

  it('refreshes tracker/config context before startup cleanup and each tick when a provider is injected', async () => {
    const getTickContext = vi.fn()
      .mockResolvedValueOnce({ tracker: new NoopTracker(), config: makeConfig() })
      .mockResolvedValueOnce({ tracker: new NoopTracker(), config: makeConfig() })
      .mockResolvedValueOnce({ tracker: new NoopTracker(), config: makeConfig() });
    const runOnce = vi.fn().mockResolvedValue({
      releasedIssueIds: [],
      cleanedWorkspaceIssueIds: [],
      continuedIssueIds: [],
      dispatch: { availableSlots: 10, dispatchableIssueIds: [], claimedIssueIds: [] },
      reconciliationError: null,
    });
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    const scheduler = startScheduler(new NoopTracker(), makeConfig(), logger, {
      runStartupCleanup: vi.fn().mockResolvedValue({ cleanedWorkspaceIssueIds: [], cleanupError: null }),
      runSchedulerOnce: runOnce,
      getTickContext,
    });

    await flushSchedulerTick();
    await vi.advanceTimersByTimeAsync(5);

    expect(getTickContext).toHaveBeenCalledTimes(3);
    expect(runOnce).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });
});
