import { z } from 'zod';

export const trackerConfigSchema = z.object({
  kind: z.string(),
  endpoint: z.string().optional(),
  apiKey: z.string().optional(),
  projectSlug: z.string().optional(),
  activeStates: z.array(z.string()),
  terminalStates: z.array(z.string()),
  candidateLabel: z.string().optional(),
  excludeLabel: z.string().optional(),
  finishLabel: z.string().optional(),
});

export const pollingConfigSchema = z.object({
  intervalMs: z.number().int().positive(),
});

export const workspaceConfigSchema = z.object({
  root: z.string(),
  mode: z.enum(['directory', 'git-worktree']),
  sourceRoot: z.string(),
});

export const hooksConfigSchema = z.object({
  afterCreate: z.string().optional(),
  beforeRun: z.string().optional(),
  afterRun: z.string().optional(),
  beforeRemove: z.string().optional(),
  timeoutMs: z.number().int().positive(),
});

export const serverConfigSchema = z.object({
  port: z.number().int().min(0).optional(),
  host: z.string(),
});

export const transcriptConfigSchema = z.object({
  enabled: z.boolean(),
  sqlitePath: z.string().min(1),
});

export const agentConfigSchema = z.object({
  maxConcurrentAgents: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  maxRetryBackoffMs: z.number().int().positive(),
  maxConcurrentAgentsByState: z.record(z.string(), z.number().int().positive()),
  noProgressThreshold: z.number().int().positive(),
});

export const workerConfigSchema = z.object({
  kind: z.enum(['local', 'ssh']),
  sshCommand: z.string(),
  sshHost: z.string().optional(),
  sshUser: z.string().optional(),
  sshPort: z.number().int().positive().optional(),
  sshOptions: z.array(z.string()).optional(),
  remoteWorkspaceRoot: z.string().optional(),
});

/**
 * codebuddy 配置分组。
 *
 * - `command` — **CLI-only**：仅在 `worker.kind === 'ssh'` 走 CLI subprocess fallback 时使用，
 *   决定通过 `ssh ... <cmd> ...` 拉起的命令。本地 `worker.kind === 'local'` 走 SDK in-process
 *   路径时该字段被忽略。
 * - `model` — 指定执行模型；本地 SDK worker 映射到 SDK `options.model`，CLI fallback 映射到
 *   `codebuddy --model`。
 * - `settingSources` — **SDK-only**：仅在 SDK runner 中生效，对应 SDK `options.settingSources`。
 *   CLI fallback 不读取该字段。
 * - `sdkMaxTurns` — **SDK/CLI agent-internal budget**：默认 100。单独传给底层
 *   CodeBuddy `maxTurns` / `--max-turns`，让 `agent.maxTurns` 只表达外层 worker session turn 上限。
 * - 其余字段（`permissionMode`、`allowedTools`、`disallowedTools`、`mcpConfig`、`turnTimeoutMs`
 *   ...）在 SDK 与 CLI 两种模式下共用语义，只是底层加载方式不同。
 */
export const codebuddyConfigSchema = z.object({
  command: z.string(),
  /** 指定执行模型；SDK worker 与 CLI fallback 都会读取该字段。 */
  model: z.string().optional(),
  /**
   * SDK-only: 指定 SDK 加载哪些 setting 源，对应 SDK `options.settingSources`。
   * 例如 `['user', 'project']`。CLI fallback 不读取该字段。
   */
  settingSources: z.array(z.string()).optional(),
  sdkMaxTurns: z.number().int().positive().optional(),
  permissionMode: z.string().optional(),
  subagentPermissionMode: z.string().optional(),
  sandbox: z.string().optional(),
  tools: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  addDirs: z.array(z.string()).optional(),
  dangerouslySkipPermissions: z.boolean(),
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
  server: serverConfigSchema,
  transcript: transcriptConfigSchema,
  agent: agentConfigSchema,
  worker: workerConfigSchema,
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
    root: '.codebuddy-auto/workspaces',
    mode: 'directory',
    sourceRoot: '.',
  },
  hooks: {
    timeoutMs: 60_000,
  },
  server: {
    host: '127.0.0.1',
  },
  transcript: {
    enabled: true,
    sqlitePath: '.codebuddy-auto/transcripts.sqlite',
  },
  agent: {
    maxConcurrentAgents: 10,
    maxTurns: 20,
    maxRetryBackoffMs: 300_000,
    maxConcurrentAgentsByState: {},
    noProgressThreshold: 3,
  },
  worker: {
    kind: 'local',
    sshCommand: 'ssh',
  },
  codebuddy: {
    command: 'codebuddy',
    sdkMaxTurns: 100,
    dangerouslySkipPermissions: false,
    mcpStrict: true,
    turnTimeoutMs: 3_600_000,
    readTimeoutMs: 5_000,
    stallTimeoutMs: 300_000,
  },
};
