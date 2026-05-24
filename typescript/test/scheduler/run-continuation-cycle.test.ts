import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeLogger } from '../../src/logging/index.js';
import { createRuntimeState, runContinuationCycle } from '../../src/scheduler/index.js';
import { DEFAULT_SERVICE_CONFIG, type ServiceConfig } from '../../src/spec/index.js';

const tempDirs: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-24T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspaceRoot(): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-continuation-'));
  tempDirs.push(workspaceRoot);
  return workspaceRoot;
}

function createConfig(workspaceRoot: string, command: string, overrides: Partial<ServiceConfig['codebuddy']> = {}): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    tracker: {
      ...DEFAULT_SERVICE_CONFIG.tracker,
      kind: 'local',
      apiKey: 'token',
    },
    workspace: {
      root: workspaceRoot,
    },
    codebuddy: {
      ...DEFAULT_SERVICE_CONFIG.codebuddy,
      command,
      ...overrides,
    },
  };
}

function seedRunningState(workspaceRoot: string) {
  const state = createRuntimeState();
  state.running['1'] = {
    issue: {
      id: '1',
      identifier: '#1',
      title: 'Continuation issue',
      description: null,
      priority: null,
      state: 'open',
      branchName: null,
      url: null,
      labels: [],
      blockedBy: [],
      createdAt: null,
      updatedAt: null,
    },
    workspacePath: path.join(workspaceRoot, '_1'),
    sessionId: 'session-1',
    startedAt: '2026-05-24T00:00:00Z',
    turnCount: 1,
    lastEvent: 'turn_completed',
    lastEventAt: '2026-05-24T00:00:01Z',
    secondsRunning: 1,
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      creditCost: 0,
    },
    lastReportedTotals: {
      inputTokens: 10,
      outputTokens: 2,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  };
  state.claimed.add('1');
  state.retryAttempts['1'] = {
    issueId: '1',
    identifier: '#1',
    mode: 'continuation',
    attempt: 1,
    dueAtMs: Date.now() - 1,
    error: 'turn_completed',
  };
  fs.mkdirSync(path.join(workspaceRoot, '_1'), { recursive: true });
  return state;
}

describe('runContinuationCycle', () => {
  it('resumes the existing session, updates runtime state, and schedules the next continuation retry', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const capturePath = path.join(workspaceRoot, 'resume-args.json');
    const mockCliPath = path.join(workspaceRoot, 'continuation-cli.mjs');
    fs.writeFileSync(
      mockCliPath,
      [
        "import fs from 'node:fs';",
        'const capturePath = process.argv[2];',
        "fs.writeFileSync(capturePath, JSON.stringify(process.argv.slice(3)), 'utf8');",
        "console.log(JSON.stringify({type:'assistant',message:{content:[{type:'output_text',text:'still working'}],usage:{input_tokens:14,output_tokens:5},providerData:{rawUsage:{credit:8}}}}));",
        "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:4000,num_turns:2,usage:{input_tokens:14,output_tokens:5}}));",
      ].join('\n'),
      'utf8',
    );

    const config = createConfig(workspaceRoot, `node \"${mockCliPath}\" \"${capturePath}\"`);
    const state = seedRunningState(workspaceRoot);

    const result = await runContinuationCycle(state, config);

    expect(result.continuedIssueIds).toEqual(['1']);
    expect(state.running['1']).toMatchObject({
      sessionId: 'session-1',
      turnCount: 2,
      lastEvent: 'turn_completed',
      secondsRunning: 5,
      tokenUsage: {
        inputTokens: 14,
        outputTokens: 5,
        totalTokens: 19,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        creditCost: 8,
      },
      lastReportedTotals: {
        inputTokens: 14,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    });
    expect(state.retryAttempts['1']).toEqual({
      issueId: '1',
      identifier: '#1',
      mode: 'continuation',
      attempt: 2,
      dueAtMs: Date.parse('2026-05-24T00:00:00Z') + 1000,
      error: 'turn_completed',
    });

    const args = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
    expect(args).toContain('--resume');
    expect(args).toContain('session-1');
    expect(args.at(-1)).toContain('This is continuation turn 2.');
  });

  it('schedules a failure retry and logs the retry metadata when continuation needs approval', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const mockCliPath = path.join(workspaceRoot, 'continuation-approval-cli.mjs');
    fs.writeFileSync(
      mockCliPath,
      [
        "console.log(JSON.stringify({type:'result',subtype:'approval_required',result:'approval required',session_id:'session-1',is_error:true,permission_denials:[{kind:'exec'}]}));",
      ].join('\n'),
      'utf8',
    );

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      child: vi.fn(function child() {
        return {
          info: logger.info,
          error: logger.error,
          child: logger.child,
        };
      }),
    } as unknown as RuntimeLogger;
    const config = createConfig(workspaceRoot, `node \"${mockCliPath}\"`);
    const state = seedRunningState(workspaceRoot);

    const result = await runContinuationCycle(state, config, logger);

    expect(result.continuedIssueIds).toEqual(['1']);
    expect(state.running['1']).toMatchObject({
      turnCount: 2,
      lastEvent: 'turn_input_required',
    });
    expect(state.retryAttempts['1']).toEqual({
      issueId: '1',
      identifier: '#1',
      mode: 'failure',
      attempt: 1,
      dueAtMs: Date.parse('2026-05-24T00:00:00Z') + 10000,
      error: 'turn_input_required',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        lastEvent: 'turn_input_required',
        retryMode: 'failure',
        retryAttempt: 1,
      }),
      'issue_continuation_retry_scheduled',
    );
  });

  it('stops scheduling retries after maxTurns is reached', async () => {
    const workspaceRoot = createWorkspaceRoot();
    const mockCliPath = path.join(workspaceRoot, 'continuation-final-cli.mjs');
    fs.writeFileSync(
      mockCliPath,
      [
        "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:1000,num_turns:2,usage:{input_tokens:11,output_tokens:3}}));",
      ].join('\n'),
      'utf8',
    );

    const config = {
      ...createConfig(workspaceRoot, `node \"${mockCliPath}\"`),
      agent: {
        ...DEFAULT_SERVICE_CONFIG.agent,
        maxTurns: 2,
      },
    };
    const state = seedRunningState(workspaceRoot);

    const result = await runContinuationCycle(state, config);

    expect(result.continuedIssueIds).toEqual(['1']);
    expect(state.running['1']).toMatchObject({
      turnCount: 2,
      lastEvent: 'turn_completed',
    });
    expect(state.retryAttempts['1']).toBeUndefined();
  });
});
