import type { Issue } from '../spec/index.js';

export interface Tracker {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>>;
}
