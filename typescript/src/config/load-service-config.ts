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
    root: DEFAULT_SERVICE_CONFIG.workspace.root,
    ...getObject(raw.workspace),
  };
  const hooks = {
    ...DEFAULT_SERVICE_CONFIG.hooks,
    ...getObject(raw.hooks),
  };
  const agent = {
    ...DEFAULT_SERVICE_CONFIG.agent,
    ...getObject(raw.agent),
  };
  const codebuddy = {
    ...DEFAULT_SERVICE_CONFIG.codebuddy,
    ...getObject(raw.codebuddy),
  };
  const pollingOverrides = getObject(raw.polling);
  const hooksOverrides = getObject(raw.hooks);
  const agentOverrides = getObject(raw.agent);
  const codebuddyOverrides = getObject(raw.codebuddy);

  if (typeof tracker.apiKey === 'string') {
    tracker.apiKey = resolveMaybeEnv(tracker.apiKey, env);
  }
  if (typeof workspace.root === 'string') {
    workspace.root = resolvePathValue(workspace.root, workflowPath, env);
  }
  if (typeof pollingOverrides.interval_ms === 'number') {
    polling.intervalMs = pollingOverrides.interval_ms;
  }
  if (typeof hooksOverrides.timeout_ms === 'number') {
    hooks.timeoutMs = hooksOverrides.timeout_ms;
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
  if (typeof codebuddy.command !== 'string' || codebuddy.command.length === 0) {
    codebuddy.command = DEFAULT_SERVICE_CONFIG.codebuddy.command;
  }

  return serviceConfigSchema.parse({
    tracker,
    polling,
    workspace,
    hooks,
    agent,
    codebuddy,
  });
}
