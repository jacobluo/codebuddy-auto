import { spawn } from 'node:child_process';

export interface ProgressTrackerSnapshot {
  state: string;
  labels: string[];
}

export interface CreateProgressFingerprintInput {
  issueId: string;
  identifier: string;
  workspacePath: string;
  trackerState?: ProgressTrackerSnapshot;
  lastEvent: string | null;
}

export interface ProgressFingerprint {
  issueId: string;
  identifier: string;
  headCommit: string | null;
  statusShort: string[];
  untrackedFiles: string[];
  trackerState: string | null;
  trackerLabels: string[];
  lastEvent: string | null;
  fingerprint: string;
}

export interface StuckProgressState {
  reason: 'no_progress' | 'max_turns_reached';
  repeatedCount: number;
  fingerprint: string;
}

export interface IssueProgressState {
  issueId: string;
  identifier: string;
  fingerprint: string;
  repeatedCount: number;
  latest: ProgressFingerprint;
  stuck: StuckProgressState | null;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
}

async function runGit(workspacePath: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', () => {
      resolve({ exitCode: 1, stdout: '' });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout });
    });
  });
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function parseUntrackedFiles(statusShort: string[]): string[] {
  return statusShort
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3));
}

export async function createProgressFingerprint(
  input: CreateProgressFingerprintInput,
): Promise<ProgressFingerprint> {
  const headResult = await runGit(input.workspacePath, ['rev-parse', 'HEAD']);
  const statusResult = await runGit(input.workspacePath, ['status', '--short']);
  const headCommit = headResult.exitCode === 0 ? headResult.stdout.trim() : null;
  const statusShort = statusResult.exitCode === 0 ? parseLines(statusResult.stdout) : [];
  const trackerLabels = [...(input.trackerState?.labels ?? [])].sort((a, b) => a.localeCompare(b));
  const fingerprintPayload = {
    headCommit,
    lastEvent: input.lastEvent,
    statusShort,
    trackerLabels,
    trackerState: input.trackerState?.state ?? null,
    untrackedFiles: parseUntrackedFiles(statusShort),
  };

  return {
    issueId: input.issueId,
    identifier: input.identifier,
    headCommit,
    statusShort,
    untrackedFiles: fingerprintPayload.untrackedFiles,
    trackerState: fingerprintPayload.trackerState,
    trackerLabels,
    lastEvent: input.lastEvent,
    fingerprint: JSON.stringify(fingerprintPayload),
  };
}

export function recordProgressFingerprint(
  previous: IssueProgressState | undefined,
  latest: ProgressFingerprint,
  noProgressThreshold: number,
): IssueProgressState {
  const repeatedCount = previous?.fingerprint === latest.fingerprint
    ? previous.repeatedCount + 1
    : 1;
  const stuck = repeatedCount >= noProgressThreshold
    ? {
      reason: 'no_progress' as const,
      repeatedCount,
      fingerprint: latest.fingerprint,
    }
    : null;

  return {
    issueId: latest.issueId,
    identifier: latest.identifier,
    fingerprint: latest.fingerprint,
    repeatedCount,
    latest,
    stuck,
  };
}
