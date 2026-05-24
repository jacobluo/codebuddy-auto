import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';
import { removeWorkspace } from '../../src/workspace/index.js';

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
  const dir = createTempRoot('agentfirst-remove-worktree-source-');
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n', 'utf8');
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=agentfirst', '-c', 'user.email=agentfirst@example.com', 'commit', '-m', 'init'],
    { cwd: dir, stdio: 'ignore' },
  );
  return dir;
}

describe('removeWorkspace', () => {
  it('removes an existing workspace directory', async () => {
    const root = createTempRoot('agentfirst-remove-workspace-');
    const workspacePath = path.join(root, '_1');
    fs.mkdirSync(workspacePath, { recursive: true });

    const result = await removeWorkspace(root, '#1');

    expect(result).toEqual({
      workspacePath,
      removed: true,
    });
    expect(fs.existsSync(workspacePath)).toBe(false);
  });

  it('returns removed=false when the workspace is already absent', async () => {
    const root = createTempRoot('agentfirst-remove-workspace-');

    const result = await removeWorkspace(root, '#missing');

    expect(result).toEqual({
      workspacePath: path.join(root, '_missing'),
      removed: false,
    });
  });

  it('runs beforeRemove hooks before deleting the workspace', async () => {
    const root = createTempRoot('agentfirst-remove-workspace-');
    const workspacePath = path.join(root, '_2');
    const markerPath = path.join(root, 'before-remove.txt');
    fs.mkdirSync(workspacePath, { recursive: true });

    const result = await removeWorkspace(root, '#2', {
      hooks: {
        ...DEFAULT_SERVICE_CONFIG.hooks,
        beforeRemove: `pwd > "${markerPath}"`,
      },
    });

    expect(result.removed).toBe(true);
    expect(path.basename(fs.readFileSync(markerPath, 'utf8').trim())).toBe('_2');
    expect(fs.existsSync(workspacePath)).toBe(false);
  });

  it('removes git worktrees when configured', async () => {
    const workspaceRoot = createTempRoot('agentfirst-remove-worktree-root-');
    const sourceRoot = createGitRepo();
    const workspacePath = path.join(workspaceRoot, '_3');

    execFileSync('git', ['worktree', 'add', '--detach', workspacePath, 'HEAD'], {
      cwd: sourceRoot,
      stdio: 'ignore',
    });

    const result = await removeWorkspace(workspaceRoot, '#3', {
      hooks: DEFAULT_SERVICE_CONFIG.hooks,
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
        mode: 'git-worktree',
        sourceRoot,
      },
    });

    expect(result).toEqual({
      workspacePath,
      removed: true,
    });
    expect(fs.existsSync(workspacePath)).toBe(false);
  });
});
