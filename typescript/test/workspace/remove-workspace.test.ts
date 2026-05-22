import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { removeWorkspace } from '../../src/workspace/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-remove-workspace-'));
  tempDirs.push(dir);
  return dir;
}

describe('removeWorkspace', () => {
  it('removes an existing workspace directory', async () => {
    const root = createTempRoot();
    const workspacePath = path.join(root, '_1');
    fs.mkdirSync(workspacePath, { recursive: true });

    const result = await removeWorkspace(root, '#1');

    expect(result).toEqual({
      workspacePath,
      removed: true,
    });
    expect(fs.existsSync(workspacePath)).toBe(false);
  });

  it('returns removed=false when the workspace is already absent', async () => {
    const root = createTempRoot();

    const result = await removeWorkspace(root, '#missing');

    expect(result).toEqual({
      workspacePath: path.join(root, '_missing'),
      removed: false,
    });
  });

  it('runs beforeRemove hooks before deleting the workspace', async () => {
    const root = createTempRoot();
    const workspacePath = path.join(root, '_2');
    const markerPath = path.join(root, 'before-remove.txt');
    fs.mkdirSync(workspacePath, { recursive: true });

    const result = await removeWorkspace(root, '#2', {
      hooks: {
        ...DEFAULT_SERVICE_CONFIG.hooks,
        beforeRemove: `pwd > "${markerPath}"`,
      },
    });

    expect(result.removed).toBe(true);
    expect(path.basename(fs.readFileSync(markerPath, 'utf8').trim())).toBe('_2');
    expect(fs.existsSync(workspacePath)).toBe(false);
  });
});
