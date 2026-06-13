import type { Issue } from '../spec/index.js';

interface SelectDispatchCandidatesInput {
  issues: Issue[];
  activeStates: string[];
  terminalStates: string[];
  runningIssueIds: Set<string>;
  runningStateCounts: Map<string, number>;
  claimedIssueIds: Set<string>;
  stuckIssueIds: Set<string>;
  maxConcurrentAgents: number;
  maxConcurrentAgentsByState: Record<string, number>;
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

function getPerStateRemainingSlots(
  issue: Issue,
  runningStateCounts: Map<string, number>,
  maxConcurrentAgentsByState: Record<string, number>,
): number {
  const stateKey = normalizeState(issue.state);
  const configuredLimit = maxConcurrentAgentsByState[stateKey];
  if (configuredLimit === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(configuredLimit - (runningStateCounts.get(stateKey) ?? 0), 0);
}

export function selectDispatchCandidates(input: SelectDispatchCandidatesInput): Issue[] {
  const activeStates = new Set(input.activeStates.map(normalizeState));
  const terminalStates = new Set(input.terminalStates.map(normalizeState));
  let availableSlots = Math.max(input.maxConcurrentAgents - input.runningCount, 0);
  const nextRunningStateCounts = new Map(input.runningStateCounts);

  const selected: Issue[] = [];

  for (const issue of input.issues
    .filter((candidate) => hasRequiredFields(candidate))
    .filter((candidate) => activeStates.has(normalizeState(candidate.state)))
    .filter((candidate) => !terminalStates.has(normalizeState(candidate.state)))
    .filter((candidate) => !input.runningIssueIds.has(candidate.id))
    .filter((candidate) => !input.claimedIssueIds.has(candidate.id))
    .filter((candidate) => !input.stuckIssueIds.has(candidate.id))
    .filter((candidate) => !isBlocked(candidate))
    .sort(compareIssues)) {
    if (availableSlots <= 0) {
      break;
    }

    const remainingPerState = getPerStateRemainingSlots(
      issue,
      nextRunningStateCounts,
      input.maxConcurrentAgentsByState,
    );
    if (remainingPerState <= 0) {
      continue;
    }

    selected.push(issue);
    availableSlots -= 1;
    const stateKey = normalizeState(issue.state);
    nextRunningStateCounts.set(stateKey, (nextRunningStateCounts.get(stateKey) ?? 0) + 1);
  }

  return selected;
}
