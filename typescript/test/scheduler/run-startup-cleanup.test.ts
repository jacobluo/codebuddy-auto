import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runStartupCleanup } from '../../src/scheduler/index.js';
import { DEFAULT_SERVICE_CONFIG, type Issue, type ServiceConfig } from '../../src/spec/index.js';
import type { Tracker } from '../../src/tracker/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspaceRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-startup-cleanup-'));
  tempDirs.push(dir);
  return dir;
}


function createGitRepo(): string {
  const dir = createWorkspaceRoot();
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

function makeIssue(overrides: Partial<Issue>): Issue {
  return {
    id: '1',
    identifier: '#1',
    title: 'Issue',
    description: null,
    priority: null,
    state: 'closed',
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

class StubTracker implements Tracker {
  constructor(private readonly terminalIssues: Issue[]) {}

  async fetchCandidateIssues(): Promise<Issue[]> {
    return [];
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    return states.includes('closed') ? this.terminalIssues : [];
  }

  async fetchIssueStatesByIds(): Promise<Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>> {
    return new Map();
  }
}

function makeConfig(workspaceRoot: string): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    tracker: {
      ...DEFAULT_SERVICE_CONFIG.tracker,
      kind: 'local',
      apiKey: 'token',
      terminalStates: ['closed'],
    },
    workspace: {
      ...DEFAULT_SERVICE_CONFIG.workspace,
      root: workspaceRoot,
    },
  };
}

describe('runStartupCleanup', () => {
  it('removes workspaces for terminal issues at startup', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const workspacePath = path.join(workspaceRoot, '_1');
    fs.mkdirSync(workspacePath, { recursive: true });

    const result = await runStartupCleanup(
      new StubTracker([makeIssue({ id: '1', identifier: '#1' })]),
      makeConfig(workspaceRoot),
    );

    expect(result.cleanedWorkspaceIssueIds).toEqual(['1']);
    expect(result.cleanupError).toBeNull();
    expect(fs.existsSync(workspacePath)).toBe(false);
  });

  it('ignores terminal issues whose workspace is already absent', async () => {
    const workspaceRoot = createWorkspaceRoot();

    const result = await runStartupCleanup(
      new StubTracker([makeIssue({ id: '2', identifier: '#2' })]),
      makeConfig(workspaceRoot),
    );

    expect(result.cleanedWorkspaceIssueIds).toEqual([]);
    expect(result.cleanupError).toBeNull();
  });

  it('removes git worktree workspaces for terminal issues at startup', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const sourceRoot = createGitRepo();
    const workspacePath = path.join(workspaceRoot, '_3');
    execFileSync('git', ['worktree', 'add', '--detach', workspacePath, 'HEAD'], {
      cwd: sourceRoot,
      stdio: 'ignore',
    });

    const result = await runStartupCleanup(
      new StubTracker([makeIssue({ id: '3', identifier: '#3' })]),
      {
        ...makeConfig(workspaceRoot),
        workspace: {
          ...DEFAULT_SERVICE_CONFIG.workspace,
          root: workspaceRoot,
          mode: 'git-worktree',
          sourceRoot,
        },
      },
    );

    expect(result.cleanedWorkspaceIssueIds).toEqual(['3']);
    expect(result.cleanupError).toBeNull();
    expect(fs.existsSync(workspacePath)).toBe(false);
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' })).not.toContain(workspacePath);
  });

  it('continues startup cleanup after a workspace removal failure and reports the first error', async () => {
    const tracker = new StubTracker([
      makeIssue({ id: '4a', identifier: '#4a' }),
      makeIssue({ id: '4b', identifier: '#4b' }),
    ]);
    const removedIdentifiers: string[] = [];

    const result = await runStartupCleanup(tracker, makeConfig(createWorkspaceRoot()), {
      removeWorkspace: async (_root, identifier) => {
        removedIdentifiers.push(identifier);
        if (identifier === '#4a') {
          throw new Error('cleanup failed');
        }

        return { workspacePath: '/tmp/' + identifier.slice(1), removed: true };
      },
    });

    expect(removedIdentifiers).toEqual(['#4a', '#4b']);
    expect(result.cleanedWorkspaceIssueIds).toEqual(['4b']);
    expect(result.cleanupError).toBe('cleanup failed');
  });
});
