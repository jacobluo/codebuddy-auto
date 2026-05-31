import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getWorkspaceHookScript, runWorkspaceHook } from '../../src/workspace/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-hook-'));
  tempDirs.push(dir);
  return dir;
}

describe('runWorkspaceHook', () => {
  it('executes hook scripts inside the workspace directory', async () => {
    const root = createTempRoot();
    const result = await runWorkspaceHook({
      script: 'pwd',
      workspacePath: root,
      timeoutMs: 1000,
    });

    expect(result.exitCode).toBe(0);
    expect(fs.realpathSync(result.stdout.trim())).toBe(fs.realpathSync(root));
    expect(result.timedOut).toBe(false);
  });

  it('marks timed out hook executions', async () => {
    const root = createTempRoot();
    const result = await runWorkspaceHook({
      script: 'sleep 1',
      workspacePath: root,
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('reads hook scripts from config when present', () => {
    const config = {
      ...DEFAULT_SERVICE_CONFIG,
      hooks: {
        ...DEFAULT_SERVICE_CONFIG.hooks,
        beforeRun: 'echo before-run',
      },
    };

    expect(getWorkspaceHookScript(config, 'beforeRun')).toBe('echo before-run');
    expect(getWorkspaceHookScript(config, 'afterRun')).toBeNull();
  });
});
