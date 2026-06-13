## 1. Root Package Contract

- [x] 1.1 Add or update packaging tests so they fail until a root package entrypoint exists.
- [x] 1.2 Add root package metadata and delegated scripts while keeping the TypeScript implementation under `typescript/`.

## 2. Documentation

- [x] 2.1 Update README local install instructions to use root-level `pnpm install`, `pnpm build`, `pnpm link --global`, and `pnpm pack`.

## 3. Verification

- [x] 3.1 Run focused packaging tests and TypeScript check/test/build.
- [x] 3.2 Verify root-level tarball install and root-level `pnpm link --global`.
- [x] 3.3 Run OpenSpec validation for the change.
