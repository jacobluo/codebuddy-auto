import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRunAttempt } from '../../src/runner/index.js';
import type { Issue } from '../../src/spec/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeIssue(): Issue {
  return {
    id: '1',
    identifier: '#1',
    title: 'Issue',
    description: null,
    priority: null,
    state: 'open',
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
  };
}

describe('createRunAttempt', () => {
  it('creates a workspace-backed run attempt context', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-run-attempt-'));
    tempDirs.push(root);

    const attempt = await createRunAttempt(makeIssue(), root);

    expect(attempt.workspaceCreatedNow).toBe(true);
    expect(attempt.runningEntry.issue.id).toBe('1');
    expect(attempt.runningEntry.secondsRunning).toBe(0);
    expect(attempt.runningEntry.tokenUsage.totalTokens).toBe(0);
    expect(attempt.runningEntry.tokenUsage.creditCost).toBe(0);
    expect(fs.existsSync(attempt.workspacePath)).toBe(true);
  });

  it('passes hook config through to workspace creation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-run-attempt-hook-'));
    tempDirs.push(root);
    const markerPath = path.join(root, 'created.txt');

    await createRunAttempt(makeIssue(), root, {
      hooks: {
        ...DEFAULT_SERVICE_CONFIG.hooks,
        afterCreate: `echo ok > "${markerPath}"`,
      },
    });

    expect(fs.readFileSync(markerPath, 'utf8').trim()).toBe('ok');
  });
});
