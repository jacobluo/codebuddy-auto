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
  attempt: z.number().int().positive(),
  dueAtMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

export const runningEntrySchema = z.object({
  issue: issueSchema,
  sessionId: z.string().nullable(),
  startedAt: z.string(),
  turnCount: z.number().int().nonnegative(),
  lastEvent: z.string().nullable(),
  lastEventAt: z.string().nullable(),
});

export const orchestratorRuntimeStateSchema = z.object({
  running: z.record(z.string(), runningEntrySchema),
  claimed: z.set(z.string()),
  retryAttempts: z.record(z.string(), retryEntrySchema),
  completed: z.set(z.string()),
});

export type BlockerRef = z.infer<typeof blockerRefSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type RetryEntry = z.infer<typeof retryEntrySchema>;
export type RunningEntry = z.infer<typeof runningEntrySchema>;
export type OrchestratorRuntimeState = z.infer<typeof orchestratorRuntimeStateSchema>;
