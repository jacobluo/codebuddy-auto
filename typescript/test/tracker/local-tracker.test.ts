import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalTracker } from '../../src/tracker/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createIssueDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-local-tracker-'));
  tempDirs.push(dir);
  return dir;
}

function writeIssue(dir: string, name: string, issue: object): void {
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(issue, null, 2));
}

describe('LocalTracker', () => {
  it('returns candidate issues from configured active states', async () => {
    const dir = createIssueDir();
    writeIssue(dir, 'open', {
      id: '1',
      identifier: '#1',
      title: 'Open',
      description: null,
      priority: null,
      state: 'open',
      branchName: null,
      url: null,
      labels: [],
      blockedBy: [],
      createdAt: null,
      updatedAt: null,
    });
    writeIssue(dir, 'closed', {
      id: '2',
      identifier: '#2',
      title: 'Closed',
      description: null,
      priority: null,
      state: 'closed',
      branchName: null,
      url: null,
      labels: [],
      blockedBy: [],
      createdAt: null,
      updatedAt: null,
    });

    const tracker = new LocalTracker({ rootDir: dir, activeStates: ['open'] });
    const issues = await tracker.fetchCandidateIssues();

    expect(issues.map((issue) => issue.id)).toEqual(['1']);
  });

  it('filters by state and by id', async () => {
    const dir = createIssueDir();
    writeIssue(dir, 'a', {
      id: '1',
      identifier: '#1',
      title: 'A',
      description: null,
      priority: null,
      state: 'open',
      branchName: null,
      url: null,
      labels: ['agent-ready'],
      blockedBy: [],
      createdAt: null,
      updatedAt: null,
    });
    writeIssue(dir, 'b', {
      id: '2',
      identifier: '#2',
      title: 'B',
      description: null,
      priority: null,
      state: 'closed',
      branchName: null,
      url: null,
      labels: ['done'],
      blockedBy: [],
      createdAt: null,
      updatedAt: null,
    });

    const tracker = new LocalTracker({ rootDir: dir, activeStates: ['open'] });
    const closed = await tracker.fetchIssuesByStates(['closed']);
    const stateMap = await tracker.fetchIssueStatesByIds(['2']);

    expect(closed.map((issue) => issue.id)).toEqual(['2']);
    expect(stateMap.get('2')).toEqual({ id: '2', state: 'closed', labels: ['done'] });
  });
});
