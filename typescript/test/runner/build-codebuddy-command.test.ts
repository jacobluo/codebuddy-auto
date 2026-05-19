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
        '20',
        '--permission-mode',
        'default',
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
        '20',
        'Implement the issue',
      ],
    });
  });
});
