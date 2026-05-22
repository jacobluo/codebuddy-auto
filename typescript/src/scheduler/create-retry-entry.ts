import type { RetryEntry } from '../spec/index.js';

export interface CreateRetryEntryInput {
  issueId: string;
  identifier: string;
  previousAttempt: number;
  reason: string;
  nowMs: number;
  maxRetryBackoffMs: number;
}

function isContinuationReason(reason: string): boolean {
  return reason === 'turn_completed';
}

export function createRetryEntry(input: CreateRetryEntryInput): RetryEntry {
  const mode = isContinuationReason(input.reason) ? 'continuation' : 'failure';
  const attempt = input.previousAttempt + 1;
  const delayMs = mode === 'continuation'
    ? 1_000
    : Math.min(10_000 * (2 ** (attempt - 1)), input.maxRetryBackoffMs);

  return {
    issueId: input.issueId,
    identifier: input.identifier,
    mode,
    attempt,
    dueAtMs: input.nowMs + delayMs,
    error: input.reason,
  };
}
