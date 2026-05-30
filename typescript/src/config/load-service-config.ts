import path from 'node:path';
import { parse } from 'yaml';

import {
  DEFAULT_SERVICE_CONFIG,
  type ServiceConfig,
  serviceConfigSchema,
} from '../spec/index.js';

const WORKFLOW_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

type Environment = NodeJS.ProcessEnv;

function expandHome(value: string, env: Environment): string {
  if (!value.startsWith('~/')) {
    return value;
  }

  const home = env.HOME;
  if (!home) {
    return value;
  }

  return path.join(home, value.slice(2));
}

function resolveMaybeEnv(value: string, env: Environment): string {
  if (!value.startsWith('$')) {
    return value;
  }

  const envName = value.slice(1);
  return env[envName] ?? '';
}

function resolvePathValue(value: string, workflowPath: string, env: Environment): string {
  const expanded = expandHome(resolveMaybeEnv(value, env), env);
  if (expanded.length === 0) {
    return expanded;
  }
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(path.dirname(workflowPath), expanded);
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('workflow front matter must decode to an object');
  }
  return value as Record<string, unknown>;
}

function parseFrontMatter(workflowSource: string): Record<string, unknown> {
  const match = workflowSource.match(WORKFLOW_PATTERN);
  if (!match) {
    return {};
  }

  const frontMatter = match[1];
  if (frontMatter === undefined) {
    return {};
  }

  const parsed = parse(frontMatter);
  if (parsed == null) {
    return {};
  }

  return ensurePlainObject(parsed);
}

function getObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((entry): entry is string => typeof entry === 'string');
  return values.length > 0 ? values : undefined;
}

export function loadServiceConfig(
  workflowSource: string,
  workflowPath: string,
  env: Environment = process.env,
): ServiceConfig {
  const raw = parseFrontMatter(workflowSource);

  const tracker = {
    ...DEFAULT_SERVICE_CONFIG.tracker,
    ...getObject(raw.tracker),
  };
  const polling = {
    intervalMs: DEFAULT_SERVICE_CONFIG.polling.intervalMs,
    ...getObject(raw.polling),
  };
  const workspace = {
    ...DEFAULT_SERVICE_CONFIG.workspace,
    ...getObject(raw.workspace),
  };
  const hooks = {
    ...DEFAULT_SERVICE_CONFIG.hooks,
    ...getObject(raw.hooks),
  };
  const server = {
    ...DEFAULT_SERVICE_CONFIG.server,
    ...getObject(raw.server),
  };
  const agent = {
    ...DEFAULT_SERVICE_CONFIG.agent,
    ...getObject(raw.agent),
  };
  const worker = {
    ...DEFAULT_SERVICE_CONFIG.worker,
    ...getObject(raw.worker),
  };
  const codebuddy = {
    ...DEFAULT_SERVICE_CONFIG.codebuddy,
    ...getObject(raw.codebuddy),
  };
  const pollingOverrides = getObject(raw.polling);
  const workspaceOverrides = getObject(raw.workspace);
  const hooksOverrides = getObject(raw.hooks);
  const serverOverrides = getObject(raw.server);
  const agentOverrides = getObject(raw.agent);
  const workerOverrides = getObject(raw.worker);
  const codebuddyOverrides = getObject(raw.codebuddy);

  if (typeof tracker.apiKey === 'string') {
    tracker.apiKey = resolveMaybeEnv(tracker.apiKey, env);
  }
  if (typeof workspace.root === 'string') {
    workspace.root = resolvePathValue(workspace.root, workflowPath, env);
  }
  if (typeof workspace.sourceRoot === 'string') {
    workspace.sourceRoot = resolvePathValue(workspace.sourceRoot, workflowPath, env);
  }
  if (workspaceOverrides.mode === 'directory' || workspaceOverrides.mode === 'git-worktree') {
    workspace.mode = workspaceOverrides.mode;
  }
  if (typeof workspaceOverrides.source_root === 'string') {
    workspace.sourceRoot = resolvePathValue(workspaceOverrides.source_root, workflowPath, env);
  }
  if (typeof pollingOverrides.interval_ms === 'number') {
    polling.intervalMs = pollingOverrides.interval_ms;
  }
  if (typeof hooksOverrides.after_create === 'string') {
    hooks.afterCreate = hooksOverrides.after_create;
  }
  if (typeof hooksOverrides.before_run === 'string') {
    hooks.beforeRun = hooksOverrides.before_run;
  }
  if (typeof hooksOverrides.after_run === 'string') {
    hooks.afterRun = hooksOverrides.after_run;
  }
  if (typeof hooksOverrides.before_remove === 'string') {
    hooks.beforeRemove = hooksOverrides.before_remove;
  }
  if (typeof hooksOverrides.timeout_ms === 'number') {
    hooks.timeoutMs = hooksOverrides.timeout_ms;
  }
  if (typeof serverOverrides.port === 'number') {
    server.port = serverOverrides.port;
  }
  if (typeof serverOverrides.host === 'string' && serverOverrides.host.length > 0) {
    server.host = serverOverrides.host;
  }
  if (typeof agentOverrides.max_concurrent_agents === 'number') {
    agent.maxConcurrentAgents = agentOverrides.max_concurrent_agents;
  }
  if (typeof agentOverrides.max_turns === 'number') {
    agent.maxTurns = agentOverrides.max_turns;
  }
  if (typeof agentOverrides.max_retry_backoff_ms === 'number') {
    agent.maxRetryBackoffMs = agentOverrides.max_retry_backoff_ms;
  }
  if (
    typeof agentOverrides.max_concurrent_agents_by_state === 'object' &&
    agentOverrides.max_concurrent_agents_by_state !== null
  ) {
    agent.maxConcurrentAgentsByState = agentOverrides.max_concurrent_agents_by_state as Record<string, number>;
  }
  if (typeof workerOverrides.kind === 'string' && (workerOverrides.kind === 'local' || workerOverrides.kind === 'ssh')) {
    worker.kind = workerOverrides.kind;
  }
  if (typeof workerOverrides.ssh_command === 'string') {
    worker.sshCommand = workerOverrides.ssh_command;
  }
  if (typeof workerOverrides.ssh_host === 'string') {
    worker.sshHost = resolveMaybeEnv(workerOverrides.ssh_host, env);
  }
  if (typeof workerOverrides.ssh_user === 'string') {
    worker.sshUser = resolveMaybeEnv(workerOverrides.ssh_user, env);
  }
  if (typeof workerOverrides.ssh_port === 'number') {
    worker.sshPort = workerOverrides.ssh_port;
  }
  const sshOptions = getStringArray(workerOverrides.ssh_options);
  if (sshOptions) {
    worker.sshOptions = sshOptions;
  }
  if (typeof workerOverrides.remote_workspace_root === 'string') {
    worker.remoteWorkspaceRoot = resolvePathValue(workerOverrides.remote_workspace_root, workflowPath, env);
  }
  if (typeof codebuddyOverrides.permission_mode === 'string') {
    codebuddy.permissionMode = codebuddyOverrides.permission_mode;
  }
  if (typeof codebuddyOverrides.subagent_permission_mode === 'string') {
    codebuddy.subagentPermissionMode = codebuddyOverrides.subagent_permission_mode;
  }
  if (typeof codebuddyOverrides.mcp_config === 'string') {
    codebuddy.mcpConfig = resolvePathValue(codebuddyOverrides.mcp_config, workflowPath, env);
  }
  const codebuddyTools = getStringArray(codebuddyOverrides.tools);
  if (codebuddyTools) {
    codebuddy.tools = codebuddyTools;
  }
  const allowedTools = getStringArray(codebuddyOverrides.allowed_tools);
  if (allowedTools) {
    codebuddy.allowedTools = allowedTools;
  }
  const disallowedTools = getStringArray(codebuddyOverrides.disallowed_tools);
  if (disallowedTools) {
    codebuddy.disallowedTools = disallowedTools;
  }
  const addDirs = getStringArray(codebuddyOverrides.add_dirs);
  if (addDirs) {
    codebuddy.addDirs = addDirs.map((entry) => resolvePathValue(entry, workflowPath, env));
  }
  if (typeof codebuddyOverrides.turn_timeout_ms === 'number') {
    codebuddy.turnTimeoutMs = codebuddyOverrides.turn_timeout_ms;
  }
  if (typeof codebuddyOverrides.read_timeout_ms === 'number') {
    codebuddy.readTimeoutMs = codebuddyOverrides.read_timeout_ms;
  }
  if (typeof codebuddyOverrides.stall_timeout_ms === 'number') {
    codebuddy.stallTimeoutMs = codebuddyOverrides.stall_timeout_ms;
  }
  if (typeof codebuddyOverrides.mcp_strict === 'boolean') {
    codebuddy.mcpStrict = codebuddyOverrides.mcp_strict;
  }
  if (typeof codebuddyOverrides.dangerously_skip_permissions === 'boolean') {
    codebuddy.dangerouslySkipPermissions = codebuddyOverrides.dangerously_skip_permissions;
  }
  if (typeof codebuddy.command !== 'string' || codebuddy.command.length === 0) {
    codebuddy.command = DEFAULT_SERVICE_CONFIG.codebuddy.command;
  }

  return serviceConfigSchema.parse({
    tracker,
    polling,
    workspace,
    hooks,
    server,
    agent,
    worker,
    codebuddy,
  });
}
