import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const initRuntimeDirectoryInputSchema = z.object({
  cwd: z.string().min(1),
  project: z.string().min(1).default('your-org/your-repo'),
  repoUrl: z.string().min(1).default('https://cnb.cool/your-org/your-repo.git'),
  force: z.boolean().default(false),
});

export interface InitRuntimeDirectoryInput {
  cwd: string;
  project?: string;
  repoUrl?: string;
  force?: boolean;
}

export interface InitRuntimeDirectoryResult {
  workflowPath: string;
  workspaceRoot: string;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function renderWorkflow(project: string, repoUrl: string): string {
  return `---
tracker:
  kind: cnb
  endpoint: https://api.cnb.cool
  apiKey: $CNB_TOKEN
  projectSlug: ${project}
  activeStates: [open]
  terminalStates: [closed]
  candidate_label: agent-ready
  exclude_label: skip-agent
  finish_label: agent-finish

polling:
  interval_ms: 30000

workspace:
  root: ./.codebuddy-auto/workspaces
  mode: directory
  source_root: .

server:
  host: 127.0.0.1
  port: 4317

agent:
  max_concurrent_agents: 1
  max_turns: 30
  no_progress_threshold: 3
  max_retry_backoff_ms: 300000

worker:
  kind: local

codebuddy:
  command: codebuddy
  permission_mode: bypassPermissions
  turn_timeout_ms: 3600000
  read_timeout_ms: 15000
  stall_timeout_ms: 300000
  mcp_strict: true
  dangerously_skip_permissions: false

hooks:
  after_create: |
    git clone ${repoUrl} .
    npm install
  before_run: |
    git status --short
  after_run: |
    npm run verify || true
  timeout_ms: 300000
---

You are working on a cnb.cool issue for \`${project}\`.

Issue:
- ID: {{ issue.identifier }}
- Title: {{ issue.title }}
- State: {{ issue.state }}
- Priority: {{ issue.priority }}
- URL: {{ issue.url }}

Description:

{{ issue.description }}

## Operating Rules

1. Read available project guidance before editing, especially \`README.md\`, \`AGENTS.md\`, \`CONTRIBUTING.md\`, and the nearest feature files.
2. Confirm the issue has the scheduler label \`agent-ready\`, then read the task type from the issue description when present.
3. Keep changes focused on the issue. Do not perform broad refactors.
4. For behavior changes, write or update tests before implementation.
5. Run the smallest useful verification while iterating.
6. Run the verification commands requested by the issue before handoff.
7. If the issue is ambiguous, blocked by missing credentials, or cannot pass verification, leave a clear comment and stop.
8. Add the \`agent-finish\` label only after verification passes, changes are committed and pushed, and the work is ready for human review.

## Handoff Format

When ready for human review, provide:

- Summary of changed behavior.
- Files changed.
- Verification commands and results.
- Risks or follow-ups.
`;
}

export async function initRuntimeDirectory(input: InitRuntimeDirectoryInput): Promise<InitRuntimeDirectoryResult> {
  const parsed = initRuntimeDirectoryInputSchema.parse(input);
  const workflowPath = path.join(parsed.cwd, 'WORKFLOW.md');
  const workspaceRoot = path.join(parsed.cwd, '.codebuddy-auto', 'workspaces');

  if (!parsed.force && await pathExists(workflowPath)) {
    throw new Error('WORKFLOW.md already exists; rerun with --force to overwrite');
  }

  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(workflowPath, renderWorkflow(parsed.project, parsed.repoUrl), 'utf8');

  return {
    workflowPath,
    workspaceRoot,
  };
}
