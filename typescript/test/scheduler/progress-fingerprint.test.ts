import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createProgressFingerprint, recordProgressFingerprint, type ProgressFingerprint } from '../../src/progress/index.js';

function makeGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-progress-'));
  fs.writeFileSync(path.join(dir, 'README.md'), 'initial\n', 'utf8');
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'], {
    cwd: dir,
    stdio: 'ignore',
  });
  return dir;
}

describe('createProgressFingerprint', () => {
  it('records git workspace and tracker signals without requiring a validation command', async () => {
    const workspacePath = makeGitRepo();
    fs.writeFileSync(path.join(workspacePath, 'notes.txt'), 'not committed\n', 'utf8');

    const progress = await createProgressFingerprint({
      issueId: 'issue-1',
      identifier: '#1',
      workspacePath,
      trackerState: {
        state: 'open',
        labels: ['agent-ready'],
      },
      lastEvent: 'turn_completed',
    });

    expect(progress.issueId).toBe('issue-1');
    expect(progress.identifier).toBe('#1');
    expect(progress.headCommit).toMatch(/^[0-9a-f]{40}$/u);
    expect(progress.statusShort).toContain('?? notes.txt');
    expect(progress.untrackedFiles).toEqual(['notes.txt']);
    expect(progress.trackerState).toBe('open');
    expect(progress.trackerLabels).toEqual(['agent-ready']);
    expect(progress.lastEvent).toBe('turn_completed');
    expect(progress.fingerprint).toContain('"lastEvent":"turn_completed"');
  });
});

function makeProgress(fingerprint: string): ProgressFingerprint {
  return {
    issueId: 'issue-1',
    identifier: '#1',
    headCommit: '0123456789012345678901234567890123456789',
    statusShort: [],
    untrackedFiles: [],
    trackerState: 'open',
    trackerLabels: ['agent-ready'],
    lastEvent: 'turn_completed',
    fingerprint,
  };
}

describe('recordProgressFingerprint', () => {
  it('increments repeated count for identical fingerprints and resets when progress changes', () => {
    const first = recordProgressFingerprint(undefined, makeProgress('same'), 2);
    expect(first.repeatedCount).toBe(1);
    expect(first.stuck).toBeNull();

    const second = recordProgressFingerprint(first, makeProgress('same'), 2);
    expect(second.repeatedCount).toBe(2);
    expect(second.stuck?.reason).toBe('no_progress');

    const changed = recordProgressFingerprint(second, makeProgress('changed'), 2);
    expect(changed.repeatedCount).toBe(1);
    expect(changed.stuck).toBeNull();
  });
});
