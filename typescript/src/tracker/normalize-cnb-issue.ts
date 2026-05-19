import { issueSchema, type Issue } from '../spec/index.js';

interface CnbLabel {
  name?: unknown;
}

interface CnbIssue {
  number?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  priority?: unknown;
  labels?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

const BLOCKED_BY_PATTERN = /^blocked-by:#(\d+)$/;

function normalizeLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) {
    return [];
  }

  return labels
    .flatMap((label) => {
      if (typeof label === 'string') {
        return [label.toLowerCase()];
      }

      const candidate = label as CnbLabel;
      return typeof candidate.name === 'string' ? [candidate.name.toLowerCase()] : [];
    });
}

function normalizePriority(priority: unknown): number | null {
  if (typeof priority !== 'string') {
    return null;
  }

  const match = priority.match(/^P(\d+)$/i);
  if (!match || match[1] === undefined) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function normalizeBlockedBy(labels: string[]) {
  return labels.flatMap((label) => {
    const match = label.match(BLOCKED_BY_PATTERN);
    if (!match || match[1] === undefined) {
      return [];
    }

    return [{
      id: match[1],
      identifier: `#${match[1]}`,
      state: null,
    }];
  });
}

export function normalizeCnbIssue(rawIssue: CnbIssue): Issue {
  if (typeof rawIssue.number !== 'string' && typeof rawIssue.number !== 'number') {
    throw new Error('cnb issue number is required');
  }
  if (typeof rawIssue.title !== 'string') {
    throw new Error('cnb issue title is required');
  }
  if (typeof rawIssue.state !== 'string') {
    throw new Error('cnb issue state is required');
  }

  const id = String(rawIssue.number);
  const labels = normalizeLabels(rawIssue.labels);

  return issueSchema.parse({
    id,
    identifier: `#${id}`,
    title: rawIssue.title,
    description: typeof rawIssue.body === 'string' ? rawIssue.body : null,
    priority: normalizePriority(rawIssue.priority),
    state: rawIssue.state.toLowerCase(),
    branchName: null,
    url: null,
    labels,
    blockedBy: normalizeBlockedBy(labels),
    createdAt: typeof rawIssue.created_at === 'string' ? rawIssue.created_at : null,
    updatedAt: typeof rawIssue.updated_at === 'string' ? rawIssue.updated_at : null,
  });
}
