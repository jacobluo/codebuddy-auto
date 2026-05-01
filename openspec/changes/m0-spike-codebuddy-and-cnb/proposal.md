## Why

`PLAN.md` §3.1 identifies two M0 blockers that prevent drafting the two hardest spec chapters:

- **§5 Agent Protocol** cannot be drafted without verifying CodeBuddy Code CLI's session / resume / event-stream capabilities
- **§4 Tracker Contract** cannot be drafted without verifying cnb.cool Issue API's label filtering, batch query, and comment/label mutation capabilities

Both are exploratory research tasks. Their output (capability reports under `docs/references/`) will directly inform the behavioral requirements of the two future capabilities named below.

## What Changes

Run two research spikes and produce two capability reports:

- **Spike A — CodeBuddy CLI capabilities** (17 checks across 5 dimensions: help / session-resume / event-stream / control flags / exit codes). Produce `docs/references/codebuddy-cli-capabilities.md` with NDJSON samples of at least one 2+ turn conversation.
- **Spike B — cnb.cool Issue API capabilities** (20 checks across 6 dimensions: auth / candidate query / batch query / agent-write ops / custom fields / webhook-feasibility). Produce `docs/references/cnb-issue-api.md` with curl samples.

Also establish two new capabilities with **skeleton specs only**. Detailed behavioral requirements will be added in follow-up changes after spike reports confirm feasibility.

Not in scope (explicitly):
- Boundary / stress testing (Ctrl-C, timeout, network loss) — deferred to M1 Runner implementation
- Full enumeration of every event type — only enough for §5 drafting
- Webhook implementation for cnb — M4 consideration only
- Multi-agent backend testing — CodeBuddy only for now

## Capabilities

### New Capabilities

- `codebuddy-cli-integration`: The agent execution layer — how agentfirst-f1 launches CodeBuddy Code CLI as a subprocess, drives multi-turn conversations, and maps CLI events to Symphony §10.4 semantics.
- `cnb-tracker-backend`: The cnb.cool implementation of the Tracker interface (Symphony §11) — how issues are fetched, filtered via labels, and reconciled; how agent-side write tools (comments / label / state) are exposed.

### Modified Capabilities

None. This is an additive change that introduces two new capability skeletons.

## Impact

**Documents affected:**
- `PLAN.md` §3.1 M0 spike checklist becomes the source of task items
- `PLAN.md` §4 Tracker Contract — draftable after this change archives
- `PLAN.md` §5 Agent Protocol — draftable after this change archives
- `docs/references/codebuddy-cli-capabilities.md` — new file
- `docs/references/cnb-issue-api.md` — new file

**Code affected:** None. No `typescript/src/` code written in this change.

**Future capabilities unblocked:**
- `run-lifecycle` (§6) depends on event semantics confirmed in Spike A
- `workspace-management` (§7) depends on `--cwd` support confirmed in Spike A
- `workflow-format` (§8) depends on config field names finalized after both spikes
