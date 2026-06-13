---
tracker:
  kind: local
  apiKey: local-demo-token
  activeStates: [open]
  terminalStates: [closed]
polling:
  interval_ms: 30000
workspace:
  root: ../../.demo-workspaces
  mode: directory
  source_root: ../..
hooks:
  timeout_ms: 120000
server:
  host: 127.0.0.1
  port: 4317
agent:
  max_concurrent_agents: 1
  max_turns: 10
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

This is a local demo workflow used only to preview the dashboard SPA.

There are no real tracker issues attached in this mode.
