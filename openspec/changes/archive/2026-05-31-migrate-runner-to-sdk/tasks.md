## 1. 依赖与配置基础

- [x] 1.1 安装 `@tencent-ai/agent-sdk` 依赖并更新 `package.json`
- [x] 1.2 更新 `AGENTS.md` §1 技术栈，登记新依赖及理由
- [x] 1.3 更新 `ServiceConfig` 中 `codebuddy` 分组：新增 `model` / `settingSources` 字段，标记 `command` 为 CLI-only

## 2. SDK Runner 核心实现

- [x] 2.1 新建 `src/runner/run-codebuddy-turn-sdk.ts`：实现基于 SDK `query()` 的单轮执行
- [x] 2.2 实现 SDK message → `CodebuddyRunnerEvent` 映射函数
- [x] 2.3 集成 `onEvent` callback：每条 SDK message 映射后立即调用
- [x] 2.4 实现 wall-clock timeout：用 AbortController 对 query 施加 turnTimeoutMs 上限
- [x] 2.5 实现 `canUseTool` 回调：记录 tool call 到 EventBus，默认 return true

## 3. Session 生命周期管理

- [x] 3.1 新建 `src/runner/session-store.ts`（in-memory `SdkSessionStore`，提供 create/get/recordTurn/destroy/list/size/clear）
- [x] 3.2 dispatch 时创建 session，存入 store（`runDispatchCycle` 在首轮成功后 `store.create(issueId, sessionId)`）
- [x] 3.3 continuation 时复用 session（`runContinuationCycle` 每轮成功后 `store.recordTurn`，token 沿用 `runningEntry.sessionId` 经由 SDK `resume`）
- [x] 3.4 issue release 时销毁 session（continuation tracker 检测 inactive / finish 标签 / maxTurns，以及 reconcile 终态都调 `store.destroy`）

## 4. 双模 Runner 路由

- [x] 4.1 重构 runner：根据 `config.worker.kind` 路由到 SDK 或 CLI 实现
- [x] 4.2 保留 CLI fallback（重命名为 `run-codebuddy-turn-cli.ts`）
- [x] 4.3 统一导出接口

## 5. Scheduler 适配

- [x] 5.1 `runDispatchCycle` 传入 config/prompt/workspacePath/issueId
- [x] 5.2 `runContinuationCycle` 传入 config/prompt/workspacePath/issueId/resumeSessionId
- [x] 5.3 reconciliation release 时销毁 session（`reconcileRuntimeState` 接受可选 `SdkSessionStore`，对 terminal/未知 issue 一并 destroy）
- [x] 5.4 保持 eventBus 集成不变

## 6. 测试

- [x] 6.1 为 SDK runner 编写单元测试（`test/runner/session-store.test.ts` 6 测，`test/runner/run-codebuddy-turn-sdk.test.ts` 10 测，使用 `vi.mock('@tencent-ai/agent-sdk')` 注入受控 async iterator）
- [x] 6.3 确保现有 CLI 路径测试仍通过
- [x] 6.4 全量 pnpm check + pnpm test 通过（continuation/dispatch cycle tests 已迁移到 SDK mock 模式，194/194 通过）

## 7. 文档与验收

- [x] 7.1 更新 AGENTS.md 技术栈
- [x] 7.2 更新 README.md 前置依赖说明
- [x] 7.3 端到端手动验证（SDK 模式 20 轮 continuation 成功，774K tok / 133s vs CLI 24M / 1013s）
