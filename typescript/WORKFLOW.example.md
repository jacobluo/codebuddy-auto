---
tracker:
  kind: cnb
  endpoint: https://api.cnb.cool
  apiKey: $CNB_TOKEN
  projectSlug: your-org/your-repo
  activeStates: [open]
  terminalStates: [closed]
polling:
  interval_ms: 30000
workspace:
  root: ./.codebuddy-auto/workspaces
  mode: directory
  source_root: .
hooks:
  timeout_ms: 120000
  before_run: |
    if [ ! -d .git ]; then
      git clone https://cnb.cool/your-org/your-repo.git .
    fi
server:
  host: 127.0.0.1
  port: 4317
agent:
  max_concurrent_agents: 1
  max_turns: 20
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
---

You are working on {{ issue.identifier }}: {{ issue.title }}.

Issue details:
{{ issue.description }}

Repository: your-org/your-repo
Tracker: cnb.cool

Goals:
- Read the issue carefully and implement the requested change in the current workspace.
- Keep edits minimal and consistent with the existing codebase.
- Run the smallest useful verification for the change before finishing.

Constraints:
- Work only inside the assigned workspace.
- Do not change unrelated files.
- If the issue is blocked or ambiguous, explain the blocker clearly in your final response.

<!--
Optional: enforce a "commit + PR + agent-finish" handoff.
Replace `your-org/your-repo` and the target branch as needed.

- After implementation is verified, commit and push to a feature branch
  named `fix/issue-{{ issue.id }}`.
- Create a Pull Request:
    cnb pulls post-pull \
      --repo your-org/your-repo \
      --head "fix/issue-{{ issue.id }}" \
      --base main \
      --title "fix: {{ issue.title }}" \
      --body "Closes #{{ issue.id }}"
- After the PR is created successfully, add the finish label:
    cnb issues post-issue-labels \
      --repo your-org/your-repo \
      --number {{ issue.id }} \
      --labels agent-finish

cnb API: `--head` = source branch, `--base` = target branch.
A non-zero cnb CLI exit is a hard failure — do NOT add agent-finish in that case.
-->
