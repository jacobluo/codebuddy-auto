import { describe, expect, it } from 'vitest';

import { createEmptyTokenUsageUpdate, updateTokenUsage, type CodebuddyRunnerEvent } from '../../src/runner/index.js';

describe('updateTokenUsage', () => {
  it('accumulates deltas from absolute totals', () => {
    const previous = createEmptyTokenUsageUpdate();
    const events: CodebuddyRunnerEvent[] = [{
      event: 'other_message',
      payload: {
        raw: {
          type: 'assistant',
        },
        credit: 12.5,
      },
    }, {
      event: 'turn_completed',
      payload: {
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 1,
        },
      },
    }];

    expect(updateTokenUsage(previous, events)).toEqual({
      totals: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
        creditCost: 12.5,
      },
      lastReportedTotals: {
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
      },
      latestCreditCost: 12.5,
    });
  });

  it('deduplicates repeated absolute totals and only adds the delta', () => {
    const previous = {
      totals: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
        creditCost: 0,
      },
      lastReportedTotals: {
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
      },
      latestCreditCost: null,
    };
    const events: CodebuddyRunnerEvent[] = [{
      event: 'other_message',
      payload: {
        raw: {
          type: 'assistant',
        },
        credit: 18,
      },
    }, {
      event: 'turn_completed',
      payload: {
        usage: {
          input_tokens: 16,
          output_tokens: 5,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
        },
      },
    }];

    expect(updateTokenUsage(previous, events)).toEqual({
      totals: {
        inputTokens: 16,
        outputTokens: 5,
        totalTokens: 21,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 3,
        creditCost: 18,
      },
      lastReportedTotals: {
        inputTokens: 16,
        outputTokens: 5,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 3,
      },
      latestCreditCost: 18,
    });
  });

  it('falls back safely when no completed usage event exists', () => {
    const previous = createEmptyTokenUsageUpdate();
    const events: CodebuddyRunnerEvent[] = [{
      event: 'other_message',
      payload: {
        raw: {
          type: 'assistant',
        },
      },
    }];

    expect(updateTokenUsage(previous, events)).toEqual(previous);
  });

  it('retains the previous credit cost when no new assistant credit arrives', () => {
    const previous = {
      totals: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
        creditCost: 12.5,
      },
      lastReportedTotals: {
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
      },
      latestCreditCost: 12.5,
    };
    const events: CodebuddyRunnerEvent[] = [{
      event: 'turn_completed',
      payload: {
        usage: {
          input_tokens: 12,
          output_tokens: 5,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 1,
        },
      },
    }];

    expect(updateTokenUsage(previous, events)).toEqual({
      totals: {
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
        creditCost: 12.5,
      },
      lastReportedTotals: {
        inputTokens: 12,
        outputTokens: 5,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
      },
      latestCreditCost: null,
    });
  });
});
