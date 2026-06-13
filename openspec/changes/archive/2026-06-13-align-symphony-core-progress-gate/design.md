## Context

codebuddy-auto currently follows the Symphony scheduler shape: it polls a tracker, dispatches per-issue workers in isolated workspaces, retries failures, and releases issues when tracker state makes them ineligible. The CRM run for issue #3 exposed a quality gap: the agent generated useful work but also left untracked files with import errors, then continued for many turns without reaching handoff.

The current `sdk-multi-turn-worker` spec also says `maxTurns` applies the finish label as a safety net. That conflicts with Symphony SPEC §1.1 and §7.1, where scheduler completion is a workflow-defined handoff, not a proxy for "the agent used all turns." Reaching a turn limit is operational evidence, not proof of readiness for human review.

## Goals / Non-Goals

**Goals:**

- Preserve the Symphony-compatible core boundary: the agent remains responsible for project validation, commits, pushes, tracker comments, and handoff labels.
- Reclassify `maxTurns` as a non-handoff stop condition that never auto-applies `agent-finish`.
- Add a progress-gate enhancement that detects repeated no-progress turns from observable workspace/tracker signals.
- Expose progress and stuck information in status surfaces so operators can diagnose stalled issues.

**Non-Goals:**

- Do not make the scheduler interpret or own project-specific commands such as `npm run verify`.
- Do not add a persistent database for stuck state.
- Do not automatically close issues, create PRs, or apply `agent-finish`.
- Do not require business repositories to change their test commands.

## Decisions

### Decision 1: Keep validation agent-owned

The scheduler will not run or interpret the issue's `Verification` field as core behavior. The workflow prompt continues to require the agent to run verification before handoff.

Alternatives considered:

- Scheduler runs `npm run verify`: rejected because it hard-codes project semantics into orchestration and diverges from Symphony's tracker/handoff boundary.
- Scheduler parses arbitrary verification output: rejected because it is brittle and difficult to make tracker-agnostic.

### Decision 2: Treat `maxTurns` as stuck, not finished

When a worker reaches `agent.maxTurns`, it exits without applying the finish label. Runtime state records the max-turns stop condition so the dashboard can show why the issue stopped.

Alternatives considered:

- Keep auto-finish behavior: rejected because it can mark unverified work ready for review.
- Close the issue on maxTurns: rejected because turn exhaustion is not business completion.

### Decision 3: Add progress fingerprints as an enhancement layer

After each completed turn boundary, the system records a fingerprint composed of observable signals such as current HEAD commit, short git status, untracked file summary, tracker state, tracker labels, and worker exit/turn event. The fingerprint is used only to detect repeated no-progress turns.

Alternatives considered:

- Full diff hashing: rejected for the first version because it can be expensive and leaks too much content into runtime state.
- Verification-output hashing: deferred because it requires an explicit validation capture contract.

### Decision 4: Stuck state is in-memory and operator-visible

When an issue reaches the configured no-progress threshold, the runtime marks it stuck, emits an issue event, and prevents further continuation/dispatch for that issue in the current process. It does not modify tracker labels by default.

Alternatives considered:

- Apply `skip-agent` or `needs-human` automatically: rejected for the first version because it changes tracker state and needs a separate operator policy.
- Persist stuck state: rejected to keep Symphony restart-recovery semantics.

## Risks / Trade-offs

- [Risk] In-memory stuck state is lost on process restart -> Mitigation: expose the stuck reason before restart and keep tracker writes as a future optional policy.
- [Risk] Fingerprint ignores meaningful semantic progress -> Mitigation: use conservative defaults and include commit/status/tracker signals rather than only worker event names.
- [Risk] Stopping on no-progress too early can interrupt a slow but valid task -> Mitigation: make the threshold configurable and default it above one repeated turn.
- [Risk] Removing maxTurns auto-finish may leave more issues awaiting operator review -> Mitigation: this is safer than false handoff; dashboard will show `max_turns_reached`.

