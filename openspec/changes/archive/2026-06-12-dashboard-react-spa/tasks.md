## 1. Frontend toolchain scaffold

- [x] 1.1 Add React + Vite + frontend test dependencies and package scripts in `typescript/package.json`
- [x] 1.2 Create the dashboard frontend source structure, Vite config, and production build output wiring for status-server hosting

## 2. Status server contract migration

- [x] 2.1 Add or update server-side tests covering `GET /`, static asset hosting, `GET /api/v1/dashboard/bootstrap`, and the updated SSE event envelope
- [x] 2.2 Implement static asset serving, SPA shell delivery at `GET /`, and the new bootstrap API in `http-status-server`
- [x] 2.3 Update SSE serialization to emit the stable SPA-facing event envelope while preserving global and issue-scoped streams

## 3. Dashboard data layer

- [x] 3.1 Add frontend tests for bootstrap loading, connection-state transitions, refresh behavior, and issue selection state
- [x] 3.2 Implement the dashboard API client, SSE client, and page-level state hooks for snapshot/event consumption

## 4. Dashboard UI

- [x] 4.1 Add component tests covering header, config strip, metric grid, issue sidebar, live events panel, and empty/error states
- [x] 4.2 Implement the Dashboard SPA components and page composition to match the finalized web UI design
- [x] 4.3 Wire refresh action, issue drill-down, and live event rendering into the React page flow

## 5. Documentation and verification

- [x] 5.1 Update README and related dashboard docs for the new SPA build/run model and bootstrap endpoint
- [x] 5.2 Run build and test verification for both the TypeScript backend and the Dashboard frontend, and fix any regressions
