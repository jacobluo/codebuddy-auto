import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseWorkflow, resolveWorkflowPath } from '../../src/workflow/index.js';

describe('parseWorkflow', () => {
  it('parses front matter and trims the prompt body', () => {
    const workflow = `---
tracker:
  kind: cnb
workspace:
  root: ./workspaces
---

You are working on {{ issue.identifier }}.
`;

    const parsed = parseWorkflow(workflow, '/repo/WORKFLOW.md');

    expect(parsed.workflowPath).toBe('/repo/WORKFLOW.md');
    expect(parsed.config).toEqual({
      tracker: { kind: 'cnb' },
      workspace: { root: './workspaces' },
    });
    expect(parsed.promptTemplate).toBe('You are working on {{ issue.identifier }}.');
  });

  it('supports workflow files without front matter', () => {
    const parsed = parseWorkflow('  plain prompt  ', '/repo/WORKFLOW.md');

    expect(parsed.config).toEqual({});
    expect(parsed.promptTemplate).toBe('plain prompt');
  });

  it('rejects non-object front matter payloads', () => {
    const workflow = `---
- nope
---
body
`;

    expect(() => parseWorkflow(workflow, path.resolve('/repo/WORKFLOW.md'))).toThrow(
      'workflow front matter must decode to an object',
    );
  });

  it('uses WORKFLOW.md in the provided cwd when no explicit path is supplied', () => {
    expect(resolveWorkflowPath('WORKFLOW.md', '/repo')).toEqual({
      workflowPath: '/repo/WORKFLOW.md',
      explicit: false,
    });
  });

  it('preserves explicit relative workflow paths', () => {
    expect(resolveWorkflowPath('./ops/alt-workflow.md', '/repo')).toEqual({
      workflowPath: '/repo/ops/alt-workflow.md',
      explicit: true,
    });
  });
});
