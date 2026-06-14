import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ServiceConfig } from '../spec/index.js';
import { TranscriptStoreUnavailableError, type HistoricalIssueSummary, type TranscriptEvent, type TranscriptStore } from '../transcript/index.js';
import type { DashboardEvent, EventBus } from './event-bus.js';
import type { ServerStateController } from './server-state.js';

export interface StatusServerRuntime {
  address(): string | null;
  close(): Promise<void>;
}

interface DashboardBootstrapPayload {
  config: {
    tracker: {
      kind: string;
      projectSlug: string | null;
    };
    polling: {
      intervalMs: number;
    };
    agent: {
      maxConcurrentAgents: number;
      maxTurns: number;
    };
    worker: {
      kind: string;
    };
    workspace: {
      mode: string;
    };
  };
  repoUrl: string | null;
  serverTime: string;
  snapshot: Record<string, unknown>;
}

interface DashboardSseEnvelope {
  id?: number;
  type: DashboardEvent['type'];
  timestamp: string;
  issueId?: string;
  payload: Record<string, unknown>;
}

interface TranscriptResponsePayload {
  issueId: string;
  events: TranscriptEvent[];
  nextAfter: number | null;
}

interface DashboardEventsHistoryPayload {
  events: DashboardSseEnvelope[];
  nextAfter: number | null;
}

interface HistoricalIssuesPayload {
  issues: HistoricalIssueSummary[];
  nextAfter: number | null;
}

const DASHBOARD_SNAPSHOT_EVENT_ID = 0;
const DASHBOARD_STATIC_ROOT_CANDIDATES = [
  '../../dist/dashboard',
  '../../../dist/dashboard',
] as const;

function respondJson(response: http.ServerResponse, statusCode: number, payload: string): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(payload);
}

function respondBuffer(
  response: http.ServerResponse,
  statusCode: number,
  contentType: string,
  payload: Buffer,
): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', contentType);
  response.end(payload);
}

function getPathname(request: http.IncomingMessage): string {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  return url.pathname;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSnapshot(controller: ServerStateController): Record<string, unknown> {
  const snapshot = JSON.parse(controller.getSnapshot()) as unknown;
  if (!isRecord(snapshot)) {
    throw new Error('status snapshot must be a JSON object');
  }
  return snapshot;
}

function getSnapshotTimestamp(snapshot: Record<string, unknown>): string {
  const generatedAt = snapshot.generatedAt;
  return typeof generatedAt === 'string' ? generatedAt : new Date().toISOString();
}

function parsePositiveIntegerQuery(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createBootstrapPayload(
  config: ServiceConfig,
  controller: ServerStateController,
): DashboardBootstrapPayload {
  const projectSlug = config.tracker.projectSlug ?? null;
  const repoUrl = projectSlug ? `https://cnb.cool/${projectSlug}` : null;

  return {
    config: {
      tracker: {
        kind: config.tracker.kind,
        projectSlug,
      },
      polling: {
        intervalMs: config.polling.intervalMs,
      },
      agent: {
        maxConcurrentAgents: config.agent.maxConcurrentAgents,
        maxTurns: config.agent.maxTurns,
      },
      worker: {
        kind: config.worker.kind,
      },
      workspace: {
        mode: config.workspace.mode,
      },
    },
    repoUrl,
    serverTime: new Date().toISOString(),
    snapshot: parseSnapshot(controller),
  };
}

function createSseEnvelope(event: DashboardEvent): DashboardSseEnvelope {
  const envelope: DashboardSseEnvelope = {
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    payload: event.payload,
  };

  if (event.issueId) {
    envelope.issueId = event.issueId;
  }

  return envelope;
}

function writeSseEvent(
  response: http.ServerResponse,
  eventId: number,
  eventType: DashboardEvent['type'],
  envelope: DashboardSseEnvelope,
): void {
  response.write(`id: ${eventId}\nevent: ${eventType}\ndata: ${JSON.stringify(envelope)}\n\n`);
}

function getContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function resolveDashboardStaticRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of DASHBOARD_STATIC_ROOT_CANDIDATES) {
    const resolved = path.resolve(moduleDir, candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  return path.resolve(moduleDir, DASHBOARD_STATIC_ROOT_CANDIDATES[0]);
}

function isListenError(error: unknown): error is { code?: unknown } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function resolveDashboardAssetPath(dashboardRoot: string, pathname: string): string | null {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//u, '');
  const absolutePath = path.resolve(dashboardRoot, relativePath);
  const relativeToRoot = path.relative(dashboardRoot, absolutePath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null;
  }
  return absolutePath;
}

async function serveDashboardAsset(
  response: http.ServerResponse,
  dashboardRoot: string,
  pathname: string,
): Promise<boolean> {
  const filePath = resolveDashboardAssetPath(dashboardRoot, pathname);
  if (!filePath) {
    respondJson(response, 404, JSON.stringify({
      error: {
        code: 'not_found',
        message: `unsupported route: ${pathname}`,
      },
    }));
    return true;
  }

  try {
    const payload = await readFile(filePath);
    respondBuffer(response, 200, getContentType(filePath), payload);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      respondJson(response, pathname === '/'
        ? 503
        : 404, JSON.stringify({
        error: {
          code: pathname === '/' ? 'dashboard_assets_missing' : 'not_found',
          message: pathname === '/'
            ? 'dashboard frontend assets are missing; run the dashboard build first'
            : `unsupported route: ${pathname}`,
        },
      }));
      return true;
    }

    throw error;
  }
}

export async function startStatusServer(
  config: ServiceConfig,
  controller: ServerStateController,
  eventBus?: EventBus,
  transcriptStore?: TranscriptStore,
): Promise<StatusServerRuntime> {
  const host = config.server.host;
  const port = config.server.port;
  if (port === undefined) {
    throw new Error('server.port is required to start the status server');
  }

  const dashboardRoot = resolveDashboardStaticRoot();

  const server = http.createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const pathname = getPathname(request);

    if (method === 'GET' && pathname === '/api/v1/dashboard/bootstrap') {
      respondJson(response, 200, JSON.stringify(createBootstrapPayload(config, controller)));
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/state') {
      respondJson(response, 200, controller.getSnapshot());
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/issues/history') {
      if (!transcriptStore) {
        respondJson(response, 503, JSON.stringify({
          error: {
            code: 'issue_history_unavailable',
            message: 'transcript store is not configured',
          },
        }));
        return;
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const after = parsePositiveIntegerQuery(url.searchParams.get('after'), 0);
      const limit = Math.min(parsePositiveIntegerQuery(url.searchParams.get('limit'), 50), 200);

      try {
        const issues = transcriptStore.listHistoricalIssues({ after, limit });
        const payload: HistoricalIssuesPayload = {
          issues,
          nextAfter: issues.length > 0 ? after + issues.length : null,
        };
        respondJson(response, 200, JSON.stringify(payload));
      } catch (error) {
        if (error instanceof TranscriptStoreUnavailableError) {
          respondJson(response, 503, JSON.stringify({
            error: {
              code: 'issue_history_unavailable',
              message: error.message,
            },
          }));
          return;
        }
        throw error;
      }
      return;
    }

    if (method === 'GET' && pathname.startsWith('/api/v1/issues/') && pathname.endsWith('/transcript')) {
      if (!transcriptStore) {
        respondJson(response, 503, JSON.stringify({
          error: {
            code: 'transcript_unavailable',
            message: 'transcript store is not configured',
          },
        }));
        return;
      }

      const issueId = decodeURIComponent(
        pathname.slice('/api/v1/issues/'.length, -'/transcript'.length),
      );
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const after = parsePositiveIntegerQuery(url.searchParams.get('after'), 0);
      const limit = Math.min(parsePositiveIntegerQuery(url.searchParams.get('limit'), 200), 500);

      try {
        const events = transcriptStore.listEvents(issueId, { after, limit });
        if (events.length === 0 && controller.getIssue(issueId) === null && !transcriptStore.hasIssueHistory(issueId)) {
          respondJson(response, 404, JSON.stringify({
            error: {
              code: 'transcript_not_found',
              message: `unknown transcript issue: ${issueId}`,
            },
          }));
          return;
        }

        const payload: TranscriptResponsePayload = {
          issueId,
          events,
          nextAfter: events.at(-1)?.id ?? null,
        };
        respondJson(response, 200, JSON.stringify(payload));
      } catch (error) {
        if (error instanceof TranscriptStoreUnavailableError) {
          respondJson(response, 503, JSON.stringify({
            error: {
              code: 'transcript_unavailable',
              message: error.message,
            },
          }));
          return;
        }
        throw error;
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/v1/refresh') {
      const refresh = controller.requestRefresh();
      respondJson(response, 202, JSON.stringify({
        queued: refresh.queued,
        requestedAt: refresh.requestedAt,
        operations: ['poll', 'reconcile'],
      }));
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/events/history') {
      if (!transcriptStore) {
        respondJson(response, 503, JSON.stringify({
          error: {
            code: 'event_history_unavailable',
            message: 'transcript store is not configured',
          },
        }));
        return;
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const issueId = url.searchParams.get('issueId') ?? undefined;
      const after = parsePositiveIntegerQuery(url.searchParams.get('after'), 0);
      const limit = Math.min(parsePositiveIntegerQuery(url.searchParams.get('limit'), 200), 500);

      try {
        const events = transcriptStore.listDashboardEvents({ issueId, after, limit });
        const payload: DashboardEventsHistoryPayload = {
          events: events.map((event) => createSseEnvelope(event)),
          nextAfter: events.at(-1)?.id ?? null,
        };
        respondJson(response, 200, JSON.stringify(payload));
      } catch (error) {
        if (error instanceof TranscriptStoreUnavailableError) {
          respondJson(response, 503, JSON.stringify({
            error: {
              code: 'event_history_unavailable',
              message: error.message,
            },
          }));
          return;
        }
        throw error;
      }
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/events') {
      if (!eventBus) {
        respondJson(response, 503, JSON.stringify({ error: { code: 'event_bus_unavailable', message: 'EventBus not configured' } }));
        return;
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const filterIssueId = url.searchParams.get('issueId') ?? undefined;
      const lastEventId = request.headers['last-event-id'];
      const lastId = typeof lastEventId === 'string' ? Number.parseInt(lastEventId, 10) : 0;

      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();

      if (Number.isFinite(lastId) && lastId > 0) {
        const history = eventBus.history(filterIssueId);
        for (const event of history) {
          if (event.id > lastId) {
            writeSseEvent(response, event.id, event.type, createSseEnvelope(event));
          }
        }
      } else if (!filterIssueId) {
        const snapshot = parseSnapshot(controller);
        writeSseEvent(response, DASHBOARD_SNAPSHOT_EVENT_ID, 'state_snapshot', {
          type: 'state_snapshot',
          timestamp: getSnapshotTimestamp(snapshot),
          payload: snapshot,
        });
      }

      const unsubscribe = eventBus.subscribe((event) => {
        if (filterIssueId && event.issueId !== filterIssueId) {
          return;
        }
        if (filterIssueId && event.type === 'state_snapshot') {
          return;
        }
        writeSseEvent(response, event.id, event.type, createSseEnvelope(event));
      });

      const keepaliveHandle = setInterval(() => {
        response.write(':keepalive\n\n');
      }, 15000);

      request.on('close', () => {
        unsubscribe();
        clearInterval(keepaliveHandle);
      });
      return;
    }

    if (method === 'GET' && pathname.startsWith('/api/v1/')) {
      const identifier = decodeURIComponent(pathname.slice('/api/v1/'.length));
      const issueJson = controller.getIssue(identifier);
      if (issueJson === null) {
        respondJson(response, 404, JSON.stringify({
          error: {
            code: 'issue_not_found',
            message: `unknown issue identifier: ${identifier}`,
          },
        }));
        return;
      }

      respondJson(response, 200, issueJson);
      return;
    }

    if (method === 'GET') {
      const served = await serveDashboardAsset(response, dashboardRoot, pathname);
      if (served) {
        return;
      }
    }

    respondJson(response, 404, JSON.stringify({
      error: {
        code: 'not_found',
        message: `unsupported route: ${pathname}`,
      },
    }));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    if (isListenError(error) && error.code === 'EADDRINUSE') {
      throw new Error(`dashboard server port ${host}:${port} is already in use; stop the existing process or set server.port to another value (0 picks an available port)`);
    }
    throw error;
  }

  return {
    address(): string | null {
      const address = server.address();
      if (!address || typeof address === 'string') {
        return null;
      }
      return `http://${host}:${address.port}`;
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
