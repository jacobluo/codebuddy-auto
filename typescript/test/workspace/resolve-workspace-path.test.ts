import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertWorkspacePathWithinRoot,
  resolveWorkspacePath,
  sanitizeWorkspaceKey,
} from '../../src/workspace/index.js';

describe('workspace path utilities', () => {
  it('sanitizes workspace keys to the allowed character set', () => {
    expect(sanitizeWorkspaceKey('ABC-123/bug fix:#1')).toBe('ABC-123_bug_fix__1');
  });

  it('builds deterministic workspace paths', () => {
    expect(resolveWorkspacePath('/tmp/workspaces', 'ABC-123')).toBe(
      path.join('/tmp/workspaces', 'ABC-123'),
    );
  });

  it('rejects workspace paths outside the configured root', () => {
    expect(() =>
      assertWorkspacePathWithinRoot('/tmp/workspaces', '/tmp/other/ABC-123'),
    ).toThrow('workspace path escapes configured workspace root');
  });

  it('accepts workspace paths under the configured root', () => {
    expect(() =>
      assertWorkspacePathWithinRoot('/tmp/workspaces', '/tmp/workspaces/ABC-123'),
    ).not.toThrow();
  });
});
