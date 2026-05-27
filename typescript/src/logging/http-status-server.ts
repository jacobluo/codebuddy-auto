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

function respondHtml(response: http.ServerResponse, statusCode: number, payload: string): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(payload);
}

function getPathname(request: http.IncomingMessage): string {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  return url.pathname;
}

function renderDashboardHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>agentfirst-f1 dashboard</title>',
    '<style>',
    ':root { color-scheme: light; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f3efe6; color: #1b1b1b; }',
    'body { margin: 0; background: radial-gradient(circle at top left, #f8d9a0, #f3efe6 45%, #d7e6de 100%); min-height: 100vh; }',
    'main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }',
    'h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0.02em; }',
    'p { margin: 0; line-height: 1.5; }',
    '.toolbar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 20px; }',
    'button { border: 0; background: #1b1b1b; color: #fff7ea; padding: 10px 14px; cursor: pointer; border-radius: 999px; font: inherit; }',
    '.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 20px; }',
    '.card, .panel { border: 1px solid rgba(27,27,27,0.12); border-radius: 18px; background: rgba(255,248,235,0.82); backdrop-filter: blur(8px); box-shadow: 0 10px 30px rgba(27,27,27,0.06); }',
    '.card { padding: 16px; }',
    '.card strong { display: block; font-size: 24px; margin-top: 6px; }',
    '.panels { display: grid; grid-template-columns: 1.1fr 1fr 1fr; gap: 14px; margin-top: 16px; }',
    '.panel { padding: 16px; min-height: 220px; }',
    '.panel h2 { margin: 0 0 12px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.08em; }',
    'ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }',
    'li { border-top: 1px dashed rgba(27,27,27,0.1); padding-top: 10px; }',
    'li:first-child { border-top: 0; padding-top: 0; }',
    '.muted { color: rgba(27,27,27,0.62); }',
    '.ok { color: #0b6b41; }',
    '.warn { color: #9a5a00; }',
    'pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; }',
    '@media (max-width: 860px) { .panels { grid-template-columns: 1fr; } main { padding: 24px 14px 32px; } }',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<h1>agentfirst-f1 dashboard</h1>',
    '<p class="muted">Runtime state over the existing status API. Refresh is pull-based on top of the daemon.</p>',
    '<div class="toolbar">',
    '<button id="refresh">queue refresh</button>',
    '<span id="refresh-state" class="muted">idle</span>',
    '<span id="generated-at" class="muted">loading...</span>',
    '</div>',
    '<section class="grid" id="counts"></section>',
    '<section class="panels">',
    '<div class="panel"><h2>Running</h2><ul id="running"></ul></div>',
    '<div class="panel"><h2>Retrying</h2><ul id="retrying"></ul></div>',
    '<div class="panel"><h2>Totals</h2><pre id="totals"></pre></div>',
    '</section>',
    '<script type="module">',
    'const counts = document.querySelector("#counts");',
    'const running = document.querySelector("#running");',
    'const retrying = document.querySelector("#retrying");',
    'const totals = document.querySelector("#totals");',
    'const generatedAt = document.querySelector("#generated-at");',
    'const refreshButton = document.querySelector("#refresh");',
    'const refreshState = document.querySelector("#refresh-state");',
    'function renderCounts(snapshot) {',
    '  const entries = [["running", snapshot.counts.running], ["retrying", snapshot.counts.retrying], ["claimed", snapshot.counts.claimed], ["completed", snapshot.counts.completed]];',
    '  counts.innerHTML = entries.map(([label, value]) => `<article class="card"><span class="muted">${label}</span><strong>${value}</strong></article>`).join("");',
    '}',
    'function renderRunning(snapshot) {',
    '  if (snapshot.running.length === 0) { running.innerHTML = `<li class="muted">no running issues</li>`; return; }',
    '  running.innerHTML = snapshot.running.map((entry) => `<li><div><strong>${entry.identifier}</strong> <span class="muted">turn ${entry.turnCount}</span></div><div class="muted">${entry.title}</div><div class="ok">${entry.lastEvent ?? "-"}</div><div class="muted">session ${entry.sessionId ?? "-"} · ${entry.secondsRunning}s · ${entry.tokenUsage.totalTokens} tok</div></li>`).join("");',
    '}',
    'function renderRetrying(snapshot) {',
    '  if (snapshot.retrying.length === 0) { retrying.innerHTML = `<li class="muted">no retry backlog</li>`; return; }',
    '  retrying.innerHTML = snapshot.retrying.map((entry) => `<li><div><strong>${entry.identifier}</strong> <span class="warn">${entry.mode}</span></div><div class="muted">attempt ${entry.attempt} · due ${entry.dueAtMs}</div><div class="muted">${entry.error ?? "-"}</div></li>`).join("");',
    '}',
    'function renderTotals(snapshot) {',
    '  totals.textContent = JSON.stringify(snapshot.totals, null, 2);',
    '}',
    'async function loadState() {',
    '  const response = await fetch("/api/v1/state", { cache: "no-store" });',
    '  const snapshot = await response.json();',
    '  generatedAt.textContent = `generated ${snapshot.generatedAt}`;',
    '  renderCounts(snapshot);',
    '  renderRunning(snapshot);',
    '  renderRetrying(snapshot);',
    '  renderTotals(snapshot);',
    '}',
    'refreshButton.addEventListener("click", async () => {',
    '  refreshState.textContent = "queueing refresh...";',
    '  const response = await fetch("/api/v1/refresh", { method: "POST" });',
    '  const body = await response.json();',
    '  refreshState.textContent = body.queued ? `queued at ${body.requestedAt}` : `already queued at ${body.requestedAt}`;',
    '  setTimeout(() => { void loadState(); }, 200);',
    '});',
    'void loadState();',
    'setInterval(() => { void loadState(); }, 5000);',
    '</script>',
    '</main>',
    '</body>',
    '</html>',
  ].join('');
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
      respondHtml(response, 200, renderDashboardHtml());
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
