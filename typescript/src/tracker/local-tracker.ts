import fs from 'node:fs/promises';
import path from 'node:path';

import { issueSchema, type Issue } from '../spec/index.js';
import type { Tracker } from './tracker.js';

interface LocalTrackerOptions {
  rootDir: string;
  activeStates: string[];
}

function normalizeState(state: string): string {
  return state.toLowerCase();
}

async function readIssueFile(issuePath: string): Promise<Issue> {
  const source = await fs.readFile(issuePath, 'utf8');
  return issueSchema.parse(JSON.parse(source));
}

export class LocalTracker implements Tracker {
  private readonly rootDir: string;
  private readonly activeStates: Set<string>;

  constructor(options: LocalTrackerOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.activeStates = new Set(options.activeStates.map(normalizeState));
  }

  private async readAllIssues(): Promise<Issue[]> {
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const issueFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(this.rootDir, entry.name));

    return Promise.all(issueFiles.map((issuePath) => readIssueFile(issuePath)));
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    const issues = await this.readAllIssues();
    return issues.filter((issue) => this.activeStates.has(normalizeState(issue.state)));
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    if (states.length === 0) {
      return [];
    }

    const wantedStates = new Set(states.map(normalizeState));
    const issues = await this.readAllIssues();
    return issues.filter((issue) => wantedStates.has(normalizeState(issue.state)));
  }

  async fetchIssueStatesByIds(issueIds: string[]): Promise<Map<string, Pick<Issue, 'id' | 'state' | 'labels'>>> {
    if (issueIds.length === 0) {
      return new Map();
    }

    const wantedIds = new Set(issueIds);
    const issues = await this.readAllIssues();

    return new Map(
      issues
        .filter((issue) => wantedIds.has(issue.id))
        .map((issue) => [issue.id, { id: issue.id, state: issue.state, labels: issue.labels }]),
    );
  }
}
