import type { DashboardBootstrapPayload } from '../lib/dashboard-types.js';

function withApiBase(apiBaseUrl: string | undefined, pathname: string): string {
  return `${apiBaseUrl ?? ''}${pathname}`;
}

export async function fetchDashboardBootstrap(
  fetchImpl: typeof fetch,
  apiBaseUrl?: string,
): Promise<DashboardBootstrapPayload> {
  const response = await fetchImpl(withApiBase(apiBaseUrl, '/api/v1/dashboard/bootstrap'));
  if (!response.ok) {
    throw new Error(`dashboard bootstrap failed with status ${response.status}`);
  }

  return response.json() as Promise<DashboardBootstrapPayload>;
}

export async function requestDashboardRefresh(
  fetchImpl: typeof fetch,
  apiBaseUrl?: string,
): Promise<void> {
  const response = await fetchImpl(withApiBase(apiBaseUrl, '/api/v1/refresh'), {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`dashboard refresh failed with status ${response.status}`);
  }
}
