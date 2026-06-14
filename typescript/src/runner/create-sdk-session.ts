/**
 * createSdkSession — production factory for a CodeBuddy Agent SDK session.
 *
 * Bridges the SDK's `unstable_v2_createSession` to the simpler factory
 * signature (`(opts: CreateSessionOptions) => Session`) that the worker
 * and dispatcher accept. The factory takes the per-issue `cwd`, the
 * shared `AbortController`, and a `ServiceConfig` it reads SDK options
 * from (permissionMode, model, settingSources, allowed/disallowed tools,
 * MCP, etc.).
 *
 * The function does NOT call `connect()` — the worker does that so it
 * can attribute connect failures to `startup_failed`.
 *
 * Tests inject FakeSdk-backed factories instead of importing this.
 */

import {
  unstable_v2_createSession,
  type Session,
  type SessionOptions,
} from '@tencent-ai/agent-sdk';

import type { ServiceConfig } from '../spec/index.js';
import type { CreateSessionOptions } from '../worker/run-issue-worker.js';

export function createSdkSession(opts: CreateSessionOptions): Session {
  const { cwd, config } = opts;

  const options: SessionOptions = {
    cwd,
    permissionMode: (config.codebuddy.permissionMode as SessionOptions['permissionMode']) ?? 'bypassPermissions',
  };

  if (config.codebuddy.sdkMaxTurns !== undefined) {
    options.maxTurns = config.codebuddy.sdkMaxTurns;
  }

  if (config.codebuddy.model && config.codebuddy.model.length > 0) {
    options.model = config.codebuddy.model;
  }
  if (config.codebuddy.settingSources && config.codebuddy.settingSources.length > 0) {
    options.settingSources = config.codebuddy.settingSources as SessionOptions['settingSources'];
  }
  if (config.codebuddy.allowedTools && config.codebuddy.allowedTools.length > 0) {
    options.allowedTools = config.codebuddy.allowedTools;
  }
  if (config.codebuddy.disallowedTools && config.codebuddy.disallowedTools.length > 0) {
    options.disallowedTools = config.codebuddy.disallowedTools;
  }

  // The worker still owns its own AbortController for per-turn wall-clock
  // timeout. Calling `session.interrupt()` (or `abortController.abort()`)
  // from outside the SDK is the documented stop mechanism — see
  // node_modules/@tencent-ai/agent-sdk/lib/session.d.ts:Session.interrupt.

  return unstable_v2_createSession(options);
}
