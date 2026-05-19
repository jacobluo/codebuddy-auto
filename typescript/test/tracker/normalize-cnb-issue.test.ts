import { describe, expect, it } from 'vitest';

import { normalizeCnbIssue } from '../../src/tracker/index.js';

describe('normalizeCnbIssue', () => {
  it('maps cnb issue payloads into the shared issue model', () => {
    const issue = normalizeCnbIssue({
      number: '101',
      title: 'Implement feature',
      body: 'Details',
      state: 'open',
      priority: 'P1',
      labels: [{ name: 'agent-ready' }, { name: 'blocked-by:#102' }],
      created_at: '2026-05-18T12:00:00Z',
      updated_at: '2026-05-18T13:00:00Z',
    });

    expect(issue).toEqual({
      id: '101',
      identifier: '#101',
      title: 'Implement feature',
      description: 'Details',
      priority: 1,
      state: 'open',
      branchName: null,
      url: null,
      labels: ['agent-ready', 'blocked-by:#102'],
      blockedBy: [{ id: '102', identifier: '#102', state: null }],
      createdAt: '2026-05-18T12:00:00Z',
      updatedAt: '2026-05-18T13:00:00Z',
    });
  });

  it('uses null for unsupported optional fields', () => {
    const issue = normalizeCnbIssue({
      number: 5,
      title: 'No extras',
      state: 'closed',
      labels: [],
    });

    expect(issue.priority).toBeNull();
    expect(issue.description).toBeNull();
    expect(issue.blockedBy).toEqual([]);
  });

  it('throws when required fields are missing', () => {
    expect(() => normalizeCnbIssue({ title: 'broken', state: 'open' })).toThrow(
      'cnb issue number is required',
    );
  });
});
