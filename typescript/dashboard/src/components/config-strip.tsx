import type { DashboardBootstrapPayload } from '../lib/dashboard-types.js';

interface ConfigStripProps {
  config: DashboardBootstrapPayload['config'];
  repoUrl: string | null;
}

export function ConfigStrip({ config, repoUrl }: ConfigStripProps) {
  return (
    <section className="dashboard-config-strip" aria-label="dashboard configuration summary">
      {repoUrl && config.tracker.projectSlug ? (
        <a className="dashboard-config-link" href={repoUrl} target="_blank" rel="noreferrer">
          {config.tracker.projectSlug}
        </a>
      ) : (
        <span className="dashboard-config-link is-muted">repo unavailable</span>
      )}
      <span>Tracker {config.tracker.kind}</span>
      <span>Poll {Math.round(config.polling.intervalMs / 1000)}s</span>
      <span>Concurrency {config.agent.maxConcurrentAgents}</span>
      <span>Max turns {config.agent.maxTurns}</span>
      <span>Worker {config.worker.kind}</span>
      <span>Workspace {config.workspace.mode}</span>
    </section>
  );
}
