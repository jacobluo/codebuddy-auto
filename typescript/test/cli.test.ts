import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli.js';
import { DEFAULT_SERVICE_CONFIG } from '../src/spec/index.js';
import * as schedulerModule from '../src/scheduler/index.js';

const tempDirs: string[] = [];
let runDispatchCycleSpy: ReturnType<typeof vi.spyOn> | null = null;
const originalCwd = process.cwd();

beforeEach(() => {
  runDispatchCycleSpy = vi.spyOn(schedulerModule, 'runDispatchCycle') as ReturnType<typeof vi.spyOn>;
});

afterEach(() => {
  process.chdir(originalCwd);
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

function createTempCwd(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-init-'));
  tempDirs.push(dir);
  process.chdir(dir);
  return dir;
}

describe('runCli', () => {
  it('initializes with editable placeholder values when project options are omitted', async () => {
    const dir = createTempCwd();

    await expect(runCli(['node', 'codebuddy-auto', 'init'])).resolves.toBe(0);

    const workflow = fs.readFileSync(path.join(dir, 'WORKFLOW.md'), 'utf8');
    expect(workflow).toContain('projectSlug: your-org/your-repo');
    expect(workflow).toContain('git clone https://cnb.cool/your-org/your-repo.git .');
    expect(fs.existsSync(path.join(dir, '.codebuddy-auto/workspaces'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.env'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.env.example'))).toBe(false);
  });

  it('prompts for project options during init when a prompt dependency is provided', async () => {
    const dir = createTempCwd();
    const promptInitOptions = vi.fn(async () => ({
      project: 'relaxorg/symphony_repo_crm',
      repoUrl: 'https://cnb.cool/relaxorg/symphony_repo_crm.git',
    }));

    await expect(runCli(['node', 'codebuddy-auto', 'init'], {
      promptInitOptions,
    })).resolves.toBe(0);

    expect(promptInitOptions).toHaveBeenCalledWith({
      project: 'your-org/your-repo',
      repoUrl: 'https://cnb.cool/your-org/your-repo.git',
    });

    const workflow = fs.readFileSync(path.join(dir, 'WORKFLOW.md'), 'utf8');
    expect(workflow).toContain('projectSlug: relaxorg/symphony_repo_crm');
    expect(workflow).toContain('git clone https://cnb.cool/relaxorg/symphony_repo_crm.git .');
  });

  it('initializes the current directory with a workflow and workspace root', async () => {
    const dir = createTempCwd();

    await expect(runCli([
      'node',
      'codebuddy-auto',
      'init',
      '--project',
      'relaxorg/symphony_repo_crm',
      '--repo-url',
      'https://cnb.cool/relaxorg/symphony_repo_crm.git',
    ])).resolves.toBe(0);

    const workflow = fs.readFileSync(path.join(dir, 'WORKFLOW.md'), 'utf8');
    expect(workflow).toContain('projectSlug: relaxorg/symphony_repo_crm');
    expect(workflow).toContain('apiKey: $CNB_TOKEN');
    expect(workflow).toContain('root: ./.codebuddy-auto/workspaces');
    expect(workflow).toContain('source_root: .');
    expect(workflow).toContain('no_progress_threshold: 3');
    expect(workflow).toContain('git clone https://cnb.cool/relaxorg/symphony_repo_crm.git .');
    expect(workflow).toContain('{{ issue.description }}');
    expect(fs.existsSync(path.join(dir, '.codebuddy-auto/workspaces'))).toBe(true);
  });

  it('does not create or overwrite env files during init', async () => {
    const dir = createTempCwd();
    const envPath = path.join(dir, '.env');
    fs.writeFileSync(envPath, 'CNB_TOKEN=keep-me\n', 'utf8');

    await expect(runCli(['node', 'codebuddy-auto', 'init', '--force'])).resolves.toBe(0);

    expect(fs.readFileSync(envPath, 'utf8')).toBe('CNB_TOKEN=keep-me\n');
  });

  it('does not overwrite an existing workflow during init unless forced', async () => {
    const dir = createTempCwd();
    const workflowPath = path.join(dir, 'WORKFLOW.md');
    fs.writeFileSync(workflowPath, 'custom workflow\n', 'utf8');

    await expect(runCli([
      'node',
      'codebuddy-auto',
      'init',
      '--project',
      'relaxorg/symphony_repo_crm',
      '--repo-url',
      'https://cnb.cool/relaxorg/symphony_repo_crm.git',
    ])).resolves.toBe(1);

    expect(fs.readFileSync(workflowPath, 'utf8')).toBe('custom workflow\n');

    await expect(runCli([
      'node',
      'codebuddy-auto',
      'init',
      '--project',
      'relaxorg/symphony_repo_crm',
      '--repo-url',
      'https://cnb.cool/relaxorg/symphony_repo_crm.git',
      '--force',
    ])).resolves.toBe(0);

    expect(fs.readFileSync(workflowPath, 'utf8')).toContain('projectSlug: relaxorg/symphony_repo_crm');
  });

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

    await expect(runCli(['node', 'codebuddy-auto', 'check', workflowPath])).resolves.toBe(0);
  });

  it('returns 1 when the workflow is missing', async () => {
    await expect(runCli(['node', 'codebuddy-auto', 'check', '/missing/WORKFLOW.md'])).resolves.toBe(1);
  });

  it('rejects legacy top-level mode flags before loading the workflow', async () => {
    const createWorkflowRuntimeSource = vi.fn();

    for (const flag of ['--check', '--daemon', '--status']) {
      await expect(runCli(['node', 'codebuddy-auto', flag], {
        createWorkflowRuntimeSource,
      })).resolves.toBe(1);
    }

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
      runCli(['node', 'codebuddy-auto', 'daemon', workflowPath], {
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
          agent: { maxConcurrentAgents: 10, maxTurns: 20, maxRetryBackoffMs: 300000, maxConcurrentAgentsByState: {}, noProgressThreshold: 3 },
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
      runCli(['node', 'codebuddy-auto', 'daemon', workflowPath], {
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

  it('does not start the scheduler when the status server fails to bind', async () => {
    const workflowPath = createWorkflow([
      '---',
      'tracker:',
      '  kind: local',
      '  apiKey: token',
      'workspace:',
      '  root: .',
      'server:',
      '  port: 4317',
      '---',
      'Prompt',
      '',
    ].join('\n'));
    const requestTick = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const startScheduler = vi.fn(() => ({ requestTick, stop }));
    const startStatusServer = vi.fn(async () => {
      throw new Error('dashboard server port 127.0.0.1:4317 is already in use');
    });

    await expect(
      runCli(['node', 'codebuddy-auto', 'daemon', workflowPath], {
        startScheduler,
        startStatusServer,
        waitForShutdownSignal: vi.fn(async () => undefined),
      }),
    ).resolves.toBe(1);

    expect(startStatusServer).toHaveBeenCalledTimes(1);
    expect(startScheduler).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
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

    await expect(runCli(['node', 'codebuddy-auto', 'status', workflowPath])).resolves.toBe(0);

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
          agent: { maxConcurrentAgents: 10, maxTurns: 20, maxRetryBackoffMs: 300000, maxConcurrentAgentsByState: {}, noProgressThreshold: 3 },
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

    await expect(runCli(['node', 'codebuddy-auto', 'check', workflowPath, '--reload'], {
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
          agent: { maxConcurrentAgents: 10, maxTurns: 20, maxRetryBackoffMs: 300000, maxConcurrentAgentsByState: {}, noProgressThreshold: 3 },
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

    await expect(runCli(['node', 'codebuddy-auto', 'daemon', workflowPath, '--reload'], {
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
