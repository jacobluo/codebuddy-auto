import type { Issue } from '../spec/index.js';

export interface Tracker {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>>;
  /** Close an issue on the tracker. Optional — implementations may be no-op. */
  closeIssue?(issueId: string, reason?: string): Promise<void>;
  /** Add a label to an issue. Optional. */
  addLabel?(issueId: string, label: string): Promise<void>;
  /** Get the configured finish label (signals agent completion). */
  getFinishLabel?(): string;
}
