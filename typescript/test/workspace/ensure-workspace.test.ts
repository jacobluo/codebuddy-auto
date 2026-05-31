import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';
import { ensureWorkspace } from '../../src/workspace/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createGitRepo(): string {
  const dir = createTempRoot('codebuddy-auto-worktree-source-');
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n', 'utf8');
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=codebuddy-auto', '-c', 'user.email=codebuddy-auto@example.com', 'commit', '-m', 'init'],
    { cwd: dir, stdio: 'ignore' },
  );
  return dir;
}

describe('ensureWorkspace', () => {
  it('creates a workspace on first use', async () => {
    const root = createTempRoot('codebuddy-auto-workspace-');

    const workspace = await ensureWorkspace(root, 'ABC-123');

    expect(workspace.createdNow).toBe(true);
    expect(fs.existsSync(workspace.path)).toBe(true);
  });

  it('reuses an existing workspace', async () => {
    const root = createTempRoot('codebuddy-auto-workspace-');
    const workspacePath = path.join(root, 'ABC-123');
    fs.mkdirSync(workspacePath);

    const workspace = await ensureWorkspace(root, 'ABC-123');

    expect(workspace.createdNow).toBe(false);
  });

  it('runs afterCreate hooks when a workspace is first created', async () => {
    const root = createTempRoot('codebuddy-auto-workspace-');
    const markerPath = path.join(root, 'hook-created.txt');

    const workspace = await ensureWorkspace(root, 'ABC-123', {
      hooks: {
        ...DEFAULT_SERVICE_CONFIG.hooks,
        afterCreate: `echo ok > "${markerPath}"`,
      },
    });

    expect(workspace.createdNow).toBe(true);
    expect(fs.readFileSync(markerPath, 'utf8').trim()).toBe('ok');
  });

  it('fails workspace creation when the afterCreate hook fails', async () => {
    const root = createTempRoot('codebuddy-auto-workspace-');

    await expect(
      ensureWorkspace(root, 'ABC-123', {
        hooks: {
          ...DEFAULT_SERVICE_CONFIG.hooks,
          afterCreate: 'exit 7',
        },
      }),
    ).rejects.toThrow('afterCreate hook failed for workspace creation');
  });


  it('rolls back a directory workspace when the afterCreate hook fails', async () => {
    const root = createTempRoot('codebuddy-auto-workspace-');
    const workspacePath = path.join(root, 'ABC-123');

    await expect(
      ensureWorkspace(root, 'ABC-123', {
        hooks: {
          ...DEFAULT_SERVICE_CONFIG.hooks,
          afterCreate: 'exit 7',
        },
      }),
    ).rejects.toThrow('afterCreate hook failed for workspace creation');

    expect(fs.existsSync(workspacePath)).toBe(false);
  });

  it('rolls back a git worktree when the afterCreate hook fails', async () => {
    const workspaceRoot = createTempRoot('codebuddy-auto-worktree-root-');
    const sourceRoot = createGitRepo();
    const workspacePath = path.join(workspaceRoot, '_rollback');
    const config = {
      hooks: {
        ...DEFAULT_SERVICE_CONFIG.hooks,
        afterCreate: 'exit 9',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
        mode: 'git-worktree' as const,
        sourceRoot,
      },
    };

    await expect(
      ensureWorkspace(workspaceRoot, '#rollback', config),
    ).rejects.toThrow('afterCreate hook failed for workspace creation');

    expect(fs.existsSync(workspacePath)).toBe(false);
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' })).not.toContain(workspacePath);
  });

  it('creates and reuses git worktrees when configured', async () => {
    const workspaceRoot = createTempRoot('codebuddy-auto-worktree-root-');
    const sourceRoot = createGitRepo();
    const config = {
      hooks: DEFAULT_SERVICE_CONFIG.hooks,
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
        mode: 'git-worktree' as const,
        sourceRoot,
      },
    };

    const first = await ensureWorkspace(workspaceRoot, '#1', config);
    const second = await ensureWorkspace(workspaceRoot, '#1', config);

    expect(first.createdNow).toBe(true);
    expect(second.createdNow).toBe(false);
    expect(fs.existsSync(path.join(first.path, '.git'))).toBe(true);
  });

  it('recreates a git worktree after the directory is deleted out of band', async () => {
    const workspaceRoot = createTempRoot('codebuddy-auto-worktree-root-');
    const sourceRoot = createGitRepo();
    const config = {
      hooks: DEFAULT_SERVICE_CONFIG.hooks,
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
        mode: 'git-worktree' as const,
        sourceRoot,
      },
    };

    const first = await ensureWorkspace(workspaceRoot, '#2', config);
    fs.rmSync(first.path, { recursive: true, force: true });

    const recreated = await ensureWorkspace(workspaceRoot, '#2', config);

    expect(recreated.createdNow).toBe(true);
    expect(fs.existsSync(path.join(recreated.path, '.git'))).toBe(true);
  });
});
