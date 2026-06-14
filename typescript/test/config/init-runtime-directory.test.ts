import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { initRuntimeDirectory } from '../../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-init-runtime-'));
  tempDirs.push(dir);
  return dir;
}

function readGenericWorkflowTemplate(): string {
  return fs.readFileSync(path.join(repoRoot, 'examples/workflows/cnb-generic.WORKFLOW.md'), 'utf8');
}

describe('initRuntimeDirectory', () => {
  it('renders WORKFLOW.md from the checked-in CNB generic workflow template', async () => {
    const cwd = makeTempDir();
    const project = 'relaxorg/symphony_repo_crm';
    const repoUrl = 'https://cnb.cool/relaxorg/symphony_repo_crm.git';

    await initRuntimeDirectory({ cwd, project, repoUrl });

    const workflow = fs.readFileSync(path.join(cwd, 'WORKFLOW.md'), 'utf8');
    const expected = readGenericWorkflowTemplate()
      .replaceAll('your-org/your-repo', project)
      .replaceAll('https://cnb.cool/your-org/your-repo.git', repoUrl);

    expect(workflow).toBe(expected);
    expect(fs.existsSync(path.join(cwd, '.codebuddy-auto/workspaces'))).toBe(true);
  });

  it('keeps an explicit repo URL independent from the project slug', async () => {
    const cwd = makeTempDir();

    await initRuntimeDirectory({
      cwd,
      project: 'relaxorg/symphony_repo_crm',
      repoUrl: 'git@cnb.cool:relaxorg/symphony_repo_crm.git',
    });

    const workflow = fs.readFileSync(path.join(cwd, 'WORKFLOW.md'), 'utf8');

    expect(workflow).toContain('projectSlug: relaxorg/symphony_repo_crm');
    expect(workflow).toContain('git clone git@cnb.cool:relaxorg/symphony_repo_crm.git .');
    expect(workflow).not.toContain('git clone https://cnb.cool/relaxorg/symphony_repo_crm.git .');
  });

  it('keeps generic operating rules without repository-specific harness docs', () => {
    const template = readGenericWorkflowTemplate();

    expect(template).toContain('read the `Task type` field from the issue description');
    expect(template).toContain('agent-ready:ui-bug');
    expect(template).toContain("issue's `Verification` field");
    expect(template).toContain('UI evidence for visual changes');
    expect(template).not.toContain('docs/symphony-harness.md');
    expect(template).not.toContain('src/features/<feature>');
  });
});
