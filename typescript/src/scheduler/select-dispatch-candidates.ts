import type { Issue } from '../spec/index.js';

interface SelectDispatchCandidatesInput {
  issues: Issue[];
  activeStates: string[];
  terminalStates: string[];
  runningIssueIds: Set<string>;
  claimedIssueIds: Set<string>;
  maxConcurrentAgents: number;
  runningCount: number;
}

function normalizeState(state: string): string {
  return state.toLowerCase();
}

function isTodoState(state: string): boolean {
  return normalizeState(state) === 'todo';
}

function hasRequiredFields(issue: Issue): boolean {
  return issue.id.length > 0 && issue.identifier.length > 0 && issue.title.length > 0 && issue.state.length > 0;
}

function isBlocked(issue: Issue): boolean {
  if (!isTodoState(issue.state)) {
    return false;
  }

  return issue.blockedBy.some((blocker) => blocker.state !== null && normalizeState(blocker.state) !== 'closed');
}

function compareIssues(left: Issue, right: Issue): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const leftCreatedAt = left.createdAt ?? '9999-12-31T23:59:59.999Z';
  const rightCreatedAt = right.createdAt ?? '9999-12-31T23:59:59.999Z';
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt.localeCompare(rightCreatedAt);
  }

  return left.identifier.localeCompare(right.identifier);
}

export function selectDispatchCandidates(input: SelectDispatchCandidatesInput): Issue[] {
  const activeStates = new Set(input.activeStates.map(normalizeState));
  const terminalStates = new Set(input.terminalStates.map(normalizeState));
  const availableSlots = Math.max(input.maxConcurrentAgents - input.runningCount, 0);

  return input.issues
    .filter((issue) => hasRequiredFields(issue))
    .filter((issue) => activeStates.has(normalizeState(issue.state)))
    .filter((issue) => !terminalStates.has(normalizeState(issue.state)))
    .filter((issue) => !input.runningIssueIds.has(issue.id))
    .filter((issue) => !input.claimedIssueIds.has(issue.id))
    .filter((issue) => !isBlocked(issue))
    .sort(compareIssues)
    .slice(0, availableSlots);
}
