import type { DashboardConnectionState } from '../lib/dashboard-types.js';

interface DashboardToolbarProps {
  connectionState: DashboardConnectionState;
  isRefreshing: boolean;
  lastTickLabel: string;
  uptimeLabel: string;
  onRefresh: () => void | Promise<void>;
}

export function DashboardToolbar({
  connectionState,
  isRefreshing,
  lastTickLabel,
  uptimeLabel,
  onRefresh,
}: DashboardToolbarProps) {
  return (
    <section className="dashboard-toolbar" aria-label="dashboard runtime toolbar">
      <div className="dashboard-toolbar-group">
        <button
          className="dashboard-primary-button"
          type="button"
          onClick={() => {
            void onRefresh();
          }}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'refreshing…' : 'trigger refresh'}
        </button>
        <span className={`dashboard-connection-pill is-${connectionState}`}>{connectionState}</span>
      </div>
      <div className="dashboard-toolbar-group is-meta">
        <span className="dashboard-meta-chip">last tick {lastTickLabel}</span>
        <span className="dashboard-meta-chip">uptime {uptimeLabel}</span>
      </div>
    </section>
  );
}
