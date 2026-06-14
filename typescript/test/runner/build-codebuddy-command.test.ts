import { describe, expect, it } from 'vitest';

import { buildCodebuddyCommand } from '../../src/runner/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

describe('buildCodebuddyCommand', () => {
  it('builds a first-turn command with session id and strict MCP config', () => {
    const command = buildCodebuddyCommand({
      config: {
        ...DEFAULT_SERVICE_CONFIG,
        codebuddy: {
          ...DEFAULT_SERVICE_CONFIG.codebuddy,
          permissionMode: 'default',
          subagentPermissionMode: 'plan',
          tools: ['mcp__cnb_api__comment'],
          allowedTools: ['Read'],
          disallowedTools: ['WebSearch'],
          addDirs: ['/tmp/shared', '/tmp/cache'],
          dangerouslySkipPermissions: true,
          mcpConfig: '/tmp/mcp.json',
        },
      },
      prompt: 'Implement the issue',
      sessionId: 'session-1',
      workspacePath: '/tmp/workspaces/ABC-1',
    });

    expect(command).toEqual({
      command: 'codebuddy',
      cwd: '/tmp/workspaces/ABC-1',
      args: [
        '--print',
        '--output-format',
        'stream-json',
        '--session-id',
        'session-1',
        '--max-turns',
        '100',
        '--permission-mode',
        'default',
        '--subagent-permission-mode',
        'plan',
        '--tools',
        'mcp__cnb_api__comment',
        '--allowedTools',
        'Read',
        '--disallowedTools',
        'WebSearch',
        '--add-dir',
        '/tmp/shared',
        '--add-dir',
        '/tmp/cache',
        '-y',
        '--mcp-config',
        '/tmp/mcp.json',
        '--strict-mcp-config',
        'Implement the issue',
      ],
    });
  });

  it('builds a continuation command with resume id', () => {
    const command = buildCodebuddyCommand({
      config: DEFAULT_SERVICE_CONFIG,
      prompt: 'Continue the task',
      sessionId: 'session-1',
      resumeSessionId: 'session-1',
      workspacePath: '/tmp/workspaces/ABC-1',
    });

    expect(command.args).toContain('--resume');
    expect(command.args).not.toContain('--session-id');
  });

  it('passes the configured model to the CLI fallback command', () => {
    const command = buildCodebuddyCommand({
      config: {
        ...DEFAULT_SERVICE_CONFIG,
        codebuddy: {
          ...DEFAULT_SERVICE_CONFIG.codebuddy,
          model: 'codebuddy-opus',
        },
      },
      prompt: 'Implement the issue',
      sessionId: 'session-1',
      workspacePath: '/tmp/workspaces/ABC-1',
    });

    expect(command.args).toContain('--model');
    expect(command.args).toContain('codebuddy-opus');
  });

  it('splits configured command strings into executable and base args', () => {
    const command = buildCodebuddyCommand({
      config: {
        ...DEFAULT_SERVICE_CONFIG,
        codebuddy: {
          ...DEFAULT_SERVICE_CONFIG.codebuddy,
          command: 'node "/tmp/mock-cli.mjs" --mock-mode',
        },
      },
      prompt: 'Implement the issue',
      sessionId: 'session-1',
      workspacePath: '/tmp/workspaces/ABC-1',
    });

    expect(command).toEqual({
      command: 'node',
      cwd: '/tmp/workspaces/ABC-1',
      args: [
        '/tmp/mock-cli.mjs',
        '--mock-mode',
        '--print',
        '--output-format',
        'stream-json',
        '--session-id',
        'session-1',
        '--max-turns',
        '100',
        'Implement the issue',
      ],
    });
  });

  it('passes --max-turns from codebuddy.sdkMaxTurns instead of agent.maxTurns', () => {
    const defaultCommand = buildCodebuddyCommand({
      config: {
        ...DEFAULT_SERVICE_CONFIG,
        agent: {
          ...DEFAULT_SERVICE_CONFIG.agent,
          maxTurns: 30,
        },
      },
      prompt: 'Implement the issue',
      sessionId: 'session-1',
      workspacePath: '/tmp/workspaces/ABC-1',
    });
    expect(defaultCommand.args).toContain('--max-turns');
    expect(defaultCommand.args).toContain('100');
    expect(defaultCommand.args).not.toContain('30');

    const configuredCommand = buildCodebuddyCommand({
      config: {
        ...DEFAULT_SERVICE_CONFIG,
        codebuddy: {
          ...DEFAULT_SERVICE_CONFIG.codebuddy,
          sdkMaxTurns: 64,
        },
      },
      prompt: 'Implement the issue',
      sessionId: 'session-1',
      workspacePath: '/tmp/workspaces/ABC-1',
    });
    expect(configuredCommand.args).toContain('--max-turns');
    expect(configuredCommand.args).toContain('64');
  });
});
