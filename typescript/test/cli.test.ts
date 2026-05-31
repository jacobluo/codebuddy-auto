import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli.js';
import { DEFAULT_SERVICE_CONFIG } from '../src/spec/index.js';
import * as schedulerModule from '../src/scheduler/index.js';

const tempDirs: string[] = [];
let runDispatchCycleSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  runDispatchCycleSpy = vi.spyOn(schedulerModule, 'runDispatchCycle') as ReturnType<typeof vi.spyOn>;
});

afterEach(() => {
  runDispatchCycleSpy?.mockRestore();
  runDispatchCycleSpy = null;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkflow(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-cli-'));
  tempDirs.push(dir);
  const workflowPath = path.join(dir, 'WORKFLOW.md');
  fs.writeFileSync(workflowPath, contents);
  return workflowPath;
}

describe('runCli', () => {
  it('returns 0 for a valid workflow in check mode', async () => {
    const workflowPath = createWorkflow([
      '---',
      'tracker:',
      '  kind: cnb',
      '  apiKey: token',
      'workspace:',
      '  root: .',
      '---',
      'Prompt',
      '',
    ].join('\n'));

    await expect(runCli(['node', 'codebuddy-auto', workflowPath, '--check'])).resolves.toBe(0);
  });

  it('returns 1 when the workflow is missing', async () => {
    await expect(runCli(['node', 'codebuddy-auto', '/missing/WORKFLOW.md', '--check'])).resolves.toBe(1);
  });

  it('rejects incompatible check and daemon flags before loading the workflow', async () => {
    const createWorkflowRuntimeSource = vi.fn();

    await expect(runCli(['node', 'codebuddy-auto', 'WORKFLOW.md', '--check', '--daemon'], {
      createWorkflowRuntimeSource,
    })).resolves.toBe(1);

    expect(createWorkflowRuntimeSource).not.toHaveBeenCalled();
  });

  it('passes the workflow prompt template into the dispatch cycle', async () => {
    const workflowPath = createWorkflow([
      '---',
      'tracker:',
      '  kind: local',
      '  apiKey: token',
      'workspace:',
      '  root: .',
      'codebuddy:',
      '  command: node -e "console.log(JSON.stringify({type:\'result\',subtype:\'success\',is_error:false}))"',
      '---',
      'Implement {{ issue.identifier }} with {{ issue.title }}',
      '',
    ].join('\n'));

    if (!runDispatchCycleSpy) {
      throw new Error('runDispatchCycle spy was not initialized');
    }

    runDispatchCycleSpy.mockResolvedValue({
      availableSlots: 10,
      dispatchableIssueIds: [],
      claimedIssueIds: [],
    });

    await expect(runCli(['node', 'codebuddy-auto', workflowPath])).resolves.toBe(0);

    expect(runDispatchCycleSpy).toHaveBeenCalledTimes(1);
    const promptTemplate = (runDispatchCycleSpy.mock.calls[0] as unknown[] | undefined)?.[3];
    expect(promptTemplate).toBe('Implement {{ issue.identifier }} with {{ issue.title }}');
  });

  it('starts the polling scheduler in daemon mode', async () => {
    const workflowPath = createWorkflow([
      '---',
      'tracker:',
      '  kind: local',
      '  apiKey: token',
      'workspace:',
      '  root: .',
      '---',
      'Prompt',
      '',
    ].join('\n'));
    const requestTick = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const startScheduler = vi.fn(() => ({ requestTick, stop }));
    const waitForShutdownSignal = vi.fn(async () => undefined);

    await expect(
      runCli(['node', 'codebuddy-auto', workflowPath, '--daemon'], {
        startScheduler,
        waitForShutdownSignal,
      }),
    ).resolves.toBe(0);

    expect(startScheduler).toHaveBeenCalledTimes(1);
    expect(waitForShutdownSignal).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(requestTick).not.toHaveBeenCalled();
    expect(runDispatchCycleSpy).not.toHaveBeenCalled();
  });

  it('starts and stops the status server in daemon mode when server.port is configured', async () => {
    const workflowPath = createWorkflow([
      '---',
      'tracker:',
      '  kind: local',
      '  apiKey: token',
      'workspace:',
      '  root: .',
      'server:',
      '  port: 0',
      '---',
      'Prompt',
      '',
    ].join('\n'));
    const runtimeSource = {
      getCurrent: vi.fn(() => ({
        workflowPath,
        promptTemplate: 'Prompt',
        config: {
          tracker: { kind: 'local', apiKey: 'token', activeStates: ['open'], terminalStates: ['closed'] },
          polling: { intervalMs: 1000 },
          workspace: { ...DEFAULT_SERVICE_CONFIG.workspace, root: '.' },
          hooks: { timeoutMs: 60000 },
          server: { host: '127.0.0.1', port: 0 },
          agent: { maxConcurrentAgents: 10, maxTurns: 20, maxRetryBackoffMs: 300000, maxConcurrentAgentsByState: {} },
          worker: { ...DEFAULT_SERVICE_CONFIG.worker },
          codebuddy: { command: 'codebuddy', dangerouslySkipPermissions: false, mcpStrict: true, turnTimeoutMs: 3600000, readTimeoutMs: 5000, stallTimeoutMs: 300000 },
        },
        tracker: {
          fetchCandidateIssues: async () => [],
          fetchIssuesByStates: async () => [],
          fetchIssueStatesByIds: async () => new Map(),
        },
      })),
      reload: vi.fn(async () => ({
        ok: true,
        errors: [],
        workflowPath,
      })),
    };
    const requestTick = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const startScheduler = vi.fn(() => ({ requestTick, stop }));
    const startStatusServer = vi.fn(async (_config, controller) => {
      controller.requestRefresh();
      return {
        address: () => 'http://127.0.0.1:4321',
        close: vi.fn(async () => undefined),
      };
    });

    await expect(
      runCli(['node', 'codebuddy-auto', workflowPath, '--daemon'], {
        createWorkflowRuntimeSource: vi.fn(async () => runtimeSource),
        startScheduler,
        startStatusServer,
        waitForShutdownSignal: vi.fn(async () => {
          await Promise.resolve();
          await Promise.resolve();
        }),
      }),
    ).resolves.toBe(0);

    expect(startStatusServer).toHaveBeenCalledTimes(1);
    expect(requestTick).toHaveBeenCalledTimes(1);
    const statusServer = await startStatusServer.mock.results[0]?.value;
    expect(statusServer?.close).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('prints a human-readable runtime status snapshot', async () => {
    const workflowPath = createWorkflow([
      '---',
      'tracker:',
      '  kind: local',
      '  apiKey: token',
      'workspace:',
      '  root: .',
      '---',
      'Prompt',
      '',
    ].join('\n'));
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runCli(['node', 'codebuddy-auto', workflowPath, '--status'])).resolves.toBe(0);

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('counts: running=0 retrying=0 claimed=0 completed=0'));
    stdoutWrite.mockRestore();
  });

  it('reloads workflow/config before running when requested', async () => {
    const workflowPath = createWorkflow([
      '---',
      'tracker:',
      '  kind: local',
      '  apiKey: token',
      'workspace:',
      '  root: .',
      '---',
      'Prompt',
      '',
    ].join('\n'));
    const runtimeSource = {
      getCurrent: vi.fn(() => ({
        workflowPath,
        promptTemplate: 'Prompt',
        config: {
          tracker: { kind: 'local', apiKey: 'token', activeStates: ['open'], terminalStates: ['closed'] },
          polling: { intervalMs: 1000 },
          workspace: { ...DEFAULT_SERVICE_CONFIG.workspace, root: '.' },
          hooks: { timeoutMs: 60000 },
          server: { host: '127.0.0.1' },
          agent: { maxConcurrentAgents: 10, maxTurns: 20, maxRetryBackoffMs: 300000, maxConcurrentAgentsByState: {} },
          worker: { ...DEFAULT_SERVICE_CONFIG.worker },
          codebuddy: { command: 'codebuddy', dangerouslySkipPermissions: false, mcpStrict: true, turnTimeoutMs: 3600000, readTimeoutMs: 5000, stallTimeoutMs: 300000 },
        },
        tracker: {
          fetchCandidateIssues: async () => [],
          fetchIssuesByStates: async () => [],
          fetchIssueStatesByIds: async () => new Map(),
        },
      })),
      reload: vi.fn(async () => ({
        ok: true,
        errors: [],
        workflowPath,
      })),
    };

    await expect(runCli(['node', 'codebuddy-auto', workflowPath, '--check', '--reload'], {
      createWorkflowRuntimeSource: vi.fn(async () => runtimeSource),
    })).resolves.toBe(0);

    expect(runtimeSource.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads daemon tick context before each scheduler tick when reload mode is enabled', async () => {
    const workflowPath = createWorkflow([
      '---',
      'tracker:',
      '  kind: local',
      '  apiKey: token',
      'workspace:',
      '  root: .',
      '---',
      'Prompt',
      '',
    ].join('\n'));
    const runtimeSource = {
      getCurrent: vi.fn(() => ({
        workflowPath,
        promptTemplate: 'Prompt',
        config: {
          tracker: { kind: 'local', apiKey: 'token', activeStates: ['open'], terminalStates: ['closed'] },
          polling: { intervalMs: 1000 },
          workspace: { ...DEFAULT_SERVICE_CONFIG.workspace, root: '.' },
          hooks: { timeoutMs: 60000 },
          server: { host: '127.0.0.1' },
          agent: { maxConcurrentAgents: 10, maxTurns: 20, maxRetryBackoffMs: 300000, maxConcurrentAgentsByState: {} },
          worker: { ...DEFAULT_SERVICE_CONFIG.worker },
          codebuddy: { command: 'codebuddy', dangerouslySkipPermissions: false, mcpStrict: true, turnTimeoutMs: 3600000, readTimeoutMs: 5000, stallTimeoutMs: 300000 },
        },
        tracker: {
          fetchCandidateIssues: async () => [],
          fetchIssuesByStates: async () => [],
          fetchIssueStatesByIds: async () => new Map(),
        },
      })),
      reload: vi.fn(async () => ({
        ok: true,
        errors: [],
        workflowPath,
      })),
    };
    const requestTick = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const startScheduler = vi.fn((_tracker, _config, _logger, dependencies) => {
      if (!dependencies?.getTickContext) {
        throw new Error('missing getTickContext');
      }

      return {
        requestTick,
        stop,
      };
    });

    await expect(runCli(['node', 'codebuddy-auto', workflowPath, '--daemon', '--reload'], {
      createWorkflowRuntimeSource: vi.fn(async () => runtimeSource),
      startScheduler,
      waitForShutdownSignal: vi.fn(async () => undefined),
    })).resolves.toBe(0);

    const schedulerDependencies = startScheduler.mock.calls[0]?.[3] as { getTickContext?: () => Promise<unknown> } | undefined;
    expect(schedulerDependencies?.getTickContext).toBeTypeOf('function');
    await schedulerDependencies?.getTickContext?.();
    expect(runtimeSource.reload).toHaveBeenCalledTimes(2);
  });
});
