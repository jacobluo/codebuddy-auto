import { z } from 'zod';

export const blockerRefSchema = z.object({
  id: z.string().nullable(),
  identifier: z.string().nullable(),
  state: z.string().nullable(),
});

export const issueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number().int().nullable(),
  state: z.string(),
  branchName: z.string().nullable(),
  url: z.string().nullable(),
  labels: z.array(z.string()),
  blockedBy: z.array(blockerRefSchema),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const retryEntrySchema = z.object({
  issueId: z.string(),
  identifier: z.string(),
  mode: z.enum(['continuation', 'failure']),
  attempt: z.number().int().positive(),
  dueAtMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

/**
 * WorkerHandle — the per-issue control surface for a long-lived in-process
 * worker (see capability `sdk-multi-turn-worker`).
 *
 * Used only when `worker.kind === 'local'`. SSH path keeps using the
 * `retryAttempts` retry table because there is no long-lived session there.
 *
 * `gracefulExitRequested` is the cooperative signal from
 * `reconcileRuntimeState` — the worker checks it at every turn boundary and
 * exits the loop without aborting any in-flight tool call (design decision 6).
 *
 * `abortController` is reserved for hard cases: wall-clock turn timeout,
 * daemon SIGINT/SIGTERM shutdown, and worker-level error budget exhaustion.
 */
export const workerHandleSchema = z.object({
  issueId: z.string(),
  sessionId: z.string().nullable(),
  startedAt: z.string(),
  turnCount: z.number().int().nonnegative(),
  gracefulExitRequested: z.boolean(),
});

export const runningEntrySchema = z.object({
  issue: issueSchema,
  workspacePath: z.string(),
  sessionId: z.string().nullable(),
  startedAt: z.string(),
  turnCount: z.number().int().nonnegative(),
  lastEvent: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  secondsRunning: z.number().nonnegative(),
  tokenUsage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    cacheCreationInputTokens: z.number().int().nonnegative(),
    cacheReadInputTokens: z.number().int().nonnegative(),
    creditCost: z.number().nonnegative(),
  }),
  lastReportedTotals: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheCreationInputTokens: z.number().int().nonnegative(),
    cacheReadInputTokens: z.number().int().nonnegative(),
  }),
});

export const progressFingerprintSchema = z.object({
  issueId: z.string(),
  identifier: z.string(),
  headCommit: z.string().nullable(),
  statusShort: z.array(z.string()),
  untrackedFiles: z.array(z.string()),
  trackerState: z.string().nullable(),
  trackerLabels: z.array(z.string()),
  lastEvent: z.string().nullable(),
  fingerprint: z.string(),
});

export const stuckProgressStateSchema = z.object({
  reason: z.enum(['no_progress', 'max_turns_reached']),
  repeatedCount: z.number().int().positive(),
  fingerprint: z.string(),
});

export const issueProgressStateSchema = z.object({
  issueId: z.string(),
  identifier: z.string(),
  fingerprint: z.string(),
  repeatedCount: z.number().int().positive(),
  latest: progressFingerprintSchema,
  stuck: stuckProgressStateSchema.nullable(),
});

export const orchestratorRuntimeStateSchema = z.object({
  running: z.record(z.string(), runningEntrySchema),
  claimed: z.set(z.string()),
  retryAttempts: z.record(z.string(), retryEntrySchema),
  /**
   * Active per-issue worker handles. Populated only under
   * `worker.kind === 'local'`; SSH path leaves this empty.
   */
  runners: z.record(z.string(), workerHandleSchema),
  completed: z.set(z.string()),
  progress: z.record(z.string(), issueProgressStateSchema).default({}),
  stuck: z.record(z.string(), stuckProgressStateSchema).default({}),
});

export type BlockerRef = z.infer<typeof blockerRefSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type RetryEntry = z.infer<typeof retryEntrySchema>;
export type RunningEntry = z.infer<typeof runningEntrySchema>;
export type WorkerHandle = z.infer<typeof workerHandleSchema>;
export type ProgressFingerprintState = z.infer<typeof progressFingerprintSchema>;
export type StuckProgressState = z.infer<typeof stuckProgressStateSchema>;
export type IssueProgressState = z.infer<typeof issueProgressStateSchema>;
export type OrchestratorRuntimeState = z.infer<typeof orchestratorRuntimeStateSchema>;
