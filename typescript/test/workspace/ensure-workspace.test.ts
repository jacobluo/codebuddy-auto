import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureWorkspace } from '../../src/workspace/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

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

  it('runs afterCreate hooks when a workspace is first created', async () => {
    const root = createTempRoot();
    const markerPath = path.join(root, 'hook-created.txt');

    const workspace = await ensureWorkspace(root, 'ABC-123', {
      hooks: {
        ...DEFAULT_SERVICE_CONFIG.hooks,
        afterCreate: `echo ok > "${markerPath}"`,
      },
    });

    expect(workspace.createdNow).toBe(true);
    expect(fs.readFileSync(markerPath, 'utf8').trim()).toBe('ok');
  });

  it('fails workspace creation when the afterCreate hook fails', async () => {
    const root = createTempRoot();

    await expect(
      ensureWorkspace(root, 'ABC-123', {
        hooks: {
          ...DEFAULT_SERVICE_CONFIG.hooks,
          afterCreate: 'exit 7',
        },
      }),
    ).rejects.toThrow('afterCreate hook failed for workspace creation');
  });
});
