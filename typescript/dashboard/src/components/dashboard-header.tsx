export function DashboardHeader() {
  return (
    <header className="dashboard-header">
      <div className="dashboard-topbar-copy">
        <p className="dashboard-kicker">live observability surface</p>
        <div className="dashboard-title-row">
          <h1>codebuddy-auto dashboard</h1>
          <span className="dashboard-topbar-badge">runtime surface</span>
        </div>
        <p className="dashboard-subtitle">Real-time agent orchestration · SSE live events</p>
      </div>
    </header>
  );
}
