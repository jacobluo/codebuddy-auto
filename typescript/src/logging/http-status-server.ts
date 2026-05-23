import http from 'node:http';

import type { ServiceConfig } from '../spec/index.js';
import type { ServerStateController } from './server-state.js';

export interface StatusServerRuntime {
  address(): string | null;
  close(): Promise<void>;
}

function respondJson(response: http.ServerResponse, statusCode: number, payload: string): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(payload);
}

function respondText(response: http.ServerResponse, statusCode: number, payload: string): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(payload);
}

function getPathname(request: http.IncomingMessage): string {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  return url.pathname;
}

export async function startStatusServer(
  config: ServiceConfig,
  controller: ServerStateController,
): Promise<StatusServerRuntime> {
  const host = config.server.host;
  const port = config.server.port;
  if (port === undefined) {
    throw new Error('server.port is required to start the status server');
  }

  const server = http.createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const pathname = getPathname(request);

    if (method === 'GET' && pathname === '/') {
      respondText(response, 200, '<!doctype html><html><body><pre>agentfirst-f1 status server</pre></body></html>');
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/state') {
      respondJson(response, 200, controller.getSnapshot());
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

    respondJson(response, 404, JSON.stringify({
      error: {
        code: 'not_found',
        message: `unsupported route: ${pathname}`,
      },
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

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
