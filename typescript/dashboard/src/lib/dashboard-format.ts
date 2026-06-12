export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  if (minutes === 0) {
    return `${remainderSeconds}s`;
  }
  return `${minutes}m ${remainderSeconds.toString().padStart(2, '0')}s`;
}

export function formatClockTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatUptime(serverTime: string, nowMs: number): string {
  const startedAt = new Date(serverTime).getTime();
  if (Number.isNaN(startedAt)) {
    return '--';
  }
  return formatDuration((nowMs - startedAt) / 1000);
}
