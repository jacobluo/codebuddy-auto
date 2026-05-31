import http from 'node:http';

import type { ServiceConfig } from '../spec/index.js';
import type { EventBus } from './event-bus.js';
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

function renderDashboardHtml(config: ServiceConfig): string {
  const repoUrl = config.tracker.projectSlug ? `https://cnb.cool/${config.tracker.projectSlug}` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>codebuddy-auto dashboard</title>
<style>
:root { color-scheme: light; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f3efe6; color: #1b1b1b; }
body { margin: 0; background: radial-gradient(circle at top left, #f8d9a0, #f3efe6 45%, #d7e6de 100%); min-height: 100vh; }
main { max-width: 1400px; margin: 0 auto; padding: 24px 20px 48px; }
h1 { margin: 0 0 4px; font-size: 24px; }
.subtitle { color: rgba(27,27,27,0.6); margin: 0 0 8px; font-size: 13px; }
.config-bar { display: flex; flex-wrap: wrap; gap: 12px; padding: 10px 14px; margin-bottom: 16px; border-radius: 10px; background: rgba(27,27,27,0.04); border: 1px solid rgba(27,27,27,0.08); font-size: 12px; color: rgba(27,27,27,0.7); }
.config-bar a { color: #1b1b1b; text-decoration: none; font-weight: 600; }
.config-bar a:hover { text-decoration: underline; }
.config-bar .sep { color: rgba(27,27,27,0.2); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 16px; }
.card { border: 1px solid rgba(27,27,27,0.1); border-radius: 14px; background: rgba(255,248,235,0.85); padding: 12px; text-align: center; }
.card strong { display: block; font-size: 22px; margin-top: 4px; }
.card span { font-size: 11px; color: rgba(27,27,27,0.55); text-transform: uppercase; }
.layout { display: grid; grid-template-columns: 320px 1fr; gap: 16px; }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } }
.panel { border: 1px solid rgba(27,27,27,0.1); border-radius: 14px; background: rgba(255,248,235,0.85); padding: 16px; min-height: 400px; }
.panel h2 { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; }
.issue-item { padding: 10px; border-radius: 8px; cursor: pointer; margin-bottom: 6px; border: 1px solid transparent; }
.issue-item:hover { background: rgba(27,27,27,0.04); }
.issue-item.active { border-color: #1b1b1b; background: rgba(27,27,27,0.06); }
.issue-item .id { font-weight: bold; }
.issue-item .meta { font-size: 11px; color: rgba(27,27,27,0.55); margin-top: 2px; }
.event-list { list-style: none; padding: 0; margin: 0; max-height: 500px; overflow-y: auto; }
.event-list li { padding: 8px 6px; border-bottom: 1px dashed rgba(27,27,27,0.08); font-size: 12px; cursor: pointer; border-radius: 4px; transition: background 0.15s; }
.event-list li:hover { background: rgba(27,27,27,0.03); }
.event-list .ev-row { display: grid; grid-template-columns: 22px 62px 110px 1fr; gap: 6px; align-items: center; }
.event-list .ev-icon { font-size: 13px; text-align: center; }
.event-list .time { color: rgba(27,27,27,0.45); font-size: 11px; }
.event-list .type { font-weight: 600; font-size: 11px; }
.event-list .type.t-session { color: #0b6b41; }
.event-list .type.t-completed { color: #1a7f37; }
.event-list .type.t-failed { color: #cf222e; }
.event-list .type.t-tool { color: #6639ba; }
.event-list .type.t-notification { color: #0969da; }
.event-list .type.t-other { color: rgba(27,27,27,0.55); }
.event-list .msg { color: rgba(27,27,27,0.7); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event-list .ev-detail { display: none; margin-top: 6px; padding: 8px 10px; background: rgba(27,27,27,0.03); border-radius: 6px; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: rgba(27,27,27,0.65); max-height: 200px; overflow-y: auto; }
.event-list li.expanded .ev-detail { display: block; }
.ev-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 6px; }
.ev-badge.tokens { background: rgba(26,127,55,0.1); color: #1a7f37; }
.ev-badge.duration { background: rgba(9,105,218,0.1); color: #0969da; }
.ev-badge.tool-name { background: rgba(102,57,186,0.1); color: #6639ba; }
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.dot-running { background: #0b6b41; }
.dot-retrying { background: #9a5a00; }
.empty { color: rgba(27,27,27,0.4); font-style: italic; padding: 20px 0; }
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
button { border: 0; background: #1b1b1b; color: #fff; padding: 8px 14px; cursor: pointer; border-radius: 999px; font: inherit; font-size: 12px; }
#conn-status { font-size: 11px; color: rgba(27,27,27,0.5); }
</style>
</head>
<body>
<main>
<h1>codebuddy-auto dashboard</h1>
<p class="subtitle">Real-time agent orchestration · SSE live events</p>
<div class="config-bar">
  ${repoUrl ? `<span>Repo: <a href="${repoUrl}" target="_blank">${config.tracker.projectSlug}</a></span><span class="sep">|</span>` : ''}
  <span>Tracker: ${config.tracker.kind}</span><span class="sep">|</span>
  <span>Poll: ${config.polling.intervalMs / 1000}s</span><span class="sep">|</span>
  <span>Concurrency: ${config.agent.maxConcurrentAgents}</span><span class="sep">|</span>
  <span>Max turns: ${config.agent.maxTurns}</span><span class="sep">|</span>
  <span>Worker: ${config.worker.kind}</span><span class="sep">|</span>
  <span>Workspace: ${config.workspace.mode}</span>
</div>
<div class="toolbar">
  <button id="refresh-btn">trigger refresh</button>
  <span id="conn-status">connecting...</span>
  <span id="uptime" style="margin-left:auto;font-size:11px;color:rgba(27,27,27,0.5);">uptime: --</span>
  <span id="last-tick" style="font-size:11px;color:rgba(27,27,27,0.5);">last tick: --</span>
</div>
<section class="grid" id="counts"></section>
<section class="layout">
  <div class="panel" id="issue-panel">
    <h2>Issues</h2>
    <div id="issue-list"><p class="empty">waiting for data...</p></div>
    <div id="completed-section" style="margin-top:16px;display:none;">
      <h2 style="font-size:12px;text-transform:uppercase;color:rgba(27,27,27,0.5);">Completed</h2>
      <div id="completed-list"></div>
    </div>
  </div>
  <div class="panel" id="detail-panel">
    <h2>Live Events <span id="detail-issue" style="font-weight:normal;font-size:12px;"></span></h2>
    <div id="detail-meta" style="font-size:11px;color:rgba(27,27,27,0.55);margin-bottom:10px;display:none;"></div>
    <ul class="event-list" id="event-list"></ul>
    <p class="empty" id="detail-empty">select an issue to see live events</p>
  </div>
</section>
</main>
<script type="module">
const countEl = document.getElementById('counts');
const issueListEl = document.getElementById('issue-list');
const eventListEl = document.getElementById('event-list');
const detailEmpty = document.getElementById('detail-empty');
const detailIssue = document.getElementById('detail-issue');
const detailMeta = document.getElementById('detail-meta');
const connStatus = document.getElementById('conn-status');
const refreshBtn = document.getElementById('refresh-btn');
const uptimeEl = document.getElementById('uptime');
const lastTickEl = document.getElementById('last-tick');
const completedSection = document.getElementById('completed-section');
const completedList = document.getElementById('completed-list');

const startedAt = Date.now();
let selectedIssueId = null;
let issueEventSource = null;
let latestState = null;
const issueEvents = new Map();
const repoSlug = '${config.tracker.projectSlug || ''}';

setInterval(() => {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); const s = secs % 60;
  uptimeEl.textContent = 'uptime: ' + (h ? h+'h ':'') + m+'m ' + s+'s';
}, 1000);

const globalEs = new EventSource('/api/v1/events');
globalEs.onopen = () => { connStatus.textContent = '● connected'; connStatus.style.color = '#0b6b41'; };
globalEs.onerror = () => {
  if (globalEs.readyState === EventSource.CONNECTING) {
    connStatus.textContent = '○ reconnecting...'; connStatus.style.color = '#9a5a00';
  } else if (globalEs.readyState === EventSource.CLOSED) {
    connStatus.textContent = '✗ disconnected'; connStatus.style.color = '#cf222e';
  }
};
globalEs.onmessage = () => {
  if (connStatus.textContent !== '● connected') {
    connStatus.textContent = '● connected'; connStatus.style.color = '#0b6b41';
  }
};

globalEs.addEventListener('state_snapshot', (e) => {
  latestState = JSON.parse(e.data);
  lastTickEl.textContent = 'last tick: ' + new Date(latestState.generatedAt || Date.now()).toLocaleTimeString();
  renderState(latestState);
});

globalEs.addEventListener('scheduler_event', (e) => {
  const data = JSON.parse(e.data);
  if (data.issueId) appendIssueEvent(data.issueId, data);
});

globalEs.addEventListener('issue_event', (e) => {
  const data = JSON.parse(e.data);
  if (data.issueId) appendIssueEvent(data.issueId, data);
});

function appendIssueEvent(issueId, data) {
  if (!issueEvents.has(issueId)) issueEvents.set(issueId, []);
  const list = issueEvents.get(issueId);
  list.push(data);
  if (list.length > 200) list.splice(0, list.length - 200);
  if (issueId === selectedIssueId) renderEvents();
}

function issueLink(identifier, issueId) {
  if (!repoSlug) return identifier;
  return '<a href="https://cnb.cool/' + repoSlug + '/-/issues/' + issueId + '" target="_blank" style="color:inherit;text-decoration:underline dotted;">' + identifier + '</a>';
}

function renderState(state) {
  if (!state) return;
  const c = state.counts || {};
  const t = state.totals || {};
  countEl.innerHTML = ['running','retrying','claimed','completed'].map(k =>
    '<article class="card"><span>' + k + '</span><strong>' + (c[k]||0) + '</strong></article>'
  ).join('') +
  '<article class="card"><span>tokens</span><strong>' + formatNum(t.totalTokens||0) + '</strong></article>' +
  '<article class="card"><span>runtime</span><strong>' + formatSecs(t.secondsRunning||0) + '</strong></article>';

  let html = '';
  for (const r of (state.running||[])) {
    const active = r.issueId === selectedIssueId ? ' active' : '';
    html += '<div class="issue-item' + active + '" data-id="' + r.issueId + '" data-workspace="' + (r.workspacePath||'') + '" data-identifier="' + r.identifier + '">' +
      '<div class="id"><span class="status-dot dot-running"></span>' + issueLink(r.identifier, r.issueId) + ' <span style="font-weight:normal;font-size:11px;color:rgba(27,27,27,0.4);">' + (r.title||'') + '</span></div>' +
      '<div class="meta">turn ' + r.turnCount + '/' + ${config.agent.maxTurns} + ' · ' + Math.round(r.secondsRunning) + 's · ' + (r.lastEvent||'') + ' · ' + formatNum(r.tokenUsage?.totalTokens||0) + ' tok</div></div>';
  }
  for (const r of (state.retrying||[])) {
    const active = r.issueId === selectedIssueId ? ' active' : '';
    html += '<div class="issue-item' + active + '" data-id="' + r.issueId + '" data-identifier="' + r.identifier + '">' +
      '<div class="id"><span class="status-dot dot-retrying"></span>' + issueLink(r.identifier, r.issueId) + '</div>' +
      '<div class="meta">' + r.mode + ' attempt ' + r.attempt + ' · due ' + new Date(r.dueAtMs).toLocaleTimeString() + '</div></div>';
  }
  issueListEl.innerHTML = html || '<p class="empty">no active issues</p>';
  issueListEl.querySelectorAll('.issue-item').forEach(el => {
    el.addEventListener('click', () => selectIssue(el.dataset.id, el.dataset.workspace, el.dataset.identifier));
  });

  // Completed issues
  const completed = state.completedIssueIds || [];
  if (completed.length > 0) {
    completedSection.style.display = '';
    completedList.innerHTML = completed.map(id => '<div style="font-size:12px;padding:3px 0;color:rgba(27,27,27,0.5);">✓ #' + id + '</div>').join('');
  } else {
    completedSection.style.display = 'none';
  }
}

function selectIssue(issueId, workspace, identifier) {
  selectedIssueId = issueId;
  detailIssue.textContent = '— ' + (identifier || issueId);
  detailEmpty.style.display = 'none';
  eventListEl.style.display = '';
  detailMeta.style.display = '';
  let metaHtml = '';
  if (repoSlug) metaHtml += '<a href="https://cnb.cool/' + repoSlug + '/-/issues/' + issueId + '" target="_blank">View issue on cnb.cool</a>';
  if (workspace) metaHtml += (metaHtml ? ' · ' : '') + 'Workspace: <code>' + workspace + '</code>';
  detailMeta.innerHTML = metaHtml;
  renderEvents();
  if (latestState) renderState(latestState);

  if (issueEventSource) issueEventSource.close();
  issueEventSource = new EventSource('/api/v1/events?issueId=' + encodeURIComponent(issueId));
  issueEventSource.addEventListener('issue_event', (e) => {
    appendIssueEvent(issueId, JSON.parse(e.data));
  });
  issueEventSource.addEventListener('scheduler_event', (e) => {
    appendIssueEvent(issueId, JSON.parse(e.data));
  });
}

function renderEvents() {
  const events = issueEvents.get(selectedIssueId) || [];
  if (events.length === 0) {
    eventListEl.innerHTML = '<li><span class="msg">waiting for events...</span></li>';
    return;
  }
  eventListEl.innerHTML = events.slice(-100).map((ev, idx) => {
    const t = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : '';
    const rawType = ev.event || ev.payload?.event || ev.type || 'unknown';
    const { icon, cls, label } = classifyEvent(rawType);
    const msg = formatEventMessage(rawType, ev.payload);
    const badges = formatBadges(rawType, ev.payload);
    const detail = JSON.stringify(ev.payload, null, 2);
    return '<li>' +
      '<div class="ev-row">' +
        '<span class="ev-icon">' + icon + '</span>' +
        '<span class="time">' + t + '</span>' +
        '<span class="type ' + cls + '">' + label + badges + '</span>' +
        '<span class="msg">' + escHtml(msg) + '</span>' +
      '</div>' +
      '<div class="ev-detail">' + escHtml(detail) + '</div>' +
    '</li>';
  }).join('');
  eventListEl.scrollTop = eventListEl.scrollHeight;
}

function classifyEvent(type) {
  const map = {
    session_started: { icon: '●', cls: 't-session', label: 'session' },
    turn_completed:  { icon: '✓', cls: 't-completed', label: 'completed' },
    turn_failed:     { icon: '✗', cls: 't-failed', label: 'failed' },
    turn_timed_out:  { icon: '⏱', cls: 't-failed', label: 'timeout' },
    tool_call:       { icon: '⚙', cls: 't-tool', label: 'tool' },
    notification:    { icon: '◆', cls: 't-notification', label: 'message' },
    dispatched:      { icon: '▶', cls: 't-session', label: 'dispatch' },
    released:        { icon: '■', cls: 't-other', label: 'released' },
    continuation:    { icon: '↻', cls: 't-session', label: 'continue' },
  };
  return map[type] || { icon: '·', cls: 't-other', label: type };
}

function formatEventMessage(type, payload) {
  if (!payload) return '';
  if (type === 'tool_call') {
    const tool = payload.tool || '';
    const inp = payload.input ? JSON.stringify(payload.input).slice(0, 80) : '';
    return tool + (inp ? '(' + inp + ')' : '');
  }
  if (type === 'notification') {
    return payload.message || (payload.raw ? JSON.stringify(payload.raw).slice(0, 150) : '');
  }
  if (type === 'turn_completed') {
    const parts = [];
    if (payload.numTurns) parts.push(payload.numTurns + ' turns');
    if (payload.durationMs) parts.push(formatSecs(payload.durationMs / 1000));
    if (payload.usage) {
      const tok = payload.usage.total_tokens || payload.usage.totalTokens || 0;
      if (tok) parts.push(formatNum(tok) + ' tok');
    }
    return parts.join(' · ') || 'done';
  }
  if (type === 'turn_failed' || type === 'turn_timed_out') {
    return payload.message || '';
  }
  if (type === 'session_started') {
    return payload.model || payload.sessionId || '';
  }
  return payload.message || payload.event || JSON.stringify(payload).slice(0, 120);
}

function formatBadges(type, payload) {
  if (!payload) return '';
  let html = '';
  if (type === 'turn_completed') {
    const tok = payload.usage?.total_tokens || payload.usage?.totalTokens || 0;
    if (tok) html += '<span class="ev-badge tokens">' + formatNum(tok) + '</span>';
    if (payload.durationMs) html += '<span class="ev-badge duration">' + formatSecs(payload.durationMs / 1000) + '</span>';
  }
  if (type === 'tool_call' && payload.tool) {
    html += '<span class="ev-badge tool-name">' + payload.tool + '</span>';
  }
  return html;
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatNum(n) { return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n); }
function formatSecs(s) { const m = Math.floor(s/60); return m > 0 ? m+'m ' + Math.round(s%60)+'s' : Math.round(s)+'s'; }

refreshBtn.addEventListener('click', async () => {
  await fetch('/api/v1/refresh', { method: 'POST' });
});

eventListEl.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) li.classList.toggle('expanded');
});

eventListEl.style.display = 'none';
</script>
</main>
</body>
</html>`;
}

export async function startStatusServer(
  config: ServiceConfig,
  controller: ServerStateController,
  eventBus?: EventBus,
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
      respondHtml(response, 200, renderDashboardHtml(config));
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
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();

      // Replay history for reconnection
      if (lastId > 0) {
        const history = eventBus.history(filterIssueId);
        for (const evt of history) {
          if (evt.id > lastId) {
            response.write(`id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify({ issueId: evt.issueId, event: evt.payload?.['event'], payload: evt.payload, timestamp: evt.timestamp })}\n\n`);
          }
        }
      } else {
        // Send initial state snapshot
        response.write(`event: state_snapshot\ndata: ${controller.getSnapshot()}\n\n`);
      }

      const unsubscribe = eventBus.subscribe((evt) => {
        if (evt.type === 'state_snapshot') {
          if (!filterIssueId) {
            // Only send state_snapshot to global (unfiltered) connections
            response.write(`id: ${evt.id}\nevent: state_snapshot\ndata: ${JSON.stringify(evt.payload)}\n\n`);
          }
          return;
        }
        if (filterIssueId && evt.issueId !== filterIssueId) {
          return;
        }
        response.write(`id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify({ issueId: evt.issueId, event: evt.payload?.['event'], payload: evt.payload, timestamp: evt.timestamp })}\n\n`);
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
