import { formatCompactNumber, formatDuration } from '../lib/dashboard-format.js';
import type { DashboardSnapshot } from '../lib/dashboard-types.js';

interface MetricGridProps {
  snapshot: DashboardSnapshot;
}

const METRIC_KEYS = [
  { label: 'running', value: (snapshot: DashboardSnapshot) => String(snapshot.counts.running) },
  { label: 'retrying', value: (snapshot: DashboardSnapshot) => String(snapshot.counts.retrying) },
  { label: 'claimed', value: (snapshot: DashboardSnapshot) => String(snapshot.counts.claimed) },
  { label: 'completed', value: (snapshot: DashboardSnapshot) => String(snapshot.counts.completed) },
  { label: 'tokens', value: (snapshot: DashboardSnapshot) => formatCompactNumber(snapshot.totals.totalTokens) },
  { label: 'runtime', value: (snapshot: DashboardSnapshot) => formatDuration(snapshot.totals.secondsRunning) },
] as const;

export function MetricGrid({ snapshot }: MetricGridProps) {
  return (
    <section className="dashboard-metric-grid" aria-label="dashboard metrics">
      {METRIC_KEYS.map((metric) => (
        <article className="dashboard-metric-card" key={metric.label}>
          <span className="dashboard-metric-label">{metric.label}</span>
          <strong className="dashboard-metric-value">{metric.value(snapshot)}</strong>
        </article>
      ))}
    </section>
  );
}
