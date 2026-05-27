import { describe, expect, it } from 'vitest';

import { DEFAULT_SERVICE_CONFIG, serviceConfigSchema } from '../../src/spec/index.js';

describe('serviceConfigSchema', () => {
  it('accepts the default config', () => {
    expect(serviceConfigSchema.parse(DEFAULT_SERVICE_CONFIG)).toEqual(DEFAULT_SERVICE_CONFIG);
  });

  it('rejects invalid concurrency values', () => {
    expect(() =>
      serviceConfigSchema.parse({
        ...DEFAULT_SERVICE_CONFIG,
        agent: {
          ...DEFAULT_SERVICE_CONFIG.agent,
          maxConcurrentAgents: 0,
        },
      }),
    ).toThrow();
  });

  it('rejects non-positive turn timeout values', () => {
    expect(() =>
      serviceConfigSchema.parse({
        ...DEFAULT_SERVICE_CONFIG,
        codebuddy: {
          ...DEFAULT_SERVICE_CONFIG.codebuddy,
          turnTimeoutMs: 0,
        },
      }),
    ).toThrow();
  });

  it('accepts an optional status server port override', () => {
    expect(serviceConfigSchema.parse({
      ...DEFAULT_SERVICE_CONFIG,
      server: {
        host: '127.0.0.1',
        port: 0,
      },
    }).server.port).toBe(0);
  });

  it('accepts ssh worker settings', () => {
    expect(serviceConfigSchema.parse({
      ...DEFAULT_SERVICE_CONFIG,
      worker: {
        kind: 'ssh',
        sshCommand: 'ssh',
        sshHost: 'worker.example.com',
        sshUser: 'agent',
        sshPort: 22,
        sshOptions: ['-o', 'BatchMode=yes'],
        remoteWorkspaceRoot: '/srv/agentfirst/workspaces',
      },
    }).worker.kind).toBe('ssh');
  });
});
