import type { ServiceConfig } from '../spec/index.js';

export interface BuildCodebuddyCommandInput {
  config: ServiceConfig;
  prompt: string;
  sessionId: string;
  resumeSessionId?: string;
  workspacePath: string;
}

export interface CodebuddyCommand {
  command: string;
  args: string[];
  cwd: string;
}

function splitCommand(command: string): string[] {
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return parts.map((part) => part.replace(/^['"]|['"]$/g, ''));
}

function appendCsvFlag(args: string[], flag: string, values: string[] | undefined): void {
  if (!values || values.length === 0) {
    return;
  }

  args.push(flag, values.join(','));
}

function appendRepeatedFlag(args: string[], flag: string, values: string[] | undefined): void {
  if (!values || values.length === 0) {
    return;
  }

  for (const value of values) {
    args.push(flag, value);
  }
}

export function buildCodebuddyCommand(input: BuildCodebuddyCommandInput): CodebuddyCommand {
  const commandParts = splitCommand(input.config.codebuddy.command);
  const executable = commandParts[0];
  if (!executable) {
    throw new Error('codebuddy.command must not be empty');
  }

  const args = [...commandParts.slice(1), '--print', '--output-format', 'stream-json'];

  if (input.resumeSessionId) {
    args.push('--resume', input.resumeSessionId);
  } else {
    args.push('--session-id', input.sessionId);
  }

  if (input.config.codebuddy.sdkMaxTurns !== undefined) {
    args.push('--max-turns', String(input.config.codebuddy.sdkMaxTurns));
  }

  if (input.config.codebuddy.model) {
    args.push('--model', input.config.codebuddy.model);
  }

  if (input.config.codebuddy.permissionMode) {
    args.push('--permission-mode', input.config.codebuddy.permissionMode);
  }

  if (input.config.codebuddy.subagentPermissionMode) {
    args.push('--subagent-permission-mode', input.config.codebuddy.subagentPermissionMode);
  }

  if (input.config.codebuddy.sandbox) {
    args.push('--sandbox', input.config.codebuddy.sandbox);
  }

  appendCsvFlag(args, '--tools', input.config.codebuddy.tools);
  appendCsvFlag(args, '--allowedTools', input.config.codebuddy.allowedTools);
  appendCsvFlag(args, '--disallowedTools', input.config.codebuddy.disallowedTools);
  appendRepeatedFlag(args, '--add-dir', input.config.codebuddy.addDirs);

  if (input.config.codebuddy.dangerouslySkipPermissions) {
    args.push('-y');
  }

  if (input.config.codebuddy.mcpConfig) {
    args.push('--mcp-config', input.config.codebuddy.mcpConfig);
    if (input.config.codebuddy.mcpStrict) {
      args.push('--strict-mcp-config');
    }
  }

  args.push(input.prompt);

  return {
    command: executable,
    args,
    cwd: input.workspacePath,
  };
}
