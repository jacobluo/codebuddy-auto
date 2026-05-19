import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRuntimeState, createLocalTracker, runDispatchCycle } from '../../src/scheduler/index.js';
import { DEFAULT_SERVICE_CONFIG } from '../../src/spec/index.js';

const tempDirs: string[] = [];

afterEach(() => {
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
      sessionId: '1-turn-1',
      turnCount: 1,
      lastEvent: 'turn_completed',
    });
    expect(state.completed.has('1')).toBe(true);
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
      sessionId: '2-turn-1',
      turnCount: 1,
      lastEvent: 'turn_completed',
    });
    expect(state.completed.has('2')).toBe(true);
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
    expect(result.claimedIssueIds).toEqual([]);
    expect(state.running['3']).toBeUndefined();
    expect(state.claimed.has('3')).toBe(false);
    expect(state.retryAttempts['3']).toEqual({
      issueId: '3',
      identifier: '#3',
      attempt: 1,
      dueAtMs: 10_000,
      error: 'turn_failed',
    });
  });

  it('does not keep the issue in running state when the turn times out', async () => {
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

    const result = await runDispatchCycle(state, tracker, config);

    expect(result.dispatchableIssueIds).toEqual(['4']);
    expect(result.claimedIssueIds).toEqual([]);
    expect(state.running['4']).toBeUndefined();
    expect(state.retryAttempts['4']).toEqual({
      issueId: '4',
      identifier: '#4',
      attempt: 1,
      dueAtMs: 10_000,
      error: 'turn_timed_out',
    });
  });
});
