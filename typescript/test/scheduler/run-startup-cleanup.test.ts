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
    expect(fs.existsSync(workspacePath)).toBe(false);
  });

  it('ignores terminal issues whose workspace is already absent', async () => {
    const workspaceRoot = createWorkspaceRoot();

    const result = await runStartupCleanup(
      new StubTracker([makeIssue({ id: '2', identifier: '#2' })]),
      makeConfig(workspaceRoot),
    );

    expect(result.cleanedWorkspaceIssueIds).toEqual([]);
  });
});
