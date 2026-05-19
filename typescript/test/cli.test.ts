import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli.js';
import * as schedulerModule from '../src/scheduler/index.js';
import * as trackerModule from '../src/tracker/index.js';

const tempDirs: string[] = [];
let runDispatchCycleSpy: ReturnType<typeof vi.spyOn> | null = null;
let startSchedulerSpy: ReturnType<typeof vi.spyOn> | null = null;
let createTrackerSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  runDispatchCycleSpy = vi.spyOn(schedulerModule, 'runDispatchCycle') as ReturnType<typeof vi.spyOn>;
  startSchedulerSpy = vi.spyOn(schedulerModule, 'startScheduler') as ReturnType<typeof vi.spyOn>;
  createTrackerSpy = vi.spyOn(trackerModule, 'createTracker') as ReturnType<typeof vi.spyOn>;
});

afterEach(() => {
  runDispatchCycleSpy?.mockRestore();
  startSchedulerSpy?.mockRestore();
  createTrackerSpy?.mockRestore();
  runDispatchCycleSpy = null;
  startSchedulerSpy = null;
  createTrackerSpy = null;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkflow(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfirst-cli-'));
  tempDirs.push(dir);
  const workflowPath = path.join(dir, 'WORKFLOW.md');
  fs.writeFileSync(workflowPath, contents);
  return workflowPath;
}

describe('runCli', () => {
  it('returns 0 for a valid workflow in check mode', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: cnb
  apiKey: token
workspace:
  root: .
---
Prompt
`);

    await expect(runCli(['node', 'agentfirst-f1', workflowPath, '--check'])).resolves.toBe(0);
  });

  it('returns 1 when the workflow is missing', async () => {
    await expect(runCli(['node', 'agentfirst-f1', '/missing/WORKFLOW.md', '--check'])).resolves.toBe(1);
  });

  it('passes the workflow prompt template into the dispatch cycle', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
codebuddy:
  command: node -e "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false}))"
---
Implement {{ issue.identifier }} with {{ issue.title }}
`);

    if (!runDispatchCycleSpy) {
      throw new Error('runDispatchCycle spy was not initialized');
    }

    runDispatchCycleSpy.mockResolvedValue({
      availableSlots: 10,
      dispatchableIssueIds: [],
      claimedIssueIds: [],
    });

    await expect(runCli(['node', 'agentfirst-f1', workflowPath])).resolves.toBe(0);

    expect(runDispatchCycleSpy).toHaveBeenCalledTimes(1);
    const promptTemplate = (runDispatchCycleSpy.mock.calls[0] as unknown[] | undefined)?.[3];
    expect(promptTemplate).toBe('Implement {{ issue.identifier }} with {{ issue.title }}');
  });

  it('starts the polling scheduler in daemon mode', async () => {
    const workflowPath = createWorkflow(`---
tracker:
  kind: local
  apiKey: token
workspace:
  root: .
---
Prompt
`);

    const fakeTracker = {
      fetchCandidateIssues: vi.fn(),
      fetchIssuesByStates: vi.fn(),
      fetchIssueStatesByIds: vi.fn(),
    };
    createTrackerSpy?.mockReturnValue(fakeTracker);
    startSchedulerSpy?.mockReturnValue({
      stop: async () => undefined,
    });

    await expect(runCli(['node', 'agentfirst-f1', workflowPath, '--daemon'])).resolves.toBe(0);

    expect(startSchedulerSpy).toHaveBeenCalledTimes(1);
    expect(runDispatchCycleSpy).not.toHaveBeenCalled();
  });
});
