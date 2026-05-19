import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validatePreflight } from '../../src/config/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('validatePreflight', () => {
  it('passes when required fields are present and workspace exists', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-'));
    tempDirs.push(workspaceRoot);

    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        root: workspaceRoot,
      },
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('reports missing required values', () => {
    const result = validatePreflight({
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: '',
      },
      workspace: {
        root: '/definitely/missing',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('tracker.apiKey is required');
    expect(result.errors).toContain('workspace.root does not exist: /definitely/missing');
  });
});
