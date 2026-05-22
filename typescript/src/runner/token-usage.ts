import type { CodebuddyRunnerEvent } from './run-codebuddy-turn.js';

export interface TokenUsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  creditCost: number;
}

export interface LastReportedTokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface TokenUsageUpdate {
  totals: TokenUsageTotals;
  lastReportedTotals: LastReportedTokenTotals;
  latestCreditCost: number | null;
}

function getUsageValue(usage: Record<string, number> | undefined, key: string): number {
  const value = usage?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

function extractAbsoluteTotals(events: CodebuddyRunnerEvent[]): LastReportedTokenTotals | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.event !== 'turn_completed') {
      continue;
    }

    return {
      inputTokens: getUsageValue(event.payload.usage, 'input_tokens'),
      outputTokens: getUsageValue(event.payload.usage, 'output_tokens'),
      cacheCreationInputTokens: getUsageValue(event.payload.usage, 'cache_creation_input_tokens'),
      cacheReadInputTokens: getUsageValue(event.payload.usage, 'cache_read_input_tokens'),
    };
  }

  return null;
}

function extractLatestCreditCost(events: CodebuddyRunnerEvent[]): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.event !== 'other_message') {
      continue;
    }

    const credit = event.payload.credit;
    if (typeof credit === 'number' && Number.isFinite(credit) && credit >= 0) {
      return credit;
    }
  }

  return null;
}

function computeDelta(current: number, previous: number): number {
  return current >= previous ? current - previous : current;
}

export function createEmptyTokenUsageUpdate(): TokenUsageUpdate {
  return {
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      creditCost: 0,
    },
    lastReportedTotals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    latestCreditCost: null,
  };
}

export function updateTokenUsage(
  previous: TokenUsageUpdate,
  events: CodebuddyRunnerEvent[],
): TokenUsageUpdate {
  const nextReportedTotals = extractAbsoluteTotals(events);
  if (!nextReportedTotals) {
    return previous;
  }

  const inputDelta = computeDelta(nextReportedTotals.inputTokens, previous.lastReportedTotals.inputTokens);
  const outputDelta = computeDelta(nextReportedTotals.outputTokens, previous.lastReportedTotals.outputTokens);
  const cacheCreationDelta = computeDelta(
    nextReportedTotals.cacheCreationInputTokens,
    previous.lastReportedTotals.cacheCreationInputTokens,
  );
  const cacheReadDelta = computeDelta(
    nextReportedTotals.cacheReadInputTokens,
    previous.lastReportedTotals.cacheReadInputTokens,
  );
  const latestCreditCost = extractLatestCreditCost(events);

  return {
    totals: {
      inputTokens: previous.totals.inputTokens + inputDelta,
      outputTokens: previous.totals.outputTokens + outputDelta,
      totalTokens: previous.totals.totalTokens + inputDelta + outputDelta,
      cacheCreationInputTokens: previous.totals.cacheCreationInputTokens + cacheCreationDelta,
      cacheReadInputTokens: previous.totals.cacheReadInputTokens + cacheReadDelta,
      creditCost: latestCreditCost ?? previous.totals.creditCost,
    },
    lastReportedTotals: nextReportedTotals,
    latestCreditCost,
  };
}
