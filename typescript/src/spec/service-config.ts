import { z } from 'zod';

export const trackerConfigSchema = z.object({
  kind: z.string(),
  endpoint: z.string().optional(),
  apiKey: z.string().optional(),
  projectSlug: z.string().optional(),
  activeStates: z.array(z.string()),
  terminalStates: z.array(z.string()),
});

export const pollingConfigSchema = z.object({
  intervalMs: z.number().int().positive(),
});

export const workspaceConfigSchema = z.object({
  root: z.string(),
});

export const hooksConfigSchema = z.object({
  afterCreate: z.string().optional(),
  beforeRun: z.string().optional(),
  afterRun: z.string().optional(),
  beforeRemove: z.string().optional(),
  timeoutMs: z.number().int().positive(),
});

export const agentConfigSchema = z.object({
  maxConcurrentAgents: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  maxRetryBackoffMs: z.number().int().positive(),
  maxConcurrentAgentsByState: z.record(z.string(), z.number().int().positive()),
});

export const codebuddyConfigSchema = z.object({
  command: z.string(),
  permissionMode: z.string().optional(),
  sandbox: z.string().optional(),
  mcpConfig: z.string().optional(),
  mcpStrict: z.boolean(),
  turnTimeoutMs: z.number().int().positive(),
  readTimeoutMs: z.number().int().positive(),
  stallTimeoutMs: z.number().int(),
});

export const serviceConfigSchema = z.object({
  tracker: trackerConfigSchema,
  polling: pollingConfigSchema,
  workspace: workspaceConfigSchema,
  hooks: hooksConfigSchema,
  agent: agentConfigSchema,
  codebuddy: codebuddyConfigSchema,
});

export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

export const DEFAULT_SERVICE_CONFIG: ServiceConfig = {
  tracker: {
    kind: 'cnb',
    endpoint: 'https://api.cnb.cool',
    projectSlug: 'repo/demo',
    activeStates: ['open'],
    terminalStates: ['closed'],
  },
  polling: {
    intervalMs: 30_000,
  },
  workspace: {
    root: '.agentfirst/workspaces',
  },
  hooks: {
    timeoutMs: 60_000,
  },
  agent: {
    maxConcurrentAgents: 10,
    maxTurns: 20,
    maxRetryBackoffMs: 300_000,
    maxConcurrentAgentsByState: {},
  },
  codebuddy: {
    command: 'codebuddy',
    mcpStrict: true,
    turnTimeoutMs: 3_600_000,
    readTimeoutMs: 5_000,
    stallTimeoutMs: 300_000,
  },
};
