import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeLogger } from '../../src/logging/index.js';
import { createRuntimeState, createLocalTracker, runDispatchCycle } from '../../src/scheduler/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

const tempDirs: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-19T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTrackerRoot(): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-scheduler-'));
  const trackerRoot = path.join(workspaceRoot, '.tracker');
  fs.mkdirSync(trackerRoot, { recursive: true });
  tempDirs.push(workspaceRoot);
  return workspaceRoot;
}

describe('runDispatchCycle', () => {
  it('returns dispatchable issues from the local tracker', async () => {
    const workspaceRoot = createTrackerRoot();
    const mockCliPath = path.join(workspaceRoot, 'noop-cli.mjs');
    fs.writeFileSync(
      mockCliPath,
      [
        "console.log(JSON.stringify({type:'system',subtype:'init',session_id:'session-1'}));",
        "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:1,num_turns:1,usage:{input_tokens:1,output_tokens:1}}));",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, '.tracker', 'issue-1.json'),
      JSON.stringify({
        id: '1',
        identifier: '#1',
        title: 'Open issue',
        description: null,
        priority: null,
        state: 'open',
        branchName: null,
        url: null,
        labels: [],
        blockedBy: [],
        createdAt: null,
        updatedAt: null,
      }),
    );

    const config = {
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        root: workspaceRoot,
      },
      codebuddy: {
        ...DEFAULT_SERVICE_CONFIG.codebuddy,
        command: `node "${mockCliPath}"`,
      },
    };
    const state = createRuntimeState();
    const tracker = createLocalTracker(config);

    const result = await runDispatchCycle(state, tracker, config);

    expect(result).toEqual({
      availableSlots: 10,
      dispatchableIssueIds: ['1'],
      claimedIssueIds: ['1'],
    });
    expect(state.running['1']).toMatchObject({
      workspacePath: path.join(workspaceRoot, '_1'),
      sessionId: 'session-1',
      turnCount: 1,
      lastEvent: 'turn_completed',
    });
    expect(state.completed.has('1')).toBe(false);
    expect(state.retryAttempts['1']).toEqual({
      issueId: '1',
      identifier: '#1',
      mode: 'continuation',
      attempt: 1,
      dueAtMs: 1_000 + Date.parse('2026-05-19T00:00:00Z'),
      error: 'turn_completed',
    });
  });

  it('runs a single mock CodeBuddy turn and records the rendered prompt', async () => {
    const workspaceRoot = createTrackerRoot();
    const promptPath = path.join(workspaceRoot, 'captured-prompt.txt');
    const mockCliPath = path.join(workspaceRoot, 'mock-cli.mjs');
    fs.writeFileSync(
      mockCliPath,
      [
        "import fs from 'node:fs';",
        'const capturePath = process.argv[2];',
        'const prompt = process.argv[process.argv.length - 1];',
        "fs.writeFileSync(capturePath, prompt, 'utf8');",
        "console.log(JSON.stringify({type:'system',subtype:'init',session_id:'session-1'}));",
        "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:5,num_turns:1,usage:{input_tokens:3,output_tokens:2}}));",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, '.tracker', 'issue-2.json'),
      JSON.stringify({
        id: '2',
        identifier: '#2',
        title: 'Second issue',
        description: 'Details',
        priority: null,
        state: 'open',
        branchName: null,
        url: null,
        labels: [],
        blockedBy: [],
        createdAt: null,
        updatedAt: null,
      }),
    );

    const config = {
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        root: workspaceRoot,
      },
      codebuddy: {
        ...DEFAULT_SERVICE_CONFIG.codebuddy,
        command: `node "${mockCliPath}" "${promptPath}"`,
      },
    };
    const state = createRuntimeState();
    const tracker = createLocalTracker(config);

    const result = await runDispatchCycle(
      state,
      tracker,
      config,
      'Implement {{ issue.identifier }}: {{ issue.title }}',
    );

    expect(result.dispatchableIssueIds).toEqual(['2']);
    expect(state.running['2']).toMatchObject({
      workspacePath: path.join(workspaceRoot, '_2'),
      sessionId: 'session-1',
      turnCount: 1,
      lastEvent: 'turn_completed',
    });
    expect(state.completed.has('2')).toBe(false);
    expect(state.retryAttempts['2']).toEqual({
      issueId: '2',
      identifier: '#2',
      mode: 'continuation',
      attempt: 1,
      dueAtMs: 1_000 + Date.parse('2026-05-19T00:00:00Z'),
      error: 'turn_completed',
    });
    expect(fs.readFileSync(promptPath, 'utf8')).toBe('Implement #2: Second issue');
  });

  it('does not keep the issue in running state when the first turn fails', async () => {
    const workspaceRoot = createTrackerRoot();
    const mockCliPath = path.join(workspaceRoot, 'failing-cli.mjs');
    fs.writeFileSync(
      mockCliPath,
      [
        "process.stderr.write('failed\\n');",
        'process.exit(9);',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, '.tracker', 'issue-3.json'),
      JSON.stringify({
        id: '3',
        identifier: '#3',
        title: 'Broken issue',
        description: null,
        priority: null,
        state: 'open',
        branchName: null,
        url: null,
        labels: [],
        blockedBy: [],
        createdAt: null,
        updatedAt: null,
      }),
    );

    const config = {
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        root: workspaceRoot,
      },
      codebuddy: {
        ...DEFAULT_SERVICE_CONFIG.codebuddy,
        command: `node "${mockCliPath}"`,
      },
    };
    const state = createRuntimeState();
    const tracker = createLocalTracker(config);

    const result = await runDispatchCycle(state, tracker, config);

    expect(result.dispatchableIssueIds).toEqual(['3']);
    expect(result.claimedIssueIds).toEqual(['3']);
    expect(state.running['3']).toBeUndefined();
    expect(state.claimed.has('3')).toBe(true);
    expect(state.retryAttempts['3']).toEqual({
      issueId: '3',
      identifier: '#3',
      mode: 'failure',
      attempt: 1,
      dueAtMs: 10_000 + Date.parse('2026-05-19T00:00:00Z'),
      error: 'turn_failed',
    });
  });

  it('emits issue-scoped logs for successful and failed dispatch attempts', async () => {
    const workspaceRoot = createTrackerRoot();
    const okCliPath = path.join(workspaceRoot, 'ok-cli.mjs');
    const failCliPath = path.join(workspaceRoot, 'fail-cli.mjs');
    fs.writeFileSync(
      okCliPath,
      [
        "console.log(JSON.stringify({type:'system',subtype:'init',session_id:'session-ok'}));",
        "console.log(JSON.stringify({type:'assistant',message:{usage:{input_tokens:2,output_tokens:1},providerData:{rawUsage:{credit:3.5}}}}));",
        "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:12,num_turns:1,usage:{input_tokens:2,output_tokens:1}}));",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      failCliPath,
      [
        "process.stderr.write('failed\\n');",
        'process.exit(9);',
      ].join('\n'),
      'utf8',
    );

    fs.writeFileSync(
      path.join(workspaceRoot, '.tracker', 'issue-ok.json'),
      JSON.stringify({
        id: 'ok',
        identifier: '#ok',
        title: 'Ok issue',
        description: null,
        priority: 1,
        state: 'open',
        branchName: null,
        url: null,
        labels: [],
        blockedBy: [],
        createdAt: '2026-05-19T00:00:00Z',
        updatedAt: null,
      }),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, '.tracker', 'issue-fail.json'),
      JSON.stringify({
        id: 'fail',
        identifier: '#fail',
        title: 'Fail issue',
        description: null,
        priority: 2,
        state: 'open',
        branchName: null,
        url: null,
        labels: [],
        blockedBy: [],
        createdAt: '2026-05-19T00:00:01Z',
        updatedAt: null,
      }),
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      child: vi.fn(function child(bindings) {
        return {
          info: logger.info,
          error: logger.error,
          child: logger.child,
          bindings,
        };
      }),
    } as unknown as RuntimeLogger;

    const config = {
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        root: workspaceRoot,
      },
      codebuddy: {
        ...DEFAULT_SERVICE_CONFIG.codebuddy,
        command: `node "${okCliPath}"`,
      },
    };

    const tracker = createLocalTracker(config);
    const state = createRuntimeState();
    await runDispatchCycle(state, tracker, config, undefined, logger);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: path.join(workspaceRoot, '_ok'),
        secondsRunning: 0.012,
        totalTokens: 3,
        retryMode: 'continuation',
      }),
      'issue_dispatch_succeeded',
    );

    config.codebuddy.command = `node "${failCliPath}"`;
    const failState = createRuntimeState();
    await runDispatchCycle(failState, tracker, config, undefined, logger);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: path.join(workspaceRoot, '_ok'),
        lastEvent: 'turn_failed',
        retryMode: 'failure',
      }),
      'issue_dispatch_retry_scheduled',
    );
  });

  it('does not keep the issue in running state when the turn times out', async () => {
    vi.useRealTimers();
    const workspaceRoot = createTrackerRoot();
    const mockCliPath = path.join(workspaceRoot, 'slow-cli.mjs');
    fs.writeFileSync(
      mockCliPath,
      [
        "setTimeout(() => console.log(JSON.stringify({type:'result',subtype:'success',is_error:false})), 1000);",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, '.tracker', 'issue-4.json'),
      JSON.stringify({
        id: '4',
        identifier: '#4',
        title: 'Slow issue',
        description: null,
        priority: null,
        state: 'open',
        branchName: null,
        url: null,
        labels: [],
        blockedBy: [],
        createdAt: null,
        updatedAt: null,
      }),
    );

    const config = {
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        root: workspaceRoot,
      },
      codebuddy: {
        ...DEFAULT_SERVICE_CONFIG.codebuddy,
        command: `node "${mockCliPath}"`,
        turnTimeoutMs: 50,
      },
    };
    const state = createRuntimeState();
    const tracker = createLocalTracker(config);
    const startedAtMs = Date.now();

    const result = await runDispatchCycle(state, tracker, config);

    expect(result.dispatchableIssueIds).toEqual(['4']);
    expect(result.claimedIssueIds).toEqual(['4']);
    expect(state.running['4']).toBeUndefined();
    expect(state.claimed.has('4')).toBe(true);
    expect(state.retryAttempts['4']).toMatchObject({
      issueId: '4',
      identifier: '#4',
      mode: 'failure',
      attempt: 1,
      error: 'turn_timed_out',
    });
    expect(state.retryAttempts['4']?.dueAtMs).toBeGreaterThanOrEqual(startedAtMs + 10_000);
    expect(state.retryAttempts['4']?.dueAtMs).toBeLessThan(startedAtMs + 11_000);
  });

  it('queues a retry when the beforeRun hook fails', async () => {
    const workspaceRoot = createTrackerRoot();
    const mockCliPath = path.join(workspaceRoot, 'noop-cli.mjs');
    fs.writeFileSync(
      mockCliPath,
      [
        "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false}));",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, '.tracker', 'issue-hook.json'),
      JSON.stringify({
        id: 'hook',
        identifier: '#hook',
        title: 'Hook issue',
        description: null,
        priority: null,
        state: 'open',
        branchName: null,
        url: null,
        labels: [],
        blockedBy: [],
        createdAt: null,
        updatedAt: null,
      }),
    );

    const config = {
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        root: workspaceRoot,
      },
      hooks: {
        ...DEFAULT_SERVICE_CONFIG.hooks,
        beforeRun: 'exit 9',
      },
      codebuddy: {
        ...DEFAULT_SERVICE_CONFIG.codebuddy,
        command: `node "${mockCliPath}"`,
      },
    };
    const state = createRuntimeState();
    const tracker = createLocalTracker(config);

    const result = await runDispatchCycle(state, tracker, config);

    expect(result.dispatchableIssueIds).toEqual(['hook']);
    expect(state.running.hook).toBeUndefined();
    expect(state.retryAttempts.hook).toMatchObject({
      issueId: 'hook',
      identifier: '#hook',
      mode: 'failure',
      error: 'before_run_failed',
    });
  });

  it('increases retry backoff for repeated failures of the same issue', async () => {
    const workspaceRoot = createTrackerRoot();
    const mockCliPath = path.join(workspaceRoot, 'failing-cli-repeat.mjs');
    fs.writeFileSync(
      mockCliPath,
      [
        "process.stderr.write('failed\\n');",
        'process.exit(9);',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, '.tracker', 'issue-5.json'),
      JSON.stringify({
        id: '5',
        identifier: '#5',
        title: 'Retry issue',
        description: null,
        priority: null,
        state: 'open',
        branchName: null,
        url: null,
        labels: [],
        blockedBy: [],
        createdAt: null,
        updatedAt: null,
      }),
    );

    const config = {
      ...DEFAULT_SERVICE_CONFIG,
      tracker: {
        ...DEFAULT_SERVICE_CONFIG.tracker,
        apiKey: 'token',
      },
      workspace: {
        root: workspaceRoot,
      },
      codebuddy: {
        ...DEFAULT_SERVICE_CONFIG.codebuddy,
        command: `node "${mockCliPath}"`,
      },
    };
    const state = createRuntimeState();
    const tracker = createLocalTracker(config);

    await runDispatchCycle(state, tracker, config);
    state.claimed.delete('5');
    vi.setSystemTime(new Date('2026-05-19T00:01:00Z'));
    await runDispatchCycle(state, tracker, config);

    expect(state.retryAttempts['5']).toEqual({
      issueId: '5',
      identifier: '#5',
      mode: 'failure',
      attempt: 2,
      dueAtMs: Date.parse('2026-05-19T00:01:00Z') + 20_000,
      error: 'turn_failed',
    });
  });
});
