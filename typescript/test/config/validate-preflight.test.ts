import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validatePreflight } from '../../src/config/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createGitRepo(prefix: string): string {
  const dir = createTempDir(prefix);
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

describe('validatePreflight', () => {
  it('passes when required fields are present for directory workspace mode', () => {
    const workspaceRoot = createTempDir('agentfirst-');

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
      },
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('passes when git-worktree mode points at an external git repository', () => {
    const workspaceRoot = createTempDir('agentfirst-workspaces-');
    const sourceRoot = createGitRepo('agentfirst-source-');

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
        mode: 'git-worktree',
        sourceRoot,
      },
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('reports missing required values', () => {
    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: '',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: '/definitely/missing',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('tracker.apiKey is required');
    expect(result.errors).toContain('workspace.root does not exist: /definitely/missing');
  });

  it('rejects git-worktree mode when sourceRoot is missing', () => {
    const workspaceRoot = createTempDir('agentfirst-workspaces-');

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
        mode: 'git-worktree',
        sourceRoot: '/definitely/missing-source',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('workspace.sourceRoot does not exist: /definitely/missing-source');
  });

  it('rejects git-worktree mode when sourceRoot is not a git repository', () => {
    const workspaceRoot = createTempDir('agentfirst-workspaces-');
    const sourceRoot = createTempDir('agentfirst-not-git-');

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
        mode: 'git-worktree',
        sourceRoot,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`workspace.sourceRoot is not a git repository: ${sourceRoot}`);
  });

  it('rejects git-worktree mode when workspace.root equals sourceRoot', () => {
    const sourceRoot = createGitRepo('agentfirst-same-root-');

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: sourceRoot,
        mode: 'git-worktree',
        sourceRoot,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('workspace.root must not equal workspace.sourceRoot in git-worktree mode');
  });

  it('rejects git-worktree mode when workspace.root is inside sourceRoot', () => {
    const sourceRoot = createGitRepo('agentfirst-nested-source-');
    const workspaceRoot = path.join(sourceRoot, '.agentfirst-workspaces');
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
        mode: 'git-worktree',
        sourceRoot,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('workspace.root must not be inside workspace.sourceRoot in git-worktree mode');
  });

  it('rejects git-worktree mode when sourceRoot is inside workspace.root', () => {
    const workspaceRoot = createTempDir('agentfirst-parent-workspaces-');
    const sourceRoot = path.join(workspaceRoot, 'repo-source');
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'README.md'), 'seed\n', 'utf8');
    execFileSync('git', ['init'], { cwd: sourceRoot, stdio: 'ignore' });
    execFileSync('git', ['add', 'README.md'], { cwd: sourceRoot, stdio: 'ignore' });
    execFileSync(
      'git',
      ['-c', 'user.name=agentfirst', '-c', 'user.email=agentfirst@example.com', 'commit', '-m', 'init'],
      { cwd: sourceRoot, stdio: 'ignore' },
    );

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
        mode: 'git-worktree',
        sourceRoot,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('workspace.sourceRoot must not be inside workspace.root in git-worktree mode');
  });

  it('rejects ssh worker mode when ssh host is missing', () => {
    const workspaceRoot = createTempDir('agentfirst-ssh-workspace-');

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
      },
      worker: {
        ...DEFAULT_SERVICE_CONFIG.worker,
        kind: 'ssh',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('worker.sshHost is required for ssh worker');
  });

  it('does not require codebuddy.command for local worker (SDK mode)', () => {
    const workspaceRoot = createTempDir('agentfirst-local-cmdless-');

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
      },
      codebuddy: {
        ...DEFAULT_SERVICE_CONFIG.codebuddy,
        command: '',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.errors).not.toContain('codebuddy.command is required for ssh worker (CLI fallback)');
  });

  it('requires codebuddy.command when ssh worker is selected', () => {
    const workspaceRoot = createTempDir('agentfirst-ssh-cmdless-');

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        ...DEFAULT_SERVICE_CONFIG.workspace,
        root: workspaceRoot,
      },
      worker: {
        ...DEFAULT_SERVICE_CONFIG.worker,
        kind: 'ssh',
        sshHost: 'worker.example.com',
      },
      codebuddy: {
        ...DEFAULT_SERVICE_CONFIG.codebuddy,
        command: '',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('codebuddy.command is required for ssh worker (CLI fallback)');
  });
});
