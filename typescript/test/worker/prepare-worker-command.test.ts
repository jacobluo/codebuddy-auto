import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { prepareWorkerCommand } from '../../src/worker/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

describe('prepareWorkerCommand', () => {
  it('returns the original command for the local worker', () => {
    const command = {
      command: 'codebuddy',
      args: ['--print'],
      cwd: '/tmp/workspace',
    };

    expect(prepareWorkerCommand(command, DEFAULT_SERVICE_CONFIG)).toEqual(command);
  });

  it('wraps the command in ssh transport for ssh worker mode', () => {
    const command = {
      command: 'codebuddy',
      args: ['--print', '--output-format', 'stream-json', 'prompt'],
      cwd: path.resolve('/repo/.agentfirst/workspaces/ISSUE-1'),
    };
    const prepared = prepareWorkerCommand(command, {
      ...DEFAULT_SERVICE_CONFIG,
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: path.resolve('/repo/.agentfirst/workspaces'),
      },
      worker: {
        kind: 'ssh',
        sshCommand: 'ssh',
        sshHost: 'worker.example.com',
        sshUser: 'agent',
        sshPort: 2222,
        sshOptions: ['-o', 'StrictHostKeyChecking=no'],
        remoteWorkspaceRoot: '/srv/agentfirst/workspaces',
      },
    });

    expect(prepared.command).toBe('ssh');
    expect(prepared.cwd).toBe(process.cwd());
    expect(prepared.args).toContain('-p');
    expect(prepared.args).toContain('2222');
    expect(prepared.args).toContain('agent@worker.example.com');
    expect(prepared.args.at(-1)).toContain("cd '/srv/agentfirst/workspaces/ISSUE-1'");
    expect(prepared.args.at(-1)).toContain("exec 'codebuddy' '--print' '--output-format' 'stream-json' 'prompt'");
  });
});
