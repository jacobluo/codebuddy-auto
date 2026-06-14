import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkflowRuntimeSource } from '../../src/config/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';
import type { TranscriptStore } from '../../src/transcript/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkflow(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-runtime-source-'));
  tempDirs.push(dir);
  const workflowPath = path.join(dir, 'WORKFLOW.md');
  fs.writeFileSync(workflowPath, contents, 'utf8');
  return workflowPath;
}

function createFakeTranscriptStore(): TranscriptStore {
  return {
    recordSession: vi.fn(() => {
      throw new Error('not implemented in test');
    }),
    recordEvent: vi.fn(() => {
      throw new Error('not implemented in test');
    }),
    listEvents: vi.fn(() => []),
    recordDashboardEvent: vi.fn((input) => input),
    listDashboardEvents: vi.fn(() => []),
    getLatestDashboardEventId: vi.fn(() => 0),
    close: vi.fn(),
  };
}

describe('createWorkflowRuntimeSource', () => {
  it('loads the initial runtime snapshot from workflow and config', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
---
Implement {{ issue.identifier }}
`);

    const runtimeSource = await createWorkflowRuntimeSource(workflowPath);
    const runtime = runtimeSource.getCurrent();

    expect(runtime.workflowPath).toBe(workflowPath);
    expect(runtime.promptTemplate).toBe('Implement {{ issue.identifier }}');
    expect(runtime.config.tracker.kind).toBe('local');
  });

  it('keeps the last known good runtime when reload fails', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
---
Prompt A
`);

    const runtimeSource = await createWorkflowRuntimeSource(workflowPath);

    fs.writeFileSync(workflowPath, `---
tracker:
  kind: cnb
workspace:
  root: .
---
Prompt B
`, 'utf8');

    const reload = await runtimeSource.reload();

    expect(reload.ok).toBe(false);
    expect(reload.errors[0]).toContain('tracker.apiKey is required');
    expect(runtimeSource.getCurrent().promptTemplate).toBe('Prompt A');
  });


  it('keeps the last known good runtime when git-worktree reload preflight fails', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
---
Prompt A
`);
    const runtimeDir = path.dirname(workflowPath);
    fs.mkdirSync(path.join(runtimeDir, '.codebuddy-auto-workspaces'), { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'README.md'), 'seed\n', 'utf8');
    const previousCwd = process.cwd();
    process.chdir(runtimeDir);
    fs.writeFileSync(path.join(runtimeDir, '.gitignore'), '.codebuddy-auto-workspaces\n', 'utf8');
    execFileSync('git', ['init'], { cwd: runtimeDir, stdio: 'ignore' });
    execFileSync('git', ['add', 'README.md', '.gitignore'], { cwd: runtimeDir, stdio: 'ignore' });
    execFileSync(
      'git',
      ['-c', 'user.name=codebuddy-auto', '-c', 'user.email=codebuddy-auto@example.com', 'commit', '-m', 'init'],
      { cwd: runtimeDir, stdio: 'ignore' },
    );

    const runtimeSource = await createWorkflowRuntimeSource(workflowPath);

    fs.writeFileSync(workflowPath, `---
tracker:
  kind: local
  apiKey: token
workspace:
  root: ./.codebuddy-auto-workspaces
  mode: git-worktree
  source_root: .
---
Prompt B
`, 'utf8');

    const reload = await runtimeSource.reload();

    expect(reload.ok).toBe(false);
    expect(reload.errors[0]).toContain('workspace.root must not be inside workspace.sourceRoot in git-worktree mode');
    expect(runtimeSource.getCurrent().promptTemplate).toBe('Prompt A');
    expect(runtimeSource.getCurrent().config.workspace.mode).toBe('directory');
    process.chdir(previousCwd);
  });

  it('updates the current runtime after a successful reload', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
---
Prompt A
`);

    const runtimeSource = await createWorkflowRuntimeSource(workflowPath);

    fs.writeFileSync(workflowPath, `---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
polling:
  interval_ms: 1500
---
Prompt B
`, 'utf8');

    const reload = await runtimeSource.reload();

    expect(reload).toEqual({
      ok: true,
      errors: [],
      workflowPath,
    });
    expect(runtimeSource.getCurrent().promptTemplate).toBe('Prompt B');
    expect(runtimeSource.getCurrent().config.polling.intervalMs).toBe(1500);
  });

  it('uses the injected tracker factory when provided', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
---
Prompt
`);
    const createTracker = vi.fn(() => ({
      fetchCandidateIssues: async () => [],
      fetchIssuesByStates: async () => [],
      fetchIssueStatesByIds: async () => new Map(),
    }));

    const runtimeSource = await createWorkflowRuntimeSource(workflowPath, process.env, { createTracker });

    expect(createTracker).toHaveBeenCalledWith(expect.objectContaining({ tracker: expect.objectContaining({ kind: 'local' }) }));
    expect(runtimeSource.getCurrent().tracker).toBeDefined();
  });

  it('opens a SQLite transcript store for the loaded workflow config', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
---
Prompt
`);
    const transcriptStore = createFakeTranscriptStore();
    const openSqliteTranscriptStore = vi.fn(() => transcriptStore);

    const runtimeSource = await createWorkflowRuntimeSource(workflowPath, process.env, {
      openSqliteTranscriptStore,
    });

    expect(openSqliteTranscriptStore).toHaveBeenCalledWith({
      sqlitePath: path.join(path.dirname(workflowPath), '.codebuddy-auto/transcripts.sqlite'),
    });
    expect(runtimeSource.getCurrent().transcriptStore).toBe(transcriptStore);
  });

  it('uses a disabled transcript store when transcript persistence is disabled', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
transcript:
  enabled: false
---
Prompt
`);
    const transcriptStore = createFakeTranscriptStore();
    const createDisabledTranscriptStore = vi.fn(() => transcriptStore);
    const openSqliteTranscriptStore = vi.fn();

    const runtimeSource = await createWorkflowRuntimeSource(workflowPath, process.env, {
      createDisabledTranscriptStore,
      openSqliteTranscriptStore,
    });

    expect(createDisabledTranscriptStore).toHaveBeenCalledTimes(1);
    expect(openSqliteTranscriptStore).not.toHaveBeenCalled();
    expect(runtimeSource.getCurrent().transcriptStore).toBe(transcriptStore);
  });

  it('closes the previous transcript store after a successful reload', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
---
Prompt A
`);
    const firstStore = createFakeTranscriptStore();
    const secondStore = createFakeTranscriptStore();
    const openSqliteTranscriptStore = vi.fn()
      .mockReturnValueOnce(firstStore)
      .mockReturnValueOnce(secondStore);
    const runtimeSource = await createWorkflowRuntimeSource(workflowPath, process.env, {
      openSqliteTranscriptStore,
    });

    fs.writeFileSync(workflowPath, `---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
transcript:
  sqlite_path: ./runtime/transcripts.sqlite
---
Prompt B
`, 'utf8');

    const reload = await runtimeSource.reload();

    expect(reload.ok).toBe(true);
    expect(firstStore.close).toHaveBeenCalledTimes(1);
    expect(runtimeSource.getCurrent().transcriptStore).toBe(secondStore);
  });

  it('closes the current transcript store when runtime source is closed', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
---
Prompt
`);
    const transcriptStore = createFakeTranscriptStore();
    const runtimeSource = await createWorkflowRuntimeSource(workflowPath, process.env, {
      openSqliteTranscriptStore: vi.fn(() => transcriptStore),
    });

    runtimeSource.close();

    expect(transcriptStore.close).toHaveBeenCalledTimes(1);
  });

  it('loads the default WORKFLOW.md from the current working directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-runtime-source-default-'));
    tempDirs.push(dir);
    const workflowPath = path.join(dir, 'WORKFLOW.md');
    fs.writeFileSync(workflowPath, `---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
---
Prompt C
`, 'utf8');

    const previousCwd = process.cwd();
    process.chdir(dir);

    try {
      const runtimeSource = await createWorkflowRuntimeSource('WORKFLOW.md');
      expect(fs.realpathSync(runtimeSource.getCurrent().workflowPath)).toBe(fs.realpathSync(workflowPath));
      expect(runtimeSource.getCurrent().promptTemplate).toBe('Prompt C');
    } finally {
      process.chdir(previousCwd);
    }
  });
});
