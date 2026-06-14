import type {
  DashboardBootstrapPayload,
  DashboardEventsHistoryPayload,
  DashboardTranscriptPayload,
} from '../lib/dashboard-types.js';

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

export interface FetchIssueTranscriptOptions {
  apiBaseUrl?: string;
  after?: number;
  limit?: number;
}

export interface FetchDashboardEventsHistoryOptions {
  apiBaseUrl?: string;
  issueId?: string;
  after?: number;
  limit?: number;
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = await response.json() as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string' && message.length > 0) {
          return message;
        }
      }
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export async function fetchIssueTranscript(
  fetchImpl: typeof fetch,
  issueId: string,
  options: FetchIssueTranscriptOptions = {},
): Promise<DashboardTranscriptPayload> {
  const params = new URLSearchParams();
  if (options.after !== undefined) {
    params.set('after', String(options.after));
  }
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }

  const query = params.size > 0 ? `?${params.toString()}` : '';
  const response = await fetchImpl(withApiBase(
    options.apiBaseUrl,
    `/api/v1/issues/${encodeURIComponent(issueId)}/transcript${query}`,
  ));
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, `issue transcript failed with status ${response.status}`));
  }

  return response.json() as Promise<DashboardTranscriptPayload>;
}

export async function fetchDashboardEventsHistory(
  fetchImpl: typeof fetch,
  options: FetchDashboardEventsHistoryOptions = {},
): Promise<DashboardEventsHistoryPayload> {
  const params = new URLSearchParams();
  if (options.issueId !== undefined) {
    params.set('issueId', options.issueId);
  }
  if (options.after !== undefined) {
    params.set('after', String(options.after));
  }
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }

  const query = params.size > 0 ? `?${params.toString()}` : '';
  const response = await fetchImpl(withApiBase(options.apiBaseUrl, `/api/v1/events/history${query}`));
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, `dashboard event history failed with status ${response.status}`));
  }

  return response.json() as Promise<DashboardEventsHistoryPayload>;
}
