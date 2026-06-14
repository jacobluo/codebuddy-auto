import fs from 'node:fs';
import path from 'node:path';

import DatabaseConstructor from 'better-sqlite3';
import { z } from 'zod';

const transcriptProviderSchema = z.enum(['sdk', 'cli']);
const transcriptRoleSchema = z.enum(['system', 'user', 'assistant', 'tool', 'result', 'error', 'runtime']);
const transcriptPayloadSchema = z.record(z.string(), z.unknown());
const dashboardEventTypeSchema = z.enum(['issue_event', 'scheduler_event', 'state_snapshot']);

const transcriptEventRowSchema = z.object({
  id: z.number(),
  session_id: z.number(),
  issue_id: z.string(),
  turn_index: z.number().nullable(),
  sequence: z.number(),
  role: transcriptRoleSchema,
  event_type: z.string(),
  text: z.string().nullable(),
  payload_json: z.string(),
  created_at: z.string(),
});

const transcriptSessionRowSchema = z.object({
  id: z.number(),
  issue_id: z.string(),
  issue_title: z.string(),
  workspace_path: z.string(),
  provider: transcriptProviderSchema,
  sdk_session_id: z.string().nullable(),
  status: z.string(),
  metadata_json: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const dashboardEventLogRowSchema = z.object({
  id: z.number(),
  type: dashboardEventTypeSchema,
  timestamp: z.string(),
  issue_id: z.string().nullable(),
  payload_json: z.string(),
});

const historicalIssueSummaryRowSchema = z.object({
  issue_id: z.string(),
  title: z.string().nullable(),
  last_observed_at: z.string(),
  session_count: z.number(),
  transcript_event_count: z.number(),
  dashboard_event_count: z.number(),
});

export type TranscriptProvider = z.infer<typeof transcriptProviderSchema>;
export type TranscriptRole = z.infer<typeof transcriptRoleSchema>;

export interface TranscriptSessionInput {
  issueId: string;
  issueTitle: string;
  workspacePath: string;
  provider: TranscriptProvider;
  sdkSessionId?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface TranscriptSession {
  id: number;
  issueId: string;
  issueTitle: string;
  workspacePath: string;
  provider: TranscriptProvider;
  sdkSessionId?: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptEventInput {
  sessionId: number;
  issueId: string;
  turnIndex?: number;
  sequence: number;
  role: TranscriptRole;
  eventType: string;
  text?: string;
  payload: Record<string, unknown>;
}

export interface TranscriptEvent {
  id: number;
  sessionId: number;
  issueId: string;
  turnIndex?: number;
  sequence: number;
  role: TranscriptRole;
  eventType: string;
  text?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TranscriptListOptions {
  after?: number;
  limit?: number;
}

export type DashboardEventLogType = z.infer<typeof dashboardEventTypeSchema>;

export interface DashboardEventLogInput {
  id: number;
  type: DashboardEventLogType;
  timestamp: string;
  issueId?: string;
  payload: Record<string, unknown>;
}

export interface DashboardEventLogEntry {
  id: number;
  type: DashboardEventLogType;
  timestamp: string;
  issueId?: string;
  payload: Record<string, unknown>;
}

export interface DashboardEventLogListOptions {
  issueId?: string;
  after?: number;
  limit?: number;
}

export interface HistoricalIssueSummary {
  issueId: string;
  identifier: string;
  title: string;
  lastObservedAt: string;
  sessionCount: number;
  transcriptEventCount: number;
  dashboardEventCount: number;
  source: 'transcript' | 'dashboard_event';
}

export interface HistoricalIssueListOptions {
  after?: number;
  limit?: number;
}

export interface TranscriptStore {
  recordSession(input: TranscriptSessionInput): TranscriptSession;
  recordEvent(input: TranscriptEventInput): TranscriptEvent;
  listEvents(issueId: string, options?: TranscriptListOptions): TranscriptEvent[];
  recordDashboardEvent(input: DashboardEventLogInput): DashboardEventLogEntry;
  listDashboardEvents(options?: DashboardEventLogListOptions): DashboardEventLogEntry[];
  listHistoricalIssues(options?: HistoricalIssueListOptions): HistoricalIssueSummary[];
  hasIssueHistory(issueId: string): boolean;
  getLatestDashboardEventId(): number;
  getNextTurnIndex(issueId: string): number;
  close(): void;
}

export interface SqliteTranscriptStoreOptions {
  sqlitePath: string;
}

export class TranscriptStoreUnavailableError extends Error {
  constructor(message = 'transcript store is disabled') {
    super(message);
    this.name = 'TranscriptStoreUnavailableError';
  }
}

type SqliteDatabase = ReturnType<typeof DatabaseConstructor>;

function toIntegerId(value: number | bigint): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  return transcriptPayloadSchema.parse(JSON.parse(payloadJson));
}

function mapSession(row: unknown): TranscriptSession {
  const parsed = transcriptSessionRowSchema.parse(row);
  return {
    id: parsed.id,
    issueId: parsed.issue_id,
    issueTitle: parsed.issue_title,
    workspacePath: parsed.workspace_path,
    provider: parsed.provider,
    sdkSessionId: parsed.sdk_session_id ?? undefined,
    status: parsed.status,
    metadata: parsePayload(parsed.metadata_json),
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  };
}

function mapEvent(row: unknown): TranscriptEvent {
  const parsed = transcriptEventRowSchema.parse(row);
  return {
    id: parsed.id,
    sessionId: parsed.session_id,
    issueId: parsed.issue_id,
    turnIndex: parsed.turn_index ?? undefined,
    sequence: parsed.sequence,
    role: parsed.role,
    eventType: parsed.event_type,
    text: parsed.text ?? undefined,
    payload: parsePayload(parsed.payload_json),
    createdAt: parsed.created_at,
  };
}

function mapDashboardEvent(row: unknown): DashboardEventLogEntry {
  const parsed = dashboardEventLogRowSchema.parse(row);
  return {
    id: parsed.id,
    type: parsed.type,
    timestamp: parsed.timestamp,
    issueId: parsed.issue_id ?? undefined,
    payload: parsePayload(parsed.payload_json),
  };
}

function createFallbackIdentifier(issueId: string): string {
  return issueId.startsWith('#') ? issueId : `#${issueId}`;
}

function mapHistoricalIssueSummary(row: unknown): HistoricalIssueSummary {
  const parsed = historicalIssueSummaryRowSchema.parse(row);
  const identifier = createFallbackIdentifier(parsed.issue_id);
  const title = parsed.title && parsed.title.trim().length > 0 ? parsed.title : identifier;
  return {
    issueId: parsed.issue_id,
    identifier,
    title,
    lastObservedAt: parsed.last_observed_at,
    sessionCount: parsed.session_count,
    transcriptEventCount: parsed.transcript_event_count,
    dashboardEventCount: parsed.dashboard_event_count,
    source: parsed.session_count > 0 || parsed.transcript_event_count > 0 ? 'transcript' : 'dashboard_event',
  };
}

class SqliteTranscriptStore implements TranscriptStore {
  private readonly database: SqliteDatabase;

  constructor(options: SqliteTranscriptStoreOptions) {
    fs.mkdirSync(path.dirname(options.sqlitePath), { recursive: true });
    this.database = new DatabaseConstructor(options.sqlitePath);
    this.database.pragma('journal_mode = WAL');
    this.initializeSchema();
  }

  recordSession(input: TranscriptSessionInput): TranscriptSession {
    const createdAt = nowIso();
    const info = this.database
      .prepare(
        `INSERT INTO transcript_sessions (
          issue_id,
          issue_title,
          workspace_path,
          provider,
          sdk_session_id,
          status,
          metadata_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.issueId,
        input.issueTitle,
        input.workspacePath,
        input.provider,
        input.sdkSessionId ?? null,
        input.status ?? 'running',
        JSON.stringify(input.metadata ?? {}),
        createdAt,
        createdAt,
      );

    const row = this.database
      .prepare('SELECT * FROM transcript_sessions WHERE id = ?')
      .get(toIntegerId(info.lastInsertRowid));
    return mapSession(row);
  }

  recordEvent(input: TranscriptEventInput): TranscriptEvent {
    const createdAt = nowIso();
    const info = this.database
      .prepare(
        `INSERT INTO transcript_events (
          session_id,
          issue_id,
          turn_index,
          sequence,
          role,
          event_type,
          text,
          payload_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId,
        input.issueId,
        input.turnIndex ?? null,
        input.sequence,
        input.role,
        input.eventType,
        input.text ?? null,
        JSON.stringify(input.payload),
        createdAt,
      );

    const row = this.database
      .prepare('SELECT * FROM transcript_events WHERE id = ?')
      .get(toIntegerId(info.lastInsertRowid));
    return mapEvent(row);
  }

  listEvents(issueId: string, options: TranscriptListOptions = {}): TranscriptEvent[] {
    const after = options.after ?? 0;
    const limit = options.limit ?? 200;
    const rows = this.database
      .prepare(
        `SELECT * FROM transcript_events
         WHERE issue_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(issueId, after, limit);
    return rows.map((row) => mapEvent(row));
  }

  recordDashboardEvent(input: DashboardEventLogInput): DashboardEventLogEntry {
    this.database
      .prepare(
        `INSERT INTO dashboard_events (
          id,
          type,
          timestamp,
          issue_id,
          payload_json
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.type,
        input.timestamp,
        input.issueId ?? null,
        JSON.stringify(input.payload),
      );

    const row = this.database
      .prepare('SELECT * FROM dashboard_events WHERE id = ?')
      .get(input.id);
    return mapDashboardEvent(row);
  }

  listDashboardEvents(options: DashboardEventLogListOptions = {}): DashboardEventLogEntry[] {
    const after = options.after ?? 0;
    const limit = options.limit ?? 200;
    const rows = options.issueId
      ? this.database
        .prepare(
          `SELECT * FROM dashboard_events
           WHERE issue_id = ? AND id > ?
           ORDER BY id ASC
           LIMIT ?`,
        )
        .all(options.issueId, after, limit)
      : this.database
        .prepare(
          `SELECT * FROM dashboard_events
           WHERE id > ?
           ORDER BY id ASC
           LIMIT ?`,
        )
        .all(after, limit);
    return rows.map((row) => mapDashboardEvent(row));
  }

  getLatestDashboardEventId(): number {
    const row = this.database
      .prepare('SELECT COALESCE(MAX(id), 0) AS latest_id FROM dashboard_events')
      .get();
    const parsed = z.object({ latest_id: z.number() }).parse(row);
    return parsed.latest_id;
  }

  getNextTurnIndex(issueId: string): number {
    const row = this.database
      .prepare(
        `SELECT COALESCE(MAX(turn_index), 0) + 1 AS next_turn_index
         FROM transcript_events
         WHERE issue_id = ? AND turn_index IS NOT NULL`,
      )
      .get(issueId);
    const parsed = z.object({ next_turn_index: z.number() }).parse(row);
    return parsed.next_turn_index;
  }

  listHistoricalIssues(options: HistoricalIssueListOptions = {}): HistoricalIssueSummary[] {
    const after = options.after ?? 0;
    const limit = options.limit ?? 50;
    const rows = this.database
      .prepare(
        `WITH issue_ids AS (
           SELECT issue_id FROM transcript_sessions
           UNION
           SELECT issue_id FROM transcript_events
           UNION
           SELECT issue_id FROM dashboard_events WHERE issue_id IS NOT NULL
         ),
         session_counts AS (
           SELECT
             issue_id,
             COUNT(*) AS session_count,
             MAX(issue_title) AS title,
             MAX(updated_at) AS latest_session_at
           FROM transcript_sessions
           GROUP BY issue_id
         ),
         transcript_counts AS (
           SELECT
             issue_id,
             COUNT(*) AS transcript_event_count,
             MAX(created_at) AS latest_transcript_at
           FROM transcript_events
           GROUP BY issue_id
         ),
         dashboard_counts AS (
           SELECT
             issue_id,
             COUNT(*) AS dashboard_event_count,
             MAX(timestamp) AS latest_dashboard_at
           FROM dashboard_events
           WHERE issue_id IS NOT NULL
           GROUP BY issue_id
         ),
         summaries AS (
           SELECT
             issue_ids.issue_id,
             session_counts.title,
             MAX(
               COALESCE(session_counts.latest_session_at, ''),
               COALESCE(transcript_counts.latest_transcript_at, ''),
               COALESCE(dashboard_counts.latest_dashboard_at, '')
             ) AS last_observed_at,
             COALESCE(session_counts.session_count, 0) AS session_count,
             COALESCE(transcript_counts.transcript_event_count, 0) AS transcript_event_count,
             COALESCE(dashboard_counts.dashboard_event_count, 0) AS dashboard_event_count
           FROM issue_ids
           LEFT JOIN session_counts ON session_counts.issue_id = issue_ids.issue_id
           LEFT JOIN transcript_counts ON transcript_counts.issue_id = issue_ids.issue_id
           LEFT JOIN dashboard_counts ON dashboard_counts.issue_id = issue_ids.issue_id
         )
         SELECT * FROM summaries
         ORDER BY last_observed_at DESC, issue_id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, after);
    return rows.map((row) => mapHistoricalIssueSummary(row));
  }

  hasIssueHistory(issueId: string): boolean {
    const row = this.database
      .prepare(
        `SELECT 1 AS found
         WHERE EXISTS (SELECT 1 FROM transcript_sessions WHERE issue_id = ?)
            OR EXISTS (SELECT 1 FROM transcript_events WHERE issue_id = ?)
            OR EXISTS (SELECT 1 FROM dashboard_events WHERE issue_id = ?)
         LIMIT 1`,
      )
      .get(issueId, issueId, issueId);
    return row !== undefined;
  }

  close(): void {
    this.database.close();
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS transcript_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id TEXT NOT NULL,
        issue_title TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('sdk', 'cli')),
        sdk_session_id TEXT,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transcript_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        issue_id TEXT NOT NULL,
        turn_index INTEGER,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool', 'result', 'error', 'runtime')),
        event_type TEXT NOT NULL,
        text TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES transcript_sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_transcript_events_issue_id_id
        ON transcript_events(issue_id, id);

      CREATE INDEX IF NOT EXISTS idx_transcript_sessions_issue_id
        ON transcript_sessions(issue_id);

      CREATE TABLE IF NOT EXISTS dashboard_events (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('issue_event', 'scheduler_event', 'state_snapshot')),
        timestamp TEXT NOT NULL,
        issue_id TEXT,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_dashboard_events_issue_id_id
        ON dashboard_events(issue_id, id);

      CREATE INDEX IF NOT EXISTS idx_dashboard_events_id
        ON dashboard_events(id);
    `);
  }
}

class DisabledTranscriptStore implements TranscriptStore {
  recordSession(): TranscriptSession {
    throw new TranscriptStoreUnavailableError();
  }

  recordEvent(): TranscriptEvent {
    throw new TranscriptStoreUnavailableError();
  }

  listEvents(): TranscriptEvent[] {
    throw new TranscriptStoreUnavailableError();
  }

  recordDashboardEvent(): DashboardEventLogEntry {
    throw new TranscriptStoreUnavailableError();
  }

  listDashboardEvents(): DashboardEventLogEntry[] {
    throw new TranscriptStoreUnavailableError();
  }

  listHistoricalIssues(): HistoricalIssueSummary[] {
    throw new TranscriptStoreUnavailableError();
  }

  hasIssueHistory(): boolean {
    throw new TranscriptStoreUnavailableError();
  }

  getLatestDashboardEventId(): number {
    throw new TranscriptStoreUnavailableError();
  }

  getNextTurnIndex(): number {
    throw new TranscriptStoreUnavailableError();
  }

  close(): void {
    return;
  }
}

export function openSqliteTranscriptStore(options: SqliteTranscriptStoreOptions): TranscriptStore {
  return new SqliteTranscriptStore(options);
}

export function createDisabledTranscriptStore(): TranscriptStore {
  return new DisabledTranscriptStore();
}
