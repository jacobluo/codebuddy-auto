import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadServiceConfig } from '../../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

describe('loadServiceConfig', () => {
  it('keeps checked-in workflow examples rooted at their runtime directories', () => {
    const examples = [
      {
        path: path.join(repoRoot, 'examples/workflows/cnb-generic.WORKFLOW.md'),
      },
      {
        path: path.join(repoRoot, 'examples/workflows/symphony_repo_crm.WORKFLOW.md'),
      },
    ];

    for (const example of examples) {
      const config = loadServiceConfig(fs.readFileSync(example.path, 'utf8'), example.path, {
        CNB_TOKEN: 'token',
      });

      expect(config.workspace.root).toBe(path.join(path.dirname(example.path), '.codebuddy-auto/workspaces'));
      expect(config.workspace.sourceRoot).toBe(path.dirname(example.path));
    }
  });

  it('applies defaults when front matter is absent', () => {
    const config = loadServiceConfig('Prompt body only', '/tmp/project/WORKFLOW.md', {});

    expect(config.tracker.kind).toBe('cnb');
    expect(config.polling.intervalMs).toBe(30_000);
    expect(config.workspace.root).toBe(path.resolve('/tmp/project', '.codebuddy-auto/workspaces'));
    expect(config.workspace.mode).toBe('directory');
    expect(config.workspace.sourceRoot).toBe(path.resolve('/tmp/project'));
    expect(config.worker.kind).toBe('local');
    expect(config.codebuddy.command).toBe('codebuddy');
    expect(config.server.host).toBe('127.0.0.1');
  });

  it('resolves env-backed tracker api key and workspace overrides', () => {
    const workflow = `---
tracker:
  kind: cnb
  apiKey: $CNB_TOKEN
workspace:
  root: ./workspaces
  mode: git-worktree
  source_root: ./repo-source
worker:
  kind: ssh
  ssh_host: $SSH_HOST
  ssh_user: deploy
  ssh_port: 2202
  ssh_options: [-o, BatchMode=yes]
  remote_workspace_root: ./remote-workspaces
server:
  port: 8080
  host: 0.0.0.0
polling:
  interval_ms: 15000
agent:
  max_turns: 8
codebuddy:
  command: codebuddy --print
  permission_mode: acceptEdits
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
      SSH_HOST: 'worker.internal',
      HOME: '/home/tester',
    });

    expect(config.tracker.apiKey).toBe('secret-token');
    expect(config.workspace.root).toBe(path.resolve('/repo', 'workspaces'));
    expect(config.workspace.mode).toBe('git-worktree');
    expect(config.workspace.sourceRoot).toBe(path.resolve('/repo', 'repo-source'));
    expect(config.worker.kind).toBe('ssh');
    expect(config.worker.sshHost).toBe('worker.internal');
    expect(config.worker.sshUser).toBe('deploy');
    expect(config.worker.sshPort).toBe(2202);
    expect(config.worker.sshOptions).toEqual(['-o', 'BatchMode=yes']);
    expect(config.worker.remoteWorkspaceRoot).toBe(path.resolve('/repo', 'remote-workspaces'));
    expect(config.server).toEqual({ host: '0.0.0.0', port: 8080 });
    expect(config.polling.intervalMs).toBe(15_000);
    expect(config.agent.maxTurns).toBe(8);
    expect(config.codebuddy.command).toBe('codebuddy --print');
    expect(config.codebuddy.permissionMode).toBe('acceptEdits');
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

  it('loads hook scripts from front matter', () => {
    const workflow = `---
hooks:
  before_run: echo before
  after_run: echo after
  before_remove: echo remove
  after_create: echo create
  timeout_ms: 12345
---
body
`;

    const config = loadServiceConfig(workflow, '/repo/WORKFLOW.md', {});

    expect(config.hooks.afterCreate).toBe('echo create');
    expect(config.hooks.beforeRun).toBe('echo before');
    expect(config.hooks.afterRun).toBe('echo after');
    expect(config.hooks.beforeRemove).toBe('echo remove');
    expect(config.hooks.timeoutMs).toBe(12_345);
  });

  it('expands home-prefixed workspace roots', () => {
    const workflow = `---
workspace:
  root: ~/codebuddy-auto
---
body
`;

    const config = loadServiceConfig(workflow, '/repo/WORKFLOW.md', {
      HOME: '/Users/tester',
    });

    expect(config.workspace.root).toBe('/Users/tester/codebuddy-auto');
    expect(config.workspace.sourceRoot).toBe('/repo');
  });

  it('loads codebuddy.model and SDK-only codebuddy.setting_sources', () => {
    const workflow = `---
codebuddy:
  model: codebuddy-sonnet
  setting_sources: [user, project]
---
body
`;

    const config = loadServiceConfig(workflow, '/repo/WORKFLOW.md', {});

    expect(config.codebuddy.model).toBe('codebuddy-sonnet');
    expect(config.codebuddy.settingSources).toEqual(['user', 'project']);
  });
});
