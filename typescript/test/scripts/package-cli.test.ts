import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const packageRoot = path.join(repoRoot, 'typescript');
const rootPackageJsonPath = path.join(repoRoot, 'package.json');
const packageJsonPath = path.join(packageRoot, 'package.json');
const sourceMainPath = path.join(packageRoot, 'src', 'main.ts');
const builtMainPath = path.join(packageRoot, 'dist', 'src', 'main.js');
const tempDirs: string[] = [];

const packageJsonSchema = z.object({
  name: z.string(),
  private: z.boolean().optional(),
  bin: z.record(z.string(), z.string()).optional(),
  files: z.array(z.string()).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
});

const packFileSchema = z.object({
  path: z.string(),
});

const packOutputSchema = z.object({
  files: z.array(packFileSchema),
});

function readPackageJson(): z.infer<typeof packageJsonSchema> {
  return packageJsonSchema.parse(JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')));
}

function readRootPackageJson(): z.infer<typeof packageJsonSchema> {
  return packageJsonSchema.parse(JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8')));
}

function runPnpm(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('pnpm', args, {
    cwd: packageRoot,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runRootPnpm(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('pnpm', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function createWorkflowFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-built-cli-'));
  tempDirs.push(dir);
  const workspaceRoot = path.join(dir, 'workspaces');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const workflowPath = path.join(dir, 'WORKFLOW.md');
  fs.writeFileSync(workflowPath, [
    '---',
    'tracker:',
    '  kind: local',
    '  apiKey: token',
    'workspace:',
    '  root: ./workspaces',
    '  source_root: .',
    '---',
    'Prompt',
    '',
  ].join('\n'), 'utf8');
  return workflowPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('package cli contract', () => {
  it('declares a codebuddy-auto binary that points at the built entry', () => {
    const packageJson = readPackageJson();

    expect(packageJson.name).toBe('@relaxorg/codebuddy-auto');
    expect(packageJson.bin?.['codebuddy-auto']).toBe('./dist/src/main.js');
  });

  it('preserves a node shebang in the built cli entry and runs the built check command', () => {
    expect(fs.readFileSync(sourceMainPath, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);

    const buildResult = runPnpm(['run', 'build']);
    expect(buildResult.status).toBe(0);
    expect(buildResult.stderr).toBe('');
    expect(fs.readFileSync(builtMainPath, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);

    const checkResult = spawnSync('node', [builtMainPath, 'check', createWorkflowFixture()], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(checkResult.status).toBe(0);
    expect(checkResult.stderr).toBe('');
  });

  it('packs runtime build outputs and operator assets', () => {
    const packResult = runPnpm(['pack', '--dry-run', '--json']);

    expect(packResult.status).toBe(0);

    const packOutput = packOutputSchema.parse(JSON.parse(packResult.stdout));
    const packedPaths = new Set(packOutput.files.map((file) => file.path));

    expect(packedPaths.has('dist/src/main.js')).toBe(true);
    expect(packedPaths.has('dist/dashboard/index.html')).toBe(true);
    expect(packedPaths.has('dist/examples/workflows/cnb-generic.WORKFLOW.md')).toBe(true);
    expect(packedPaths.has('dist/examples/workflows/symphony_repo_crm.WORKFLOW.md')).toBe(true);
    expect(packedPaths.has('dist/templates/cnb/ISSUE_TEMPLATE/agent-ready.yml')).toBe(true);
    expect(packedPaths.has('src/main.ts')).toBe(false);
    expect(packedPaths.has('test/scripts/package-cli.test.ts')).toBe(false);
  });
});

describe('root package entrypoint contract', () => {
  it('declares the root package as the installable cli entrypoint', () => {
    const packageJson = readRootPackageJson();

    expect(packageJson.name).toBe('@relaxorg/codebuddy-auto');
    expect(packageJson.private).toBe(true);
    expect(packageJson.bin?.['codebuddy-auto']).toBe('./typescript/dist/src/main.js');
    expect(packageJson.scripts?.build).toBe('pnpm run build:server && pnpm run build:dashboard && pnpm run build:assets');
    expect(packageJson.scripts?.check).toBe('pnpm run check:server && pnpm run check:dashboard');
    expect(packageJson.scripts?.test).toBe('pnpm run test:server && pnpm run test:dashboard');
    expect(packageJson.dependencies?.zod).toBeDefined();
  });

  it('packs the nested runtime build and root operator assets', () => {
    const buildResult = runRootPnpm(['run', 'build']);
    expect(buildResult.status).toBe(0);

    const packResult = runRootPnpm(['pack', '--dry-run', '--json']);
    expect(packResult.status).toBe(0);

    const packOutput = packOutputSchema.parse(JSON.parse(packResult.stdout));
    const packedPaths = new Set(packOutput.files.map((file) => file.path));

    expect(packedPaths.has('typescript/dist/src/main.js')).toBe(true);
    expect(packedPaths.has('typescript/dist/dashboard/index.html')).toBe(true);
    expect(packedPaths.has('examples/workflows/cnb-generic.WORKFLOW.md')).toBe(true);
    expect(packedPaths.has('examples/workflows/symphony_repo_crm.WORKFLOW.md')).toBe(true);
    expect(packedPaths.has('templates/cnb/ISSUE_TEMPLATE/agent-ready.yml')).toBe(true);
    expect(packedPaths.has('typescript/src/main.ts')).toBe(false);
    expect(packedPaths.has('typescript/test/scripts/package-cli.test.ts')).toBe(false);
  });
});
