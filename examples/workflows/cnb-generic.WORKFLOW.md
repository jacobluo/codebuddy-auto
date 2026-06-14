---
tracker:
  kind: cnb
  endpoint: https://api.cnb.cool
  apiKey: $CNB_TOKEN
  projectSlug: your-org/your-repo
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
  sdk_max_turns: 100
  permission_mode: bypassPermissions
  turn_timeout_ms: 3600000
  read_timeout_ms: 15000
  stall_timeout_ms: 300000
  mcp_strict: true
  dangerously_skip_permissions: false

hooks:
  after_create: |
    git clone https://cnb.cool/your-org/your-repo.git .
    npm install
  before_run: |
    git status --short
  after_run: |
    npm run verify || true
  timeout_ms: 300000
---

You are working on a cnb.cool issue for `your-org/your-repo`.

Issue:
- ID: {{ issue.identifier }}
- Title: {{ issue.title }}
- State: {{ issue.state }}
- Priority: {{ issue.priority }}
- URL: {{ issue.url }}

Description:

{{ issue.description }}

## Operating Rules

1. Read available project guidance before editing, especially `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, and the nearest feature files.
2. Confirm the issue has the scheduler label `agent-ready`, then read the task type from the issue description when present.
3. Keep changes focused on the issue. Do not perform broad refactors.
4. For behavior changes, write or update tests before implementation.
5. Run the smallest useful verification while iterating.
6. Run the verification commands requested by the issue before handoff.
7. If the issue is ambiguous, blocked by missing credentials, or cannot pass verification, leave a clear comment and stop.
8. Add the `agent-finish` label only after verification passes, changes are committed and pushed, and the work is ready for human review.

## Handoff Format

When ready for human review, provide:

- Summary of changed behavior.
- Files changed.
- Verification commands and results.
- Risks or follow-ups.
