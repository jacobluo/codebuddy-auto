import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../../src/cli.js';
import type { Issue } from '../../src/spec/index.js';
import type { SchedulerRuntime } from '../../src/scheduler/index.js';
import { resolveWorkspacePath } from '../../src/workspace/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeExecutableScript(filePath: string, source: string): void {
  fs.writeFileSync(filePath, source, { encoding: 'utf8', mode: 0o755 });
}

function writeFakeSsh(runtimeRoot: string): string {
  const fakeSshPath = path.join(runtimeRoot, 'fake-ssh.mjs');
  writeExecutableScript(fakeSshPath, [
    "import { spawnSync } from 'node:child_process';",
    'const remoteScript = process.argv.at(-1);',
    "if (!remoteScript) { throw new Error('missing remote script'); }",
    "const result = spawnSync('sh', ['-lc', remoteScript], { stdio: 'inherit' });",
    'process.exit(result.status ?? 1);',
    '',
  ].join('\n'));
  return fakeSshPath;
}

function writeFakeCodebuddy(
  runtimeRoot: string,
  markerFileName = 'received-prompt.txt',
  result: 'success' | 'error' = 'success',
): string {
  const fakeCodebuddyPath = path.join(runtimeRoot, 'fake-codebuddy.mjs');
  const resultLine = result === 'success'
    ? "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, num_turns: 1 }));"
    : "console.log(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'simulated failure', errors: ['simulated failure'] }));";
  writeExecutableScript(fakeCodebuddyPath, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    'const prompt = process.argv.at(-1) ?? "";',
    `fs.writeFileSync(path.join(process.cwd(), ${JSON.stringify(markerFileName)}), prompt, 'utf8');`,
    "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'e2e-session' }));",
    resultLine,
    '',
  ].join('\n'));
  return fakeCodebuddyPath;
}

function writeWorkflow(input: {
  runtimeRoot: string;
  fakeSshPath: string;
  fakeCodebuddyPath: string;
  extraFrontMatter?: string[];
  hooks?: string[];
}): string {
  const workflowPath = path.join(input.runtimeRoot, 'WORKFLOW.md');
  fs.writeFileSync(workflowPath, [
    '---',
    'tracker:',
    '  kind: local',
    '  apiKey: token',
    'workspace:',
    '  root: ./workspaces',
    '  source_root: .',
    ...(input.hooks ? [
      'hooks:',
      ...input.hooks,
    ] : []),
    'worker:',
    '  kind: ssh',
    '  ssh_host: offline-host',
    `  ssh_command: node ${input.fakeSshPath}`,
    ...(input.extraFrontMatter ?? []),
    'agent:',
    '  max_turns: 1',
    '  max_retry_backoff_ms: 1000',
    'codebuddy:',
    `  command: node ${input.fakeCodebuddyPath}`,
    '  read_timeout_ms: 1000',
    '  turn_timeout_ms: 1000',
    '  stall_timeout_ms: 1000',
    '---',
    'Implement {{ issue.identifier }}: {{ issue.title }}',
    '',
    '{{ issue.description }}',
    '',
  ].join('\n'), 'utf8');
  return workflowPath;
}

function writeRawWorkflow(runtimeRoot: string, lines: string[]): string {
  const workflowPath = path.join(runtimeRoot, 'WORKFLOW.md');
  fs.writeFileSync(workflowPath, `${lines.join('\n')}\n`, 'utf8');
  return workflowPath;
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'e2e-issue-1',
    identifier: '#e2e-1',
    title: 'CLI smoke issue',
    description: 'Verify the run-once CLI path.',
    priority: null,
    state: 'open',
    branchName: null,
    url: null,
    labels: ['agent-ready'],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve(value: T) {
      if (!resolveFn) {
        throw new Error('deferred resolve was not initialized');
      }
      resolveFn(value);
    },
    reject(error: unknown) {
      if (!rejectFn) {
        throw new Error('deferred reject was not initialized');
      }
      rejectFn(error);
    },
  };
}

function createSseReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async next(): Promise<Record<string, string>> {
      while (!buffer.includes('\n\n')) {
        const result = await reader.read();
        if (result.done) {
          throw new Error('expected SSE event before stream closed');
        }
        buffer += decoder.decode(result.value, { stream: true });
      }

      const separatorIndex = buffer.indexOf('\n\n');
      const chunk = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const fields: Record<string, string> = {};
      for (const line of chunk.split('\n')) {
        if (!line || line.startsWith(':')) {
          continue;
        }
        const [name, ...rest] = line.split(':');
        if (name) {
          fields[name] = rest.join(':').trimStart();
        }
      }
      return fields;
    },
    async close(): Promise<void> {
      await reader.cancel();
    },
  };
}

describe('CLI run-once end-to-end smoke', () => {
  it('returns 1 for workflow preflight errors from real config loading', async () => {
    const runtimeRoot = makeTempDir('codebuddy-auto-e2e-invalid-');
    const workflowPath = writeRawWorkflow(runtimeRoot, [
      '---',
      'tracker:',
      '  kind: local',
      '  apiKey: token',
      'workspace:',
      '  root: ./missing-workspaces',
      '  source_root: .',
      '---',
      'Prompt',
    ]);

    await expect(runCli(['node', 'codebuddy-auto', 'check', workflowPath])).resolves.toBe(1);
  });

  it('returns 1 when ssh worker config is missing ssh_host', async () => {
    const runtimeRoot = makeTempDir('codebuddy-auto-e2e-invalid-ssh-');
    fs.mkdirSync(path.join(runtimeRoot, 'workspaces'), { recursive: true });
    const workflowPath = writeRawWorkflow(runtimeRoot, [
      '---',
      'tracker:',
      '  kind: local',
      '  apiKey: token',
      'workspace:',
      '  root: ./workspaces',
      '  source_root: .',
      'worker:',
      '  kind: ssh',
      '---',
      'Prompt',
    ]);

    await expect(runCli(['node', 'codebuddy-auto', 'check', workflowPath])).resolves.toBe(1);
  });

  it('loads a workflow, reads a local issue, creates a workspace, and invokes the CLI worker command', async () => {
    const runtimeRoot = makeTempDir('codebuddy-auto-e2e-');
    const workspaceRoot = path.join(runtimeRoot, 'workspaces');
    const trackerRoot = path.join(workspaceRoot, '.tracker');
    fs.mkdirSync(trackerRoot, { recursive: true });

    const fakeSshPath = writeFakeSsh(runtimeRoot);
    const fakeCodebuddyPath = writeFakeCodebuddy(runtimeRoot);
    const issue = makeIssue();
    fs.writeFileSync(path.join(trackerRoot, `${issue.id}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8');

    const workflowPath = writeWorkflow({ runtimeRoot, fakeSshPath, fakeCodebuddyPath });

    await expect(runCli(['node', 'codebuddy-auto', workflowPath])).resolves.toBe(0);

    const workspacePath = resolveWorkspacePath(workspaceRoot, issue.identifier);
    const receivedPrompt = fs.readFileSync(path.join(workspacePath, 'received-prompt.txt'), 'utf8');

    expect(receivedPrompt).toContain('Implement #e2e-1: CLI smoke issue');
    expect(receivedPrompt).toContain('Verify the run-once CLI path.');
  });

  it('does not create issue workspaces or invoke the worker command when there are no candidate issues', async () => {
    const runtimeRoot = makeTempDir('codebuddy-auto-e2e-empty-');
    const workspaceRoot = path.join(runtimeRoot, 'workspaces');
    const trackerRoot = path.join(workspaceRoot, '.tracker');
    fs.mkdirSync(trackerRoot, { recursive: true });

    const fakeSshPath = writeFakeSsh(runtimeRoot);
    const fakeCodebuddyPath = writeFakeCodebuddy(runtimeRoot, 'unexpected-worker-call.txt');
    const workflowPath = writeWorkflow({ runtimeRoot, fakeSshPath, fakeCodebuddyPath });

    await expect(runCli(['node', 'codebuddy-auto', workflowPath])).resolves.toBe(0);

    const workspaceEntries = fs.readdirSync(workspaceRoot).filter((entry) => entry !== '.tracker');

    expect(workspaceEntries).toEqual([]);
  });

  it('keeps the run-once CLI stable when the worker reports a turn failure', async () => {
    const runtimeRoot = makeTempDir('codebuddy-auto-e2e-failure-');
    const workspaceRoot = path.join(runtimeRoot, 'workspaces');
    const trackerRoot = path.join(workspaceRoot, '.tracker');
    fs.mkdirSync(trackerRoot, { recursive: true });

    const fakeSshPath = writeFakeSsh(runtimeRoot);
    const fakeCodebuddyPath = writeFakeCodebuddy(runtimeRoot, 'failed-prompt.txt', 'error');
    const issue = makeIssue({ id: 'e2e-failing-issue', identifier: '#e2e-fail' });
    fs.writeFileSync(path.join(trackerRoot, `${issue.id}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8');
    const workflowPath = writeWorkflow({ runtimeRoot, fakeSshPath, fakeCodebuddyPath });

    await expect(runCli(['node', 'codebuddy-auto', workflowPath])).resolves.toBe(0);

    const workspacePath = resolveWorkspacePath(workspaceRoot, issue.identifier);
    const receivedPrompt = fs.readFileSync(path.join(workspacePath, 'failed-prompt.txt'), 'utf8');

    expect(receivedPrompt).toContain('Implement #e2e-fail: CLI smoke issue');
  });

  it('runs before_run hooks before invoking the worker command', async () => {
    const runtimeRoot = makeTempDir('codebuddy-auto-e2e-before-run-');
    const workspaceRoot = path.join(runtimeRoot, 'workspaces');
    const trackerRoot = path.join(workspaceRoot, '.tracker');
    fs.mkdirSync(trackerRoot, { recursive: true });

    const fakeSshPath = writeFakeSsh(runtimeRoot);
    const fakeCodebuddyPath = writeFakeCodebuddy(runtimeRoot);
    const issue = makeIssue({ id: 'e2e-hook-issue', identifier: '#e2e-hook' });
    fs.writeFileSync(path.join(trackerRoot, `${issue.id}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8');
    const workflowPath = writeWorkflow({
      runtimeRoot,
      fakeSshPath,
      fakeCodebuddyPath,
      hooks: [
        '  before_run: printf hook-ran > before-run.txt',
      ],
    });

    await expect(runCli(['node', 'codebuddy-auto', workflowPath])).resolves.toBe(0);

    const workspacePath = resolveWorkspacePath(workspaceRoot, issue.identifier);

    expect(fs.readFileSync(path.join(workspacePath, 'before-run.txt'), 'utf8')).toBe('hook-ran');
    expect(fs.existsSync(path.join(workspacePath, 'received-prompt.txt'))).toBe(true);
  });

  it('does not invoke the worker command when before_run hook fails', async () => {
    const runtimeRoot = makeTempDir('codebuddy-auto-e2e-before-run-fail-');
    const workspaceRoot = path.join(runtimeRoot, 'workspaces');
    const trackerRoot = path.join(workspaceRoot, '.tracker');
    fs.mkdirSync(trackerRoot, { recursive: true });

    const fakeSshPath = writeFakeSsh(runtimeRoot);
    const fakeCodebuddyPath = writeFakeCodebuddy(runtimeRoot);
    const issue = makeIssue({ id: 'e2e-hook-fail-issue', identifier: '#e2e-hook-fail' });
    fs.writeFileSync(path.join(trackerRoot, `${issue.id}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8');
    const workflowPath = writeWorkflow({
      runtimeRoot,
      fakeSshPath,
      fakeCodebuddyPath,
      hooks: [
        '  before_run: printf blocked > before-run.txt; exit 7',
      ],
    });

    await expect(runCli(['node', 'codebuddy-auto', workflowPath])).resolves.toBe(0);

    const workspacePath = resolveWorkspacePath(workspaceRoot, issue.identifier);

    expect(fs.readFileSync(path.join(workspacePath, 'before-run.txt'), 'utf8')).toBe('blocked');
    expect(fs.existsSync(path.join(workspacePath, 'received-prompt.txt'))).toBe(false);
  });

  it('runs after_run hooks after a successful worker command', async () => {
    const runtimeRoot = makeTempDir('codebuddy-auto-e2e-after-run-');
    const workspaceRoot = path.join(runtimeRoot, 'workspaces');
    const trackerRoot = path.join(workspaceRoot, '.tracker');
    fs.mkdirSync(trackerRoot, { recursive: true });

    const fakeSshPath = writeFakeSsh(runtimeRoot);
    const fakeCodebuddyPath = writeFakeCodebuddy(runtimeRoot);
    const issue = makeIssue({ id: 'e2e-after-run-issue', identifier: '#e2e-after' });
    fs.writeFileSync(path.join(trackerRoot, `${issue.id}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8');
    const workflowPath = writeWorkflow({
      runtimeRoot,
      fakeSshPath,
      fakeCodebuddyPath,
      hooks: [
        '  after_run: test -f received-prompt.txt && printf after-ran > after-run.txt',
      ],
    });

    await expect(runCli(['node', 'codebuddy-auto', workflowPath])).resolves.toBe(0);

    const workspacePath = resolveWorkspacePath(workspaceRoot, issue.identifier);

    expect(fs.readFileSync(path.join(workspacePath, 'after-run.txt'), 'utf8')).toBe('after-ran');
  });

  it('keeps run-once stable when after_run hook fails', async () => {
    const runtimeRoot = makeTempDir('codebuddy-auto-e2e-after-run-fail-');
    const workspaceRoot = path.join(runtimeRoot, 'workspaces');
    const trackerRoot = path.join(workspaceRoot, '.tracker');
    fs.mkdirSync(trackerRoot, { recursive: true });

    const fakeSshPath = writeFakeSsh(runtimeRoot);
    const fakeCodebuddyPath = writeFakeCodebuddy(runtimeRoot);
    const issue = makeIssue({ id: 'e2e-after-run-fail-issue', identifier: '#e2e-after-fail' });
    fs.writeFileSync(path.join(trackerRoot, `${issue.id}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8');
    const workflowPath = writeWorkflow({
      runtimeRoot,
      fakeSshPath,
      fakeCodebuddyPath,
      hooks: [
        '  after_run: printf failed-after > after-run.txt; exit 9',
      ],
    });

    await expect(runCli(['node', 'codebuddy-auto', workflowPath])).resolves.toBe(0);

    const workspacePath = resolveWorkspacePath(workspaceRoot, issue.identifier);

    expect(fs.readFileSync(path.join(workspacePath, 'after-run.txt'), 'utf8')).toBe('failed-after');
    expect(fs.existsSync(path.join(workspacePath, 'received-prompt.txt'))).toBe(true);
  });

  it('starts the daemon status server and serves dashboard API endpoints', async () => {
    const runtimeRoot = makeTempDir('codebuddy-auto-e2e-daemon-');
    const workspaceRoot = path.join(runtimeRoot, 'workspaces');
    const trackerRoot = path.join(workspaceRoot, '.tracker');
    fs.mkdirSync(trackerRoot, { recursive: true });

    const fakeSshPath = writeFakeSsh(runtimeRoot);
    const fakeCodebuddyPath = writeFakeCodebuddy(runtimeRoot);
    const workflowPath = writeWorkflow({
      runtimeRoot,
      fakeSshPath,
      fakeCodebuddyPath,
      extraFrontMatter: [
        'server:',
        '  port: 0',
      ],
    });
    const serverAddress = deferred<string>();
    const releaseShutdown = deferred<void>();
    const requestTick = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const startScheduler = vi.fn((): SchedulerRuntime => ({
      requestTick,
      stop,
    }));

    const cliRun = runCli(['node', 'codebuddy-auto', 'daemon', workflowPath], {
      startScheduler,
      waitForShutdownSignal: async () => releaseShutdown.promise,
      startStatusServer: async (config, controller, eventBus) => {
        const { startStatusServer } = await import('../../src/logging/index.js');
        const server = await startStatusServer(config, controller, eventBus);
        const address = server.address();
        if (!address) {
          throw new Error('expected status server address');
        }
        serverAddress.resolve(address);
        return server;
      },
    });

    try {
      const address = await serverAddress.promise;
      const bootstrapResponse = await fetch(`${address}/api/v1/dashboard/bootstrap`);
      expect(bootstrapResponse.status).toBe(200);
      await expect(bootstrapResponse.json()).resolves.toMatchObject({
        config: {
          tracker: {
            kind: 'local',
          },
          worker: {
            kind: 'ssh',
          },
        },
        repoUrl: 'https://cnb.cool/repo/demo',
      });

      const refreshResponse = await fetch(`${address}/api/v1/refresh`, { method: 'POST' });
      expect(refreshResponse.status).toBe(202);
      await expect(refreshResponse.json()).resolves.toMatchObject({
        queued: true,
        operations: ['poll', 'reconcile'],
      });

      expect(requestTick).toHaveBeenCalledTimes(1);

      const sseResponse = await fetch(`${address}/api/v1/events`);
      expect(sseResponse.status).toBe(200);
      if (!sseResponse.body) {
        throw new Error('expected SSE response body');
      }
      const sse = createSseReader(sseResponse.body);
      try {
        const snapshotEvent = await sse.next();
        expect(snapshotEvent.event).toBe('state_snapshot');
        if (!snapshotEvent.data) {
          throw new Error('expected SSE data payload');
        }
        expect(JSON.parse(snapshotEvent.data)).toMatchObject({
          type: 'state_snapshot',
          payload: {
            counts: {
              running: 0,
              retrying: 0,
            },
          },
        });
      } finally {
        await sse.close();
      }
    } finally {
      releaseShutdown.resolve();
    }

    await expect(cliRun).resolves.toBe(0);
    expect(startScheduler).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
