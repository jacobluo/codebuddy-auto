import { normalizeCnbIssue } from './normalize-cnb-issue.js';
import type { Tracker } from './tracker.js';
import type { Issue } from '../spec/index.js';

interface CnbTrackerOptions {
  apiBaseUrl: string;
  repo: string;
  token: string;
  candidateLabel?: string;
  excludeLabel?: string;
  fetchFn?: typeof fetch;
}

interface IssueStateSnapshot {
  id: string;
  state: string;
  labels: string[];
}

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/$/, '')}${pathname}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`cnb api status error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export class CnbTracker implements Tracker {
  private readonly apiBaseUrl: string;
  private readonly repo: string;
  private readonly token: string;
  private readonly candidateLabel: string;
  private readonly excludeLabel: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: CnbTrackerOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '');
    this.repo = options.repo;
    this.token = options.token;
    this.candidateLabel = options.candidateLabel ?? 'agent-ready';
    this.excludeLabel = options.excludeLabel ?? 'skip-agent';
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async getJson<T>(pathname: string): Promise<T> {
    const response = await this.fetchFn(joinUrl(this.apiBaseUrl, pathname), {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    });

    return parseJsonResponse<T>(response);
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    const issues = await this.getJson<unknown[]>(
      `/${this.repo}/-/issues?labels=${encodeURIComponent(this.candidateLabel)}&state=open&page_size=100`,
    );

    return issues
      .map((issue) => normalizeCnbIssue(issue as Record<string, unknown>))
      .filter((issue) => !issue.labels.includes(this.excludeLabel));
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    if (states.length === 0) {
      return [];
    }

    const batches = await Promise.all(
      states.map((state) =>
        this.getJson<unknown[]>(
          `/${this.repo}/-/issues?state=${encodeURIComponent(state)}&page_size=100`,
        ),
      ),
    );

    return batches.flat().map((issue) => normalizeCnbIssue(issue as Record<string, unknown>));
  }

  async fetchIssueStatesByIds(issueIds: string[]): Promise<Map<string, IssueStateSnapshot>> {
    if (issueIds.length === 0) {
      return new Map();
    }

    const states = await Promise.all(
      issueIds.map(async (issueId) => {
        const issue = normalizeCnbIssue(
          await this.getJson<Record<string, unknown>>(`/${this.repo}/-/issues/${encodeURIComponent(issueId)}`),
        );

        return [
          issue.id,
          {
            id: issue.id,
            state: issue.state,
            labels: issue.labels,
          },
        ] as const;
      }),
    );

    return new Map(states);
  }
}
