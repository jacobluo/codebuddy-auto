## Context

agentfirst-f1 is a TypeScript reference implementation of the Symphony specification. Symphony's original `§10 Agent Runner Protocol` is built against the Codex app-server stdio protocol. This project substitutes **CodeBuddy Code CLI** as the agent execution layer.

Symphony's `§11 Issue Tracker Integration` is built against the Linear GraphQL API. This project substitutes **cnb.cool Issue API** as the primary tracker backend, with Tracker kept as a pluggable interface (SPEC §18.2 TODO).

Both substitutions introduce uncertainty that must be resolved before the corresponding PLAN chapters can be drafted with confidence. This change runs two research spikes to reduce that uncertainty.

## Goals / Non-Goals

**Goals:**

- Confirm whether CodeBuddy Code CLI provides stable session / resume / event-stream semantics sufficient to satisfy Symphony §10 (launch + multi-turn + event emission + turn timeouts).
- Confirm whether cnb.cool Issue API provides label-based filtering, batch queries, and agent-write operations sufficient to satisfy Symphony §11 (three REQUIRED operations + agent-side `cnb_api` tool modeled after §10.5 `linear_graphql`).
- Produce two capability reports in `docs/references/` that become the factual input for later PLAN §4 / §5 drafting.
- Create skeleton specs for two new capabilities so the contract structure is in place for future expansion.

**Non-Goals:**

- Implementing any `typescript/src/` code (this is a docs-only change).
- Exhaustive boundary testing of CLI failure modes (Ctrl-C, OOM, network loss) — deferred to M1 Runner implementation.
- Full enumeration of every CodeBuddy event type — only enough distinct types to validate the §10.4 event-mapping strategy.
- Webhook implementation for cnb — only feasibility is assessed; actual wiring is M4.
- Testing alternative agent backends (Claude Code CLI, Codex, etc.) — CodeBuddy only.
- Testing alternative tracker backends (TAPD, GitHub, Linear) — cnb only.

## Decisions

### D1. Two separate capabilities rather than one

- **Chosen**: Split into `codebuddy-cli-integration` and `cnb-tracker-backend`.
- **Alternative considered**: A single `m0-foundations` capability grouping both.
- **Rationale**: The two substitutions map to different Symphony chapters (§10 vs §11), have different failure modes, and are owned by different `typescript/src/` directories (`runner/` vs `tracker/`). Keeping them separate matches the source-tree layout and allows independent versioning of future spec additions.

### D2. Primary tracker backend = cnb.cool (not TAPD / GitHub / Linear)

- **Chosen**: cnb.
- **Alternatives considered**: TAPD (three-table model: 需求/缺陷/任务 breaks Symphony's flat Issue assumption; internal-only); GitHub (single-table and mature, but account-access friction for this project); Linear (native alignment but no account available).
- **Rationale**: cnb has a single-table Issue model aligned with Symphony §4.1.1, custom labels enabling `blocked-by:#N` emulation, native priority / assignee / timestamps, and accessible credentials. It is also the git host for this repo, reducing platform surface area.

### D3. LiveSession field naming: `agent_*` (not `codex_*` / `codebuddy_*`)

- **Chosen**: Rename Symphony's `codex_*` family of LiveSession fields (§4.1.6) to `agent_*`.
- **Alternatives considered**: Preserve `codex_*` (honest to SPEC but misleading in this codebase); use `codebuddy_*` (accurate but couples the field name to a specific backend, blocking future pluggability).
- **Rationale**: `agent_*` aligns with the pluggable-Agent direction (mirroring the pluggable-Tracker direction), keeps the codebase backend-agnostic, and makes the type system read as "any agent backend" rather than "the Codex backend in disguise". A mapping table in PLAN §3 will document the Symphony → agentfirst-f1 field correspondence for readers cross-referencing the SPEC.

### D4. Scheduler state is intentionally NOT persisted

- **Chosen**: No SQLite / Redis / persistent queue. Recovery is tracker-driven and filesystem-driven (reuse workspaces across restarts).
- **Alternative considered**: Persisting retry queue and running sessions for faster restart recovery.
- **Rationale**: This is Symphony SPEC §14.3 verbatim. Persistence adds operational complexity (schema migrations, race conditions on restart, durability tradeoffs) for a single benefit (shorter restart recovery window) that Symphony's design explicitly chose not to optimize for. PLAN §3 must state this constraint explicitly so future contributors don't silently introduce persistence.

### D5. Spike order: A before B

- **Chosen**: CodeBuddy CLI spike first, cnb API spike second.
- **Alternative considered**: Parallel execution, or cnb first.
- **Rationale**: The CLI spike gates §5 Agent Protocol (the hardest chapter in PLAN) and has the highest design impact — if CodeBuddy CLI lacks `--resume`, continuation must be redesigned around a workspace-side history file. cnb's potential gaps have cheaper fallbacks (git notes / PR body markers as ticket writes). Single-operator serialization also keeps context-switching cost low.

### D6. Skeleton specs now, behavioral requirements later

- **Chosen**: Each new capability's `spec.md` contains one minimal SHALL-level requirement; detailed scenarios are added in follow-up changes (e.g., `draft-plan-section-5-agent-protocol`).
- **Alternative considered**: Write full scenarios now based on Symphony §10 / §11 directly.
- **Rationale**: Writing scenarios before spike verification risks locking in assumptions that the CLI / API later contradicts. Skeleton + later refinement matches the "iterative not waterfall" spirit of OpenSpec.

## Risks / Trade-offs

- **R1. CodeBuddy CLI lacks `--resume` or equivalent session continuation** → Mitigation: Fall back to workspace-side history file; agent prompt is re-injected each turn with compressed history. Document as a degraded mode in PLAN §5.

- **R2. cnb API does not expose comment / label mutation endpoints to PAT-level auth** → Mitigation: Drop the `cnb_api` agent-side write tool in M1; agent writes tickets indirectly via commit messages with structured markers (e.g., `Closes #101`, `Moves-to: needs-review`).

- **R3. cnb API lacks batch-by-ids query, forcing N API calls per reconciliation tick** → Mitigation: Accept N-factor latency in M1; add a local cache in M2; revisit if N-scale concurrency becomes a bottleneck in M3.

- **R4. CodeBuddy CLI event stream is unstructured (plain-text)** → Mitigation: Parse with regex + heuristics; document in PLAN §5 that event extraction is best-effort; token counts may come from the CLI's final exit summary rather than per-event `usage` payloads.

- **R5. Spike output stale over time** (CodeBuddy CLI / cnb API evolve) → Mitigation: Re-run spikes before each major milestone; the 17+20 checklists are kept as a re-runnable probe script in M2+ for regression detection.

## Open Questions

- **O1**: Should the `cnb_api` agent-side tool be implemented as a Model Context Protocol (MCP) tool or as a CodeBuddy CLI client-side tool declaration? Resolved after Spike A confirms CodeBuddy's tool declaration mechanism.

- **O2**: What is the sanitization rule for cnb issue identifiers (e.g., `#101` → workspace directory name)? Deferred to `workspace-management` capability.

- **O3**: Will PLAN.md eventually be fully migrated to `openspec/specs/`, or stay as a roadmap summary with specs as source-of-truth? Decided at M0 end.
