/**
 * SDK Session Store — manages per-issue SDK session metadata.
 *
 * Each dispatched issue gets a session entry. The entry is created on first
 * dispatch, refreshed on each continuation turn, and destroyed when the issue
 * is released by the scheduler (reconcile / terminal state / maxTurns).
 *
 * Currently the underlying SDK call is still `query() + resume: sessionId`,
 * so the store primarily tracks the resume token. The abstraction is shaped
 * so we can later swap in `unstable_v2_createSession()` (which keeps a CLI
 * subprocess + in-memory message buffer alive per issue) without touching
 * scheduler call sites.
 *
 * See design doc D1 (`openspec/changes/migrate-runner-to-sdk/design.md`).
 */

export interface SdkSessionEntry {
  /** Issue this session belongs to. */
  issueId: string;
  /** The SDK session token (also used as `resume` argument). */
  sessionId: string;
  /** First turn started at (epoch ms). */
  createdAtMs: number;
  /** Most recent turn finished at (epoch ms). */
  lastTurnAtMs: number;
  /** Number of turns this session has run. */
  turnCount: number;
}

export interface SdkSessionStore {
  /** Create a new entry for an issue. Throws if one already exists. */
  create(issueId: string, sessionId: string, nowMs?: number): SdkSessionEntry;
  /** Look up an entry. Returns `undefined` if the issue has no live session. */
  get(issueId: string): SdkSessionEntry | undefined;
  /** Update the session id (after the SDK reports it via `session_started`) and bump turn metadata. */
  recordTurn(issueId: string, sessionId: string, nowMs?: number): SdkSessionEntry;
  /**
   * Destroy the entry. Returns `true` when an entry was removed, `false` if
   * the issue had no live session (idempotent — safe to call on already-released issues).
   */
  destroy(issueId: string): boolean;
  /** All currently live entries. Useful for diagnostics / shutdown sweeps. */
  list(): SdkSessionEntry[];
  /** Number of live entries. */
  size(): number;
  /** Drop all entries. Used on full scheduler shutdown. */
  clear(): void;
}

class InMemorySdkSessionStore implements SdkSessionStore {
  private readonly entries = new Map<string, SdkSessionEntry>();

  create(issueId: string, sessionId: string, nowMs: number = Date.now()): SdkSessionEntry {
    if (this.entries.has(issueId)) {
      throw new Error(`SDK session already exists for issue ${issueId}; call destroy() first or use recordTurn() to refresh.`);
    }
    const entry: SdkSessionEntry = {
      issueId,
      sessionId,
      createdAtMs: nowMs,
      lastTurnAtMs: nowMs,
      turnCount: 1,
    };
    this.entries.set(issueId, entry);
    return entry;
  }

  get(issueId: string): SdkSessionEntry | undefined {
    return this.entries.get(issueId);
  }

  recordTurn(issueId: string, sessionId: string, nowMs: number = Date.now()): SdkSessionEntry {
    const existing = this.entries.get(issueId);
    if (!existing) {
      // Defensive: if the store was wiped (e.g. process restart) but a running
      // entry survives, materialize a fresh record on the fly.
      const created: SdkSessionEntry = {
        issueId,
        sessionId,
        createdAtMs: nowMs,
        lastTurnAtMs: nowMs,
        turnCount: 1,
      };
      this.entries.set(issueId, created);
      return created;
    }
    existing.sessionId = sessionId;
    existing.lastTurnAtMs = nowMs;
    existing.turnCount += 1;
    return existing;
  }

  destroy(issueId: string): boolean {
    return this.entries.delete(issueId);
  }

  list(): SdkSessionEntry[] {
    return Array.from(this.entries.values());
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export function createSdkSessionStore(): SdkSessionStore {
  return new InMemorySdkSessionStore();
}
