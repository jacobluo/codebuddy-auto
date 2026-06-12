import type { DashboardEventSourceLike } from '../lib/dashboard-types.js';

function withApiBase(apiBaseUrl: string | undefined, pathname: string): string {
  return `${apiBaseUrl ?? ''}${pathname}`;
}

export function getDashboardEventsUrl(apiBaseUrl?: string): string {
  return withApiBase(apiBaseUrl, '/api/v1/events');
}

export function createBrowserEventSource(url: string): DashboardEventSourceLike {
  return new EventSource(url) as unknown as DashboardEventSourceLike;
}
