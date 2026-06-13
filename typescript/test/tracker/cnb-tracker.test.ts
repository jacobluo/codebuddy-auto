import http from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CnbTracker } from '../../src/tracker/index.js';

let server: http.Server;
let baseUrl = '';
const requests: Array<{
  method: string | undefined;
  url: string | undefined;
  body: string;
}> = [];

beforeEach(async () => {
  requests.splice(0);
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        body: Buffer.concat(chunks).toString('utf8'),
      });
    });

    if (request.url === '/repo/demo/-/issues?labels=agent-finish&state=open&page_size=100') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify([]));
      return;
    }

    if (request.url === '/repo/demo/-/issues?labels=agent-ready&state=open&page_size=100') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify([
          {
            number: '1',
            title: 'ready',
            state: 'open',
            priority: 'P1',
            labels: [{ name: 'agent-ready' }],
          },
          {
            number: '2',
            title: 'skip',
            state: 'open',
            priority: 'P2',
            labels: [{ name: 'agent-ready' }, { name: 'skip-agent' }],
          },
        ]),
      );
      return;
    }

    if (request.url === '/repo/demo/-/issues?labels=custom-ready&state=open&page_size=100') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify([]));
      return;
    }

    if (request.url === '/repo/demo/-/issues/1') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          number: '1',
          title: 'ready',
          body: 'hydrated body',
          state: 'open',
          priority: 'P1',
          labels: [{ name: 'agent-ready' }],
        }),
      );
      return;
    }

    if (request.url === '/repo/demo/-/issues/2') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          number: '2',
          title: 'skip',
          body: 'skip body',
          state: 'open',
          priority: 'P2',
          labels: [{ name: 'agent-ready' }, { name: 'skip-agent' }],
        }),
      );
      return;
    }

    if (request.url === '/repo/demo/-/issues?state=closed&page_size=100') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify([
          {
            number: '3',
            title: 'done',
            body: 'body',
            state: 'closed',
            labels: [{ name: 'done' }],
          },
        ]),
      );
      return;
    }

    if (request.url === '/repo/demo/-/issues/3') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          number: '3',
          title: 'done',
          body: 'body',
          state: 'closed',
          labels: [{ name: 'done' }],
        }),
      );
      return;
    }

    if (request.url === '/repo/demo/-/issues/1' && request.method === 'PATCH') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.url === '/repo/demo/-/issues/1/labels' && request.method === 'POST') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.url === '/repo/demo/-/issues/500') {
      response.statusCode = 500;
      response.end('server error');
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind test server');
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

describe('CnbTracker', () => {
  it('filters candidate issues by exclude label', async () => {
    const tracker = new CnbTracker({
      apiBaseUrl: baseUrl,
      repo: 'repo/demo',
      token: 'token',
    });

    const issues = await tracker.fetchCandidateIssues();

    expect(issues.map((issue) => issue.id)).toEqual(['1']);
    expect(issues[0]?.description).toBe('hydrated body');
  });

  it('fetches issues by state and state snapshots by id', async () => {
    const tracker = new CnbTracker({
      apiBaseUrl: baseUrl,
      repo: 'repo/demo',
      token: 'token',
    });

    const closedIssues = await tracker.fetchIssuesByStates(['closed']);
    const states = await tracker.fetchIssueStatesByIds(['3']);

    expect(closedIssues.map((issue) => issue.id)).toEqual(['3']);
    expect(states.get('3')).toEqual({
      id: '3',
      state: 'closed',
      labels: ['done'],
    });
  });

  it('supports custom labels and exposes the configured finish label', async () => {
    const tracker = new CnbTracker({
      apiBaseUrl: baseUrl,
      repo: 'repo/demo',
      token: 'token',
      candidateLabel: 'custom-ready',
      finishLabel: 'done-by-agent',
    });

    await expect(tracker.fetchCandidateIssues()).resolves.toEqual([]);

    expect(tracker.getFinishLabel()).toBe('done-by-agent');
    expect(requests.some((request) => request.url === '/repo/demo/-/issues?labels=custom-ready&state=open&page_size=100')).toBe(true);
  });

  it('writes close issue and add label requests to the CNB API', async () => {
    const tracker = new CnbTracker({
      apiBaseUrl: baseUrl,
      repo: 'repo/demo',
      token: 'token',
    });

    await tracker.closeIssue('1', 'completed');
    await tracker.addLabel('1', 'agent-finish');

    expect(requests).toContainEqual({
      method: 'PATCH',
      url: '/repo/demo/-/issues/1',
      body: JSON.stringify({
        state: 'closed',
        state_reason: 'completed',
      }),
    });
    expect(requests).toContainEqual({
      method: 'POST',
      url: '/repo/demo/-/issues/1/labels',
      body: JSON.stringify({
        labels: ['agent-finish'],
      }),
    });
  });

  it('surfaces CNB API status errors', async () => {
    const tracker = new CnbTracker({
      apiBaseUrl: baseUrl,
      repo: 'repo/demo',
      token: 'token',
    });

    await expect(tracker.fetchIssueStatesByIds(['500'])).rejects.toThrow('cnb api status error: 500');
  });
});
