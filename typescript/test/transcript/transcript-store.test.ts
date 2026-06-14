import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  TranscriptStoreUnavailableError,
  createDisabledTranscriptStore,
  openSqliteTranscriptStore,
} from '../../src/transcript/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auto-transcript-'));
  tempDirs.push(dir);
  return dir;
}

describe('SQLite transcript store', () => {
  it('creates schema and records sessions and turn-ordered events', () => {
    const sqlitePath = path.join(createTempDir(), 'nested', 'transcripts.sqlite');
    const store = openSqliteTranscriptStore({ sqlitePath });

    const session = store.recordSession({
      issueId: '4',
      issueTitle: '检查测试覆盖率',
      workspacePath: '/workspace/_4',
      provider: 'sdk',
      sdkSessionId: 'sdk-session-1',
    });
    store.recordEvent({
      sessionId: session.id,
      issueId: '4',
      turnIndex: 1,
      sequence: 1,
      role: 'user',
      eventType: 'prompt',
      text: '请检查测试覆盖率',
      payload: { prompt: '请检查测试覆盖率' },
    });
    store.recordEvent({
      sessionId: session.id,
      issueId: '4',
      turnIndex: 1,
      sequence: 2,
      role: 'assistant',
      eventType: 'message',
      text: '正在检查',
      payload: { type: 'assistant', text: '正在检查' },
    });

    const events = store.listEvents('4');
    expect(fs.existsSync(sqlitePath)).toBe(true);
    expect(events).toMatchObject([
      {
        issueId: '4',
        turnIndex: 1,
        sequence: 1,
        role: 'user',
        eventType: 'prompt',
        text: '请检查测试覆盖率',
        payload: { prompt: '请检查测试覆盖率' },
      },
      {
        issueId: '4',
        turnIndex: 1,
        sequence: 2,
        role: 'assistant',
        eventType: 'message',
        text: '正在检查',
        payload: { type: 'assistant', text: '正在检查' },
      },
    ]);

    store.close();
  });

  it('paginates events by id cursor and limit', () => {
    const store = openSqliteTranscriptStore({ sqlitePath: path.join(createTempDir(), 'transcripts.sqlite') });
    const session = store.recordSession({
      issueId: '4',
      issueTitle: 'issue',
      workspacePath: '/workspace/_4',
      provider: 'cli',
    });

    const first = store.recordEvent({
      sessionId: session.id,
      issueId: '4',
      turnIndex: 1,
      sequence: 1,
      role: 'user',
      eventType: 'prompt',
      payload: { text: 'first' },
    });
    store.recordEvent({
      sessionId: session.id,
      issueId: '4',
      turnIndex: 1,
      sequence: 2,
      role: 'assistant',
      eventType: 'message',
      payload: { text: 'second' },
    });
    store.recordEvent({
      sessionId: session.id,
      issueId: '4',
      turnIndex: 2,
      sequence: 1,
      role: 'user',
      eventType: 'prompt',
      payload: { text: 'third' },
    });

    const page = store.listEvents('4', { after: first.id, limit: 1 });
    expect(page).toHaveLength(1);
    expect(page[0]?.payload).toEqual({ text: 'second' });

    store.close();
  });

  it('records dashboard events and returns filtered history in id order', () => {
    const sqlitePath = path.join(createTempDir(), 'transcripts.sqlite');
    const store = openSqliteTranscriptStore({ sqlitePath });

    store.recordDashboardEvent({
      id: 10,
      type: 'scheduler_event',
      timestamp: '2026-06-13T10:00:00.000Z',
      payload: { event: 'tick' },
    });
    store.recordDashboardEvent({
      id: 11,
      type: 'issue_event',
      issueId: '4',
      timestamp: '2026-06-13T10:00:01.000Z',
      payload: { event: 'tool_call', tool: 'read_file' },
    });
    store.recordDashboardEvent({
      id: 12,
      type: 'issue_event',
      issueId: '4',
      timestamp: '2026-06-13T10:00:02.000Z',
      payload: { event: 'tool_result', ok: true },
    });

    expect(store.getLatestDashboardEventId()).toBe(12);
    expect(store.listDashboardEvents({ issueId: '4', after: 10, limit: 1 })).toEqual([
      {
        id: 11,
        type: 'issue_event',
        issueId: '4',
        timestamp: '2026-06-13T10:00:01.000Z',
        payload: { event: 'tool_call', tool: 'read_file' },
      },
    ]);

    store.close();
  });

  it('does not expose transcript data when disabled', () => {
    const store = createDisabledTranscriptStore();

    expect(() =>
      store.recordSession({
        issueId: '4',
        issueTitle: 'issue',
        workspacePath: '/workspace/_4',
        provider: 'sdk',
      }),
    ).toThrow(TranscriptStoreUnavailableError);
    expect(() => store.listEvents('4')).toThrow(TranscriptStoreUnavailableError);
    expect(() => store.listDashboardEvents()).toThrow(TranscriptStoreUnavailableError);
  });

  it('fails initialization when the SQLite path cannot be opened as a database file', () => {
    const sqlitePath = createTempDir();

    expect(() => openSqliteTranscriptStore({ sqlitePath })).toThrow();
  });
});
