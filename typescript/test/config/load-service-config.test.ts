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
  });

  it('resolves env-backed tracker api key and relative workspace root', () => {
    const workflow = `---
tracker:
  kind: cnb
  apiKey: $CNB_TOKEN
workspace:
  root: ./workspaces
polling:
  interval_ms: 15000
agent:
  max_turns: 8
codebuddy:
  command: codebuddy --print
  mcp_strict: false
---
You are working on {{ issue.identifier }}.
`;

    const config = loadServiceConfig(workflow, '/repo/WORKFLOW.md', {
      CNB_TOKEN: 'secret-token',
      HOME: '/home/tester',
    });

    expect(config.tracker.apiKey).toBe('secret-token');
    expect(config.workspace.root).toBe(path.resolve('/repo', 'workspaces'));
    expect(config.polling.intervalMs).toBe(15_000);
    expect(config.agent.maxTurns).toBe(8);
    expect(config.codebuddy.command).toBe('codebuddy --print');
    expect(config.codebuddy.mcpStrict).toBe(false);
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
