import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadServiceConfig } from '../../src/config/index.js';

describe('loadServiceConfig', () => {
  it('applies defaults when front matter is absent', () => {
    const config = loadServiceConfig('Prompt body only', '/tmp/project/WORKFLOW.md', {});

    expect(config.tracker.kind).toBe('cnb');
    expect(config.polling.intervalMs).toBe(30_000);
    expect(config.workspace.root).toBe(path.resolve('/tmp/project', '.agentfirst/workspaces'));
    expect(config.codebuddy.command).toBe('codebuddy');
    expect(config.server.host).toBe('127.0.0.1');
  });

  it('resolves env-backed tracker api key and relative workspace root', () => {
    const workflow = `---
tracker:
  kind: cnb
  apiKey: $CNB_TOKEN
workspace:
  root: ./workspaces
server:
  port: 8080
  host: 0.0.0.0
polling:
  interval_ms: 15000
agent:
  max_turns: 8
codebuddy:
  command: codebuddy --print
  subagent_permission_mode: plan
  tools: [mcp__cnb_api__comment]
  allowed_tools: [Read]
  disallowed_tools: [WebSearch]
  add_dirs: [./shared, ~/scratch]
  mcp_config: ./.codebuddy/mcp.json
  mcp_strict: false
  dangerously_skip_permissions: true
---
You are working on {{ issue.identifier }}.
`;

    const config = loadServiceConfig(workflow, '/repo/WORKFLOW.md', {
      CNB_TOKEN: 'secret-token',
      HOME: '/home/tester',
    });

    expect(config.tracker.apiKey).toBe('secret-token');
    expect(config.workspace.root).toBe(path.resolve('/repo', 'workspaces'));
    expect(config.server).toEqual({ host: '0.0.0.0', port: 8080 });
    expect(config.polling.intervalMs).toBe(15_000);
    expect(config.agent.maxTurns).toBe(8);
    expect(config.codebuddy.command).toBe('codebuddy --print');
    expect(config.codebuddy.subagentPermissionMode).toBe('plan');
    expect(config.codebuddy.tools).toEqual(['mcp__cnb_api__comment']);
    expect(config.codebuddy.allowedTools).toEqual(['Read']);
    expect(config.codebuddy.disallowedTools).toEqual(['WebSearch']);
    expect(config.codebuddy.addDirs).toEqual([
      path.resolve('/repo', 'shared'),
      '/home/tester/scratch',
    ]);
    expect(config.codebuddy.mcpConfig).toBe(path.resolve('/repo', '.codebuddy/mcp.json'));
    expect(config.codebuddy.mcpStrict).toBe(false);
    expect(config.codebuddy.dangerouslySkipPermissions).toBe(true);
  });

  it('expands home-prefixed workspace roots', () => {
    const workflow = `---
workspace:
  root: ~/agentfirst
---
body
`;

    const config = loadServiceConfig(workflow, '/repo/WORKFLOW.md', {
      HOME: '/Users/tester',
    });

    expect(config.workspace.root).toBe('/Users/tester/agentfirst');
  });
});
