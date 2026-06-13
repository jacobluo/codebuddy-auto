---
tracker:
  kind: cnb
  endpoint: https://api.cnb.cool
  apiKey: $CNB_TOKEN
  projectSlug: relaxorg/symphony_repo_crm
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
    npm install
    npx playwright install chromium
  before_run: |
    git status --short
  after_run: |
    npm run verify || true
  timeout_ms: 300000
---

You are working on a cnb.cool issue for `relaxorg/symphony_repo_crm`.

Issue:
- ID: {{ issue.identifier }}
- Title: {{ issue.title }}
- State: {{ issue.state }}
- Priority: {{ issue.priority }}
- URL: {{ issue.url }}

Description:

{{ issue.description }}

## Operating Rules

1. Read `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/symphony-harness.md`, and the nearest feature files before editing.
2. Confirm the issue has the scheduler label `agent-ready`, then identify the task type: `agent-ready:ui-bug`, `agent-ready:small-feature`, `agent-ready:test`, `agent-ready:cleanup`, or `agent-ready:docs`.
3. Keep changes focused on the issue. Do not perform broad refactors.
4. For behavior changes, write or update tests before implementation.
5. Prefer feature-local files under `src/features/<feature>` before editing `src/shared`.
6. Run the smallest useful verification while iterating.
7. Run `./scripts/verify` before handoff unless the issue is docs-only.
8. For UI changes, capture or describe the checked viewport and changed screen.
9. If the issue is ambiguous, blocked by missing credentials, or cannot pass verification, leave a clear comment and stop.
10. After verified handoff, add the `agent-finish` label only when the work is ready for human review.

## Handoff Format

When ready for human review, provide:

- Summary of changed behavior.
- Files changed.
- Verification commands and results.
- UI evidence for visual changes.
- Risks or follow-ups.

Add the `agent-finish` label only after verification passes or after documenting a real blocker.
