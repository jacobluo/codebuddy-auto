import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const baselineScript = path.join(repoRoot, 'scripts', 'baseline.sh');
const diffBaselineScript = path.join(repoRoot, 'scripts', 'diff-baseline.sh');
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-baseline-'));
  tempDirs.push(dir);
  return dir;
}

function runBashScript(scriptPath: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('bash', [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('baseline scripts', () => {
  it('emits valid baseline json without running tests when --no-tests is set', () => {
    const result = runBashScript(baselineScript, ['--no-tests', '--include-api-hash']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const baseline = JSON.parse(result.stdout) as {
      skipped: boolean;
      tests_pass: number | null;
      tests_fail: number | null;
      tests_total: number | null;
      public_api_hash: string | null;
      git_head: string | null;
    };

    expect(baseline.skipped).toBe(true);
    expect(baseline.tests_pass).toBeNull();
    expect(baseline.tests_fail).toBeNull();
    expect(baseline.tests_total).toBeNull();
    expect(typeof baseline.public_api_hash).toBe('string');
    expect(typeof baseline.git_head).toBe('string');
  });

  it('writes baseline json to the requested output path', () => {
    const outDir = createTempDir();
    const outPath = path.join(outDir, 'baseline.json');

    const result = runBashScript(baselineScript, ['--no-tests', '--out', outPath]);

    expect(result.status).toBe(0);
    expect(fs.existsSync(outPath)).toBe(true);

    const baseline = JSON.parse(fs.readFileSync(outPath, 'utf8')) as {
      skipped: boolean;
      timestamp: string;
    };

    expect(baseline.skipped).toBe(true);
    expect(typeof baseline.timestamp).toBe('string');
  });

  it('reports no regression for identical baseline snapshots', () => {
    const tempDir = createTempDir();
    const beforePath = path.join(tempDir, 'before.json');
    const afterPath = path.join(tempDir, 'after.json');
    const snapshot = {
      git_head: 'abc',
      tests_pass: 10,
      tests_fail: 0,
      tests_total: 10,
      skipped: false,
      build_size: 100,
      public_api_hash: 'hash-1',
      timestamp: '2026-05-24T00:00:00Z',
    };

    fs.writeFileSync(beforePath, JSON.stringify(snapshot));
    fs.writeFileSync(afterPath, JSON.stringify(snapshot));

    const result = runBashScript(diffBaselineScript, [beforePath, afterPath]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('no regression');
  });

  it('fails when test counts regress or api hash changes', () => {
    const tempDir = createTempDir();
    const beforePath = path.join(tempDir, 'before.json');
    const afterPath = path.join(tempDir, 'after.json');

    fs.writeFileSync(beforePath, JSON.stringify({
      git_head: 'abc',
      tests_pass: 12,
      tests_fail: 0,
      tests_total: 12,
      skipped: false,
      build_size: 100,
      public_api_hash: 'hash-1',
      timestamp: '2026-05-24T00:00:00Z',
    }));
    fs.writeFileSync(afterPath, JSON.stringify({
      git_head: 'def',
      tests_pass: 10,
      tests_fail: 2,
      tests_total: 12,
      skipped: false,
      build_size: 100,
      public_api_hash: 'hash-2',
      timestamp: '2026-05-24T00:01:00Z',
    }));

    const result = runBashScript(diffBaselineScript, [beforePath, afterPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tests_pass regression: 12 → 10');
    expect(result.stderr).toContain('tests_fail increased: 0 → 2');
    expect(result.stderr).toContain('public_api_hash changed (breaking not declared): hash-1 → hash-2');
  });

  it('warns on build size growth without failing the comparison', () => {
    const tempDir = createTempDir();
    const beforePath = path.join(tempDir, 'before.json');
    const afterPath = path.join(tempDir, 'after.json');

    fs.writeFileSync(beforePath, JSON.stringify({
      git_head: 'abc',
      tests_pass: 12,
      tests_fail: 0,
      tests_total: 12,
      skipped: false,
      build_size: 100,
      public_api_hash: 'hash-1',
      timestamp: '2026-05-24T00:00:00Z',
    }));
    fs.writeFileSync(afterPath, JSON.stringify({
      git_head: 'abc',
      tests_pass: 12,
      tests_fail: 0,
      tests_total: 12,
      skipped: false,
      build_size: 125,
      public_api_hash: 'hash-1',
      timestamp: '2026-05-24T00:01:00Z',
    }));

    const result = runBashScript(diffBaselineScript, [beforePath, afterPath]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('no regression');
    expect(result.stderr).toContain('warning: build_size grew >10% (100 → 125, 125%)');
  });
});
