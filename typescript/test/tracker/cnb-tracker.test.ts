import http from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CnbTracker } from '../../src/tracker/index.js';

let server: http.Server;
let baseUrl = '';

beforeEach(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/repo/demo/-/issues?labels=agent-ready&state=open&page_size=100') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify([
          {
            number: '1',
            title: 'ready',
            body: 'body',
            state: 'open',
            priority: 'P1',
            labels: [{ name: 'agent-ready' }],
          },
          {
            number: '2',
            title: 'skip',
            body: 'body',
            state: 'open',
            priority: 'P2',
            labels: [{ name: 'agent-ready' }, { name: 'skip-agent' }],
          },
        ]),
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
});
