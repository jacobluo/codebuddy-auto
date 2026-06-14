import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

const createSessionMock = vi.fn((options: unknown) => ({ options }));

vi.mock('@tencent-ai/agent-sdk', () => ({
  unstable_v2_createSession: createSessionMock,
}));

describe('createSdkSession', () => {
  it('passes the default CodeBuddy SDK maxTurns without using agent.maxTurns', async () => {
    createSessionMock.mockClear();
    const { createSdkSession } = await import('../../src/runner/create-sdk-session.js');

    createSdkSession({
      cwd: '/tmp/workspace',
      abortController: new AbortController(),
      config: {
        ...DEFAULT_SERVICE_CONFIG,
        agent: {
          ...DEFAULT_SERVICE_CONFIG.agent,
          maxTurns: 30,
        },
      },
    });

    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({ maxTurns: 100 }));
    expect(createSessionMock).toHaveBeenCalledWith(expect.not.objectContaining({ maxTurns: 30 }));
  });

  it('passes codebuddy.sdkMaxTurns to the SDK when explicitly configured', async () => {
    createSessionMock.mockClear();
    const { createSdkSession } = await import('../../src/runner/create-sdk-session.js');

    createSdkSession({
      cwd: '/tmp/workspace',
      abortController: new AbortController(),
      config: {
        ...DEFAULT_SERVICE_CONFIG,
        codebuddy: {
          ...DEFAULT_SERVICE_CONFIG.codebuddy,
          sdkMaxTurns: 64,
        },
      },
    });

    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({ maxTurns: 64 }));
  });
});
