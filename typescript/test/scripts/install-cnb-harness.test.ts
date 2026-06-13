import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const installerScript = path.join(repoRoot, 'scripts', 'install-cnb-harness');
const sourceTemplate = path.join(repoRoot, 'templates', 'cnb', 'ISSUE_TEMPLATE', 'agent-ready.yml');
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-harness-'));
  tempDirs.push(dir);
  return dir;
}

function runInstaller(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('bash', [installerScript, ...args], {
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

describe('install-cnb-harness script', () => {
  it('installs the canonical CNB issue template without overwriting by default', () => {
    const targetRepo = path.join(createTempDir(), 'business-repo');
    const targetTemplate = path.join(targetRepo, '.cnb', 'ISSUE_TEMPLATE', 'agent-ready.yml');
    fs.mkdirSync(targetRepo, { recursive: true });

    const installResult = runInstaller([targetRepo]);

    expect(installResult.status).toBe(0);
    expect(installResult.stderr).toBe('');
    expect(fs.readFileSync(targetTemplate, 'utf8')).toBe(fs.readFileSync(sourceTemplate, 'utf8'));

    fs.writeFileSync(targetTemplate, 'custom template\n', 'utf8');
    const existingResult = runInstaller([targetRepo]);

    expect(existingResult.status).toBe(1);
    expect(existingResult.stderr).toContain('target already exists');
    expect(fs.readFileSync(targetTemplate, 'utf8')).toBe('custom template\n');
  });

  it('overwrites the target template when --overwrite is set', () => {
    const targetRepo = path.join(createTempDir(), 'business-repo');
    const targetTemplate = path.join(targetRepo, '.cnb', 'ISSUE_TEMPLATE', 'agent-ready.yml');
    fs.mkdirSync(path.dirname(targetTemplate), { recursive: true });
    fs.writeFileSync(targetTemplate, 'custom template\n', 'utf8');

    const overwriteResult = runInstaller(['--overwrite', targetRepo]);

    expect(overwriteResult.status).toBe(0);
    expect(overwriteResult.stderr).toBe('');
    expect(fs.readFileSync(targetTemplate, 'utf8')).toBe(fs.readFileSync(sourceTemplate, 'utf8'));
  });
});
