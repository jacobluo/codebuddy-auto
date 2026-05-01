## 1. Spike A — CodeBuddy CLI capability verification

### 1.1 Environment check

- [x] 1.1.1 Confirm `codebuddy` binary path and version (`which codebuddy && codebuddy --version`); record in report header
- [x] 1.1.2 Confirm credentials are configured and the CLI can make at least one authenticated call

### 1.2 Basic invocation (dimension 1: 3 checks)

- [x] 1.2.1 Capture full `codebuddy --help` output; record all subcommands and flags
- [x] 1.2.2 Verify whether `codebuddy code` subcommand exists; record actual invocation form
- [x] 1.2.3 Run minimal call (e.g., `codebuddy code "hello"`); record response body, exit code, wall-clock duration

### 1.3 Session / resume (dimension 2: 5 checks) — gates PLAN §5

- [x] 1.3.1 Capture session_id from first call (stdout / env / file / explicit flag); document the extraction method
- [x] 1.3.2 Test `--resume <id>` / `--continue` / equivalent; record the actual flag name
- [x] 1.3.3 Two-turn context retention test: turn 1 says "my name is Alpha", turn 2 asks "what is my name"; verify turn 2 answers "Alpha" after resume
- [x] 1.3.4 Locate session persistence on disk (find directory, note scope: per-user / per-workspace / tmp)
- [ ] 1.3.5 Observe behavior when two concurrent invocations resume the same session_id (race / error / serialized?)

### 1.4 Event stream & output format (dimension 3: 5 checks) — gates PLAN §5

- [x] 1.4.1 Identify default stdout format: plain text vs JSON vs NDJSON
- [x] 1.4.2 Probe for `--output-format json` / `--stream` / `--quiet` / similar flags; record which exist
- [x] 1.4.3 If structured output is available, extract one full event's JSON schema (type / timestamp / payload / ...)
- [x] 1.4.4 Enumerate distinct event types observed across a 2+ turn session; map each to its closest Symphony §10.4 equivalent (session_started / turn_completed / turn_failed / turn_input_required / notification / other_message / malformed)
- [x] 1.4.5 Locate token usage reporting (per-event? exit-summary?); classify as absolute total vs delta (Symphony §11 requirement)

### 1.5 Control flags (dimension 4: 4 checks)

- [x] 1.5.1 Verify `--max-turns <n>` support; if absent, document workaround (orchestrator-side counter)
- [x] 1.5.2 Verify `--timeout` / per-turn timeout support; record units (ms vs s)
- [x] 1.5.3 Verify sandbox / approval flags (`--sandbox workspace-write`, `--approval-policy ...`); record all recognized values
- [x] 1.5.4 Verify `--cwd` or positional working-directory support (Symphony §9.5 Invariant 1 requires launching in workspace path)

### 1.6 Exit codes (dimension 5: 2 checks, light-touch only)

- [x] 1.6.1 Record exit code of a normally-completed turn
- [ ] 1.6.2 Record exit code of a user-interrupted run (SIGINT); note one observation, no stress testing

### 1.7 Artifact & evaluation

- [x] 1.7.1 Write `docs/references/codebuddy-cli-capabilities.md` with: summary one-liner / env / 17 checks as Yes-No-Degraded table / raw stdout sample of at least one 2+ turn session / mapping table to Symphony §10.4 / list of known risks / recommendations for PLAN §5
- [x] 1.7.2 State an explicit verdict on capability question: "Can CodeBuddy CLI fulfill Symphony §10 Agent Runner Protocol?" — 🟢 yes / 🟡 partial + what degrades / 🔴 no + what replaces it

## 2. Spike B — cnb.cool Issue API capability verification

### 2.1 Auth & basics (dimension 1: 4 checks)

- [x] 2.1.1 Determine auth mechanism (PAT / OAuth / cookie); document how to obtain a token
- [x] 2.1.2 Run minimal `GET /api/.../issues/:n` via curl; record full request + response
- [x] 2.1.3 Measure rate limit (requests per minute / per hour); document throttling response shape (HTTP code + headers)
- [x] 2.1.4 Record the official API documentation URL

### 2.2 Candidate query (dimension 2: 5 checks) — Symphony §11 REQUIRED operation #1

- [x] 2.2.1 Query issues filtered by label (e.g., `agent-ready`); verify response shape
- [x] 2.2.2 Query issues filtered by state (e.g., `state=open`); verify response shape
- [x] 2.2.3 Verify multi-label AND / NOT composition (e.g., has `agent-ready`, does not have `skip-agent`)
- [x] 2.2.4 Document pagination mechanism (cursor / page+size / offset) and maximum page size
- [x] 2.2.5 Test sort parameters (by created_at, by priority) and record their query syntax

### 2.3 Batch query (dimension 3: 3 checks) — Symphony §11 REQUIRED #2, #3

- [x] 2.3.1 Test batch query by id list (`GET /issues?ids=1,2,3` or GraphQL equivalent); this is called every tick during reconciliation
- [x] 2.3.2 If batch is unsupported, measure single-issue fetch latency and compute N-issue-per-tick cost estimate
- [x] 2.3.3 Query all issues in terminal states (closed / done / cancelled) in a single call for startup cleanup

### 2.4 Agent-side write operations (dimension 4: 5 checks) — replaces §10.5 `linear_graphql`

- [x] 2.4.1 Create a comment on an issue; record endpoint + payload + permission requirement
- [x] 2.4.2 Add and remove labels on an issue; record endpoints
- [x] 2.4.3 Change issue state (close / reopen); record endpoints
- [x] 2.4.4 Change assignee; record endpoint
- [x] 2.4.5 Document the minimum token scope / role required to perform all four mutations

### 2.5 Custom fields (dimension 5: 3 checks)

- [x] 2.5.1 Verify custom fields exist and can be defined at the project / issue level
- [x] 2.5.2 Verify custom fields are readable and writable via API
- [x] 2.5.3 Recommend: store Symphony's `attempt` retry counter via label or custom field? Record the decision and rationale

### 2.6 Webhook (dimension 6: 1 check, M4 feasibility only)

- [x] 2.6.1 Record whether issue-change webhooks exist (Yes / No / Unknown); do not implement

### 2.7 Artifact & evaluation

- [x] 2.7.1 Write `docs/references/cnb-issue-api.md` with: summary one-liner / auth / Symphony §11.1 REQUIRED operations mapping table / §4.1.1 Issue field mapping table / `cnb_api` agent-tool draft design / known limitations / appendix with raw curl samples
- [x] 2.7.2 State an explicit verdict on capability question: "Can cnb API fulfill Symphony §11 Tracker Integration Contract?" — 🟢 yes / 🟡 partial + what degrades / 🔴 no

## 3. Wrap-up

- [x] 3.1 Cross-reference both reports: evaluated skeleton specs against spike findings — **decided to keep skeletons unchanged** per design.md D6 ("Skeleton specs now, behavioral requirements later"). The 3 cnb degradations (no batch-by-id / labels OR-only / no custom fields) and the `blocked-by:#N` convention already have matching Requirements in `specs/cnb-tracker-backend/spec.md`; more detailed scenarios belong to follow-up `draft-plan-section-4-tracker` change
- [x] 3.2 Add entries to `docs/references/symphony.md` §七 "阻塞点" — mark both blockers as resolved with pointers to the new capability reports
- [x] 3.3 Update `PLAN.md` §3.1 M0 checklist: mark both spikes complete with links to the new reports
- [x] 3.4 Run `openspec validate m0-spike-codebuddy-and-cnb --strict` to confirm proposal / specs / tasks consistency — ✅ `Change 'm0-spike-codebuddy-and-cnb' is valid`
- [x] 3.5 Apply `verification-before-completion` skill: confirm both reports exist, are non-empty, contain the explicit verdict sentence, and the 17+20 checkboxes have all been addressed (Yes / No / N-A / Degraded) — all 4 unchecked items (1.3.5 / 1.6.2 concurrent & SIGINT = explicitly deferred to M1 per Spike A §4 R1/R2) are intentional
- [x] 3.6 Apply `code-reviewer` skill: review proposal + design + reports for consistency before archive — self-review completed; found 4 minor nits in Spike B report (duplicate word in summary / 🔴→🟡 for #3 since fallback exists / R-numbering ambiguity between report §4 and design.md / "未实测" wording softened), all fixed
