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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-local-tracker-'));
  tempDirs.push(dir);
  return dir;
}

function writeIssue(dir: string, name: string, issue: object): void {
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(issue, null, 2));
}

function makeIssue(overrides: Record<string, unknown> = {}): object {
  return {
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
    ...overrides,
  };
}

describe('LocalTracker', () => {
  it('returns candidate issues from configured active states', async () => {
    const dir = createIssueDir();
    writeIssue(dir, 'open', makeIssue());
    writeIssue(dir, 'closed', makeIssue({
      id: '2',
      identifier: '#2',
      title: 'Closed',
      state: 'closed',
    }));

    const tracker = new LocalTracker({ rootDir: dir, activeStates: ['open'] });
    const issues = await tracker.fetchCandidateIssues();

    expect(issues.map((issue) => issue.id)).toEqual(['1']);
  });

  it('filters by state and by id', async () => {
    const dir = createIssueDir();
    writeIssue(dir, 'a', makeIssue({
      title: 'A',
      labels: ['agent-ready'],
    }));
    writeIssue(dir, 'b', makeIssue({
      id: '2',
      identifier: '#2',
      title: 'B',
      state: 'closed',
      labels: ['done'],
    }));

    const tracker = new LocalTracker({ rootDir: dir, activeStates: ['open'] });
    const closed = await tracker.fetchIssuesByStates(['closed']);
    const stateMap = await tracker.fetchIssueStatesByIds(['2']);

    expect(closed.map((issue) => issue.id)).toEqual(['2']);
    expect(stateMap.get('2')).toEqual({ id: '2', state: 'closed', labels: ['done'] });
  });

  it('ignores non-json files in the local tracker directory', async () => {
    const dir = createIssueDir();
    writeIssue(dir, 'open', makeIssue());
    fs.writeFileSync(path.join(dir, 'README.md'), 'not an issue');

    const tracker = new LocalTracker({ rootDir: dir, activeStates: ['open'] });

    await expect(tracker.fetchCandidateIssues()).resolves.toHaveLength(1);
  });

  it('rejects invalid issue json with schema diagnostics', async () => {
    const dir = createIssueDir();
    writeIssue(dir, 'invalid', {
      id: 'bad',
      title: 'Missing required issue fields',
    });

    const tracker = new LocalTracker({ rootDir: dir, activeStates: ['open'] });

    await expect(tracker.fetchCandidateIssues()).rejects.toThrow(/identifier|state|labels/u);
  });
});
