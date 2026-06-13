## 1. Canonical Template

- [x] 1.1 Add the canonical CNB `agent-ready` issue template under `templates/cnb/ISSUE_TEMPLATE/`.

## 2. Installer

- [x] 2.1 Add a failing installer test that expects the template to be copied into a target repository, preserved by default, and overwritten only when requested.
- [x] 2.2 Implement the `scripts/install-cnb-harness` installer to satisfy the test.

## 3. Documentation and Verification

- [x] 3.1 Document CNB harness installation, required labels, and workflow usage for business repositories.
- [x] 3.2 Align the `symphony_repo_crm` workflow example with directory-mode workspace population and task type field guidance.
- [x] 3.3 Run focused installer tests and repository verification.
