# CNB Harness

`codebuddy-auto` treats CNB issue templates as reusable harness assets.

The canonical template lives in this repository:

```text
templates/cnb/ISSUE_TEMPLATE/agent-ready.yml
```

CNB reads issue templates from each business repository, so install the template into the target repository before asking the scheduler to process tasks:

```bash
./scripts/install-cnb-harness ../symphony_repo_crm
```

The installed file is:

```text
../symphony_repo_crm/.cnb/ISSUE_TEMPLATE/agent-ready.yml
```

The installer preserves an existing template by default. To intentionally refresh a target repository with the canonical template:

```bash
./scripts/install-cnb-harness --overwrite ../symphony_repo_crm
```

## Required Labels

Create these labels in the business repository before relying on template auto-labeling or scheduler handoff:

```text
agent-ready
skip-agent
agent-finish
```

The scheduler uses `agent-ready` as the candidate label. The optional `skip-agent` label excludes an issue. The `agent-finish` label marks a task as ready for human review.

CNB issue templates only take effect in the repository where they are committed. Keeping the canonical source in `codebuddy-auto` avoids drift, but each business repository still needs its own installed copy.

## Task Type

The template's `Task type` field is part of the issue body. It is not a scheduler label.

Use one of:

```text
agent-ready:ui-bug
agent-ready:small-feature
agent-ready:test
agent-ready:cleanup
agent-ready:docs
```

The workflow prompt should tell the agent to read the `Task type`, `Problem`, `Expected behavior`, and `Verification` fields from the issue description.

## Workflow Prompt Guidance

Use wording like this in the business workflow prompt:

```text
Confirm the issue has the scheduler label `agent-ready`, then read the `Task type` field from the issue description. Treat it as one of:
`agent-ready:ui-bug`, `agent-ready:small-feature`, `agent-ready:test`, `agent-ready:cleanup`, or `agent-ready:docs`.
```

For directory-mode workspaces, remember that `codebuddy-auto` creates an empty per-issue workspace. Populate it in `hooks.after_create`, for example:

```yaml
hooks:
  after_create: |
    git clone https://cnb.cool/relaxorg/symphony_repo_crm.git .
    npm install
```
