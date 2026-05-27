import path from 'node:path';

import type { CodebuddyCommand } from '../runner/index.js';
import type { ServiceConfig } from '../spec/index.js';

function splitCommand(command: string): string[] {
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return parts.map((part) => part.replace(/^['"]|['"]$/g, ''));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildSshTarget(config: ServiceConfig): string {
  const host = config.worker.sshHost;
  if (!host) {
    throw new Error('worker.sshHost is required in ssh worker mode');
  }

  return config.worker.sshUser ? `${config.worker.sshUser}@${host}` : host;
}

function resolveRemoteWorkspacePath(command: CodebuddyCommand, config: ServiceConfig): string {
  const remoteRoot = config.worker.remoteWorkspaceRoot ?? config.workspace.root;
  const relativePath = path.relative(path.resolve(config.workspace.root), path.resolve(command.cwd));
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return remoteRoot.replace(/\\/g, '/');
  }

  if (relativePath.length === 0) {
    return remoteRoot.replace(/\\/g, '/');
  }

  return path.posix.join(remoteRoot.replace(/\\/g, '/'), relativePath.split(path.sep).join('/'));
}

export function prepareWorkerCommand(command: CodebuddyCommand, config: ServiceConfig): CodebuddyCommand {
  if (config.worker.kind === 'local') {
    return command;
  }

  const sshCommandParts = splitCommand(config.worker.sshCommand);
  const executable = sshCommandParts[0];
  if (!executable) {
    throw new Error('worker.sshCommand must not be empty');
  }

  const remoteScript = [
    `cd ${shellQuote(resolveRemoteWorkspacePath(command, config))}`,
    `exec ${[command.command, ...command.args].map(shellQuote).join(' ')}`,
  ].join(' && ');

  const args = [...sshCommandParts.slice(1)];
  if (config.worker.sshPort !== undefined) {
    args.push('-p', String(config.worker.sshPort));
  }
  if (config.worker.sshOptions) {
    args.push(...config.worker.sshOptions);
  }
  args.push(buildSshTarget(config), 'sh', '-lc', remoteScript);

  return {
    command: executable,
    args,
    cwd: process.cwd(),
  };
}
