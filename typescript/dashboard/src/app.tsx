import { useEffect, useState } from 'react';

import { useDashboardState } from './hooks/use-dashboard-state.js';
import { DashboardPage } from './pages/dashboard-page.js';

export function App() {
  const state = useDashboardState();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const handle = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(handle);
    };
  }, []);

  return (
    <DashboardPage
      state={{
        ...state,
        onRefresh: state.triggerRefresh,
        onRetry: state.retryInitialization,
        onSelectIssue: state.selectIssue,
        nowMs,
      }}
    />
  );
}
