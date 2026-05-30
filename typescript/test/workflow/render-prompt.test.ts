import { describe, expect, it } from 'vitest';

import { renderPrompt } from '../../src/workflow/index.js';
import type { Issue } from '../../src/spec/index.js';

function makeIssue(): Issue {
  return {
    id: '1',
    identifier: '#1',
    title: 'Test issue',
    description: 'Details',
    priority: null,
    state: 'open',
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
  };
}

describe('renderPrompt', () => {
  it('renders issue and attempt variables', () => {
    expect(
      renderPrompt('Work on {{ issue.identifier }} turn {{ attempt.turnCount }}', {
        issue: makeIssue(),
        attempt: { turnCount: 1 },
      }),
    ).toBe('Work on #1 turn 1');
  });

  it('fails on unknown variables', () => {
    expect(() =>
      renderPrompt('Work on {{ issue.unknown }}', {
        issue: makeIssue(),
        attempt: { turnCount: 1 },
      }),
    ).toThrow('unknown template variable: issue.unknown');
  });

  it('renders null values as empty strings', () => {
    expect(
      renderPrompt('Details: {{ issue.description }}', {
        issue: {
          ...makeIssue(),
          description: null,
        },
        attempt: { turnCount: 1 },
      }),
    ).toBe('Details: ');
  });
});
