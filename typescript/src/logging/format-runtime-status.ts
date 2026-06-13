import type { RuntimeSnapshot } from './runtime-snapshot.js';

function formatRunning(snapshot: RuntimeSnapshot): string[] {
  if (snapshot.running.length === 0) {
    return ['running: none'];
  }

  return snapshot.running.map((entry) => {
    return `running: ${entry.identifier} turn=${entry.turnCount} session=${entry.sessionId ?? '-'} event=${entry.lastEvent ?? '-'} seconds=${entry.secondsRunning} tokens=${entry.tokenUsage.totalTokens} credit=${entry.tokenUsage.creditCost}`;
  });
}

function formatRetrying(snapshot: RuntimeSnapshot): string[] {
  if (snapshot.retrying.length === 0) {
    return ['retrying: none'];
  }

  return snapshot.retrying.map((entry) => {
    return `retrying: ${entry.identifier} mode=${entry.mode} attempt=${entry.attempt} dueAtMs=${entry.dueAtMs} error=${entry.error ?? '-'}`;
  });
}

function formatStuck(snapshot: RuntimeSnapshot): string[] {
  if (snapshot.stuck.length === 0) {
    return ['stuck: none'];
  }

  return snapshot.stuck.map((entry) => {
    return `stuck: ${entry.identifier} reason=${entry.reason} repeated=${entry.repeatedCount} fingerprint=${entry.fingerprint}`;
  });
}

export function formatRuntimeStatus(snapshot: RuntimeSnapshot): string {
  const lines = [
    `generatedAt: ${snapshot.generatedAt}`,
    `counts: running=${snapshot.counts.running} retrying=${snapshot.counts.retrying} claimed=${snapshot.counts.claimed} completed=${snapshot.counts.completed}`,
    `totals: seconds=${snapshot.totals.secondsRunning} input=${snapshot.totals.inputTokens} output=${snapshot.totals.outputTokens} total=${snapshot.totals.totalTokens} cacheCreate=${snapshot.totals.cacheCreationInputTokens} cacheRead=${snapshot.totals.cacheReadInputTokens} credit=${snapshot.totals.creditCost}`,
    ...formatRunning(snapshot),
    ...formatRetrying(snapshot),
    ...formatStuck(snapshot),
    `completed: ${snapshot.completedIssueIds.length === 0 ? 'none' : snapshot.completedIssueIds.join(', ')}`,
    `cleanedWorkspaces: ${snapshot.cleanedWorkspaceIssueIds.length === 0 ? 'none' : snapshot.cleanedWorkspaceIssueIds.join(', ')}`,
  ];

  return `${lines.join('\n')}\n`;
}
