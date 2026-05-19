import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureWorkspace } from '../../src/workspace/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-workspace-'));
  tempDirs.push(dir);
  return dir;
}

describe('ensureWorkspace', () => {
  it('creates a workspace on first use', async () => {
    const root = createTempRoot();

    const workspace = await ensureWorkspace(root, 'ABC-123');

    expect(workspace.createdNow).toBe(true);
    expect(fs.existsSync(workspace.path)).toBe(true);
  });

  it('reuses an existing workspace', async () => {
    const root = createTempRoot();
    const workspacePath = path.join(root, 'ABC-123');
    fs.mkdirSync(workspacePath);

    const workspace = await ensureWorkspace(root, 'ABC-123');

    expect(workspace.createdNow).toBe(false);
  });
});
