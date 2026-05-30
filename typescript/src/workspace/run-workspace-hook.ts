import { spawn } from 'node:child_process';

import type { ServiceConfig } from '../spec/index.js';

export interface RunWorkspaceHookInput {
  script: string;
  workspacePath: string;
  timeoutMs: number;
}

export interface WorkspaceHookResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export async function runWorkspaceHook(input: RunWorkspaceHookInput): Promise<WorkspaceHookResult> {
  const child = spawn('/bin/sh', ['-lc', input.script], {
    cwd: input.workspacePath,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdoutChunks.push(String(chunk));
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderrChunks.push(String(chunk));
  });

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, input.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', (error) => {
      reject(error);
    });
    child.once('close', (code) => {
      resolve(code);
    });
  });

  clearTimeout(timeoutHandle);

  return {
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    exitCode,
    timedOut,
  };
}

export function getWorkspaceHookScript(
  config: ServiceConfig,
  hookName: 'afterCreate' | 'beforeRun' | 'afterRun' | 'beforeRemove',
): string | null {
  const script = config.hooks[hookName];
  return typeof script === 'string' && script.trim().length > 0 ? script : null;
}
