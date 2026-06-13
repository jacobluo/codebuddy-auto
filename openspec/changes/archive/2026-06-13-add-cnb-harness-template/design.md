## Context

`codebuddy-auto` schedules CNB issues, but the business repository still needs a small "agent harness" so humans can create tasks with the fields an agent needs. CNB issue templates are repository-local, so a template stored only in `codebuddy-auto` will not take effect in a business repository. At the same time, maintaining separate copies by hand across many repositories creates drift.

This change treats the CNB issue template as a reusable harness asset: `codebuddy-auto` owns the canonical template, while business repositories receive an installed copy under `.cnb/ISSUE_TEMPLATE/`.

## Goals / Non-Goals

**Goals:**

- Provide a canonical `agent-ready` CNB issue template.
- Provide a small installer that copies the canonical template into a target repository.
- Preserve existing files by default so the installer is safe to run against an existing business repository.
- Document how labels and task type fields are intended to work.

**Non-Goals:**

- No scheduler candidate-selection changes.
- No CNB API calls to create labels automatically.
- No business repository bootstrapping beyond the issue template.
- No dependency additions.

## Decisions

1. Store the canonical template under `templates/cnb/ISSUE_TEMPLATE/`.

   Alternative considered: keep only documentation and ask users to copy snippets manually. That avoids a script but makes multi-project maintenance brittle. A canonical file gives us one source of truth that can be tested.

2. Install by copying into the target repository instead of symlinking.

   Alternative considered: symlink from the business repository back to `codebuddy-auto`. CNB reads repository content remotely, so symlinks to local scheduler paths would not be portable. A copied file is explicit and works after push.

3. Default to no-overwrite behavior.

   Alternative considered: always overwrite the target template to keep it current. That is too surprising for business repositories that customize wording. The installer will fail when a target file already exists unless the user asks for overwrite.

4. Keep task type as an issue form field, not as multiple scheduler labels.

   Alternative considered: create labels such as `agent-ready:ui-bug`. That increases label management and scheduler complexity. A single `agent-ready` label remains the scheduling signal; the task type field gives the agent task-specific guidance.

## Risks / Trade-offs

- [Risk] CNB will not apply `labels: ["agent-ready"]` unless the label already exists in the business repository -> Mitigation: document that `agent-ready`, `skip-agent`, and `agent-finish` labels must be created before relying on template auto-labeling.
- [Risk] Business repositories customize the installed template and later miss canonical updates -> Mitigation: default no-overwrite behavior makes drift explicit; users can rerun with an overwrite flag when they want to refresh.
- [Risk] The installer could accidentally write outside the target repository -> Mitigation: require an explicit target directory and only create/write the `.cnb/ISSUE_TEMPLATE/agent-ready.yml` path under that directory.
