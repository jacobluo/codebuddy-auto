import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { ServiceConfig } from '../spec/index.js';

export interface PreflightResult {
  ok: boolean;
  errors: string[];
}

function isGitRepository(rootPath: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: rootPath,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function isSameOrNestedPath(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function validateGitWorktreePaths(config: ServiceConfig, errors: string[]): void {
  const workspaceRoot = path.resolve(config.workspace.root);
  const sourceRoot = path.resolve(config.workspace.sourceRoot);

  if (!fs.existsSync(config.workspace.sourceRoot)) {
    errors.push(`workspace.sourceRoot does not exist: ${config.workspace.sourceRoot}`);
    return;
  }
  if (!isGitRepository(config.workspace.sourceRoot)) {
    errors.push(`workspace.sourceRoot is not a git repository: ${config.workspace.sourceRoot}`);
    return;
  }
  if (workspaceRoot === sourceRoot) {
    errors.push('workspace.root must not equal workspace.sourceRoot in git-worktree mode');
    return;
  }
  if (isSameOrNestedPath(sourceRoot, workspaceRoot)) {
    errors.push('workspace.root must not be inside workspace.sourceRoot in git-worktree mode');
  }
  if (isSameOrNestedPath(workspaceRoot, sourceRoot)) {
    errors.push('workspace.sourceRoot must not be inside workspace.root in git-worktree mode');
  }
}

function validateSshWorker(config: ServiceConfig, errors: string[]): void {
  if ((config.worker.sshHost ?? '').length === 0) {
    errors.push('worker.sshHost is required for ssh worker');
  }
  if (config.worker.sshCommand.length === 0) {
    errors.push('worker.sshCommand is required for ssh worker');
  }
}

export function validatePreflight(config: ServiceConfig): PreflightResult {
  const errors: string[] = [];

  if (config.tracker.kind.length === 0) {
    errors.push('tracker.kind is required');
  }
  if ((config.tracker.apiKey ?? '').length === 0) {
    errors.push('tracker.apiKey is required');
  }
  if (config.tracker.kind === 'cnb' && (config.tracker.endpoint ?? '').length === 0) {
    errors.push('tracker.endpoint is required for cnb tracker');
  }
  if (config.tracker.kind === 'cnb' && (config.tracker.projectSlug ?? '').length === 0) {
    errors.push('tracker.projectSlug is required for cnb tracker');
  }
  if (config.codebuddy.command.length === 0) {
    errors.push('codebuddy.command is required');
  }
  if (!fs.existsSync(config.workspace.root)) {
    errors.push(`workspace.root does not exist: ${config.workspace.root}`);
  }
  if (config.workspace.mode === 'git-worktree') {
    validateGitWorktreePaths(config, errors);
  }
  if (config.worker.kind === 'ssh') {
    validateSshWorker(config, errors);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
