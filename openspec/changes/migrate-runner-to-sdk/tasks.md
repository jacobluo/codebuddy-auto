## 1. 依赖与配置基础

- [ ] 1.1 安装 `@tencent-ai/agent-sdk` 依赖并更新 `package.json`
- [ ] 1.2 更新 `AGENTS.md` §1 技术栈，登记新依赖及理由
- [ ] 1.3 更新 `ServiceConfig` 中 `codebuddy` 分组：新增 `model` / `settingSources` 字段，标记 `command` 为 CLI-only

## 2. SDK Runner 核心实现

- [ ] 2.1 新建 `src/runner/run-codebuddy-turn-sdk.ts`：实现基于 SDK `query()` 的单轮执行，返回现有 `RunCodebuddyTurnResult` 结构
- [ ] 2.2 实现 SDK message → `CodebuddyRunnerEvent` 映射函数（system→session_started, assistant→notification, result→turn_completed/failed）
- [ ] 2.3 集成 `onEvent` callback：每条 SDK message 映射后立即调用
- [ ] 2.4 实现 wall-clock timeout：用 `Promise.race` + `AbortController` 对 query 施加 `turnTimeoutMs` 上限
- [ ] 2.5 实现 `canUseTool` 回调：记录 tool call 到 EventBus，默认 return true

## 3. Session 生命周期管理

- [ ] 3.1 新建 `src/runner/session-store.ts`：per-issue session Map（create / get / destroy）
- [ ] 3.2 dispatch 时创建 session（首轮 prompt），存入 store
- [ ] 3.3 continuation 时复用 session（调用 `session.query` 而非新建）
- [ ] 3.4 issue release 时销毁 session（从 store 移除）

## 4. 双模 Runner 路由

- [ ] 4.1 重构 `src/runner/index.ts`：根据 `config.worker.kind` 路由到 SDK 或 CLI 实现
- [ ] 4.2 保留 `run-codebuddy-turn.ts` 作为 CLI fallback（重命名为 `run-codebuddy-turn-cli.ts`）
- [ ] 4.3 统一导出接口：外部调用者无感知内部走 SDK 还是 CLI

## 5. Scheduler 适配

- [ ] 5.1 `runDispatchCycle` 在首轮 dispatch 时通过 session store 创建 session
- [ ] 5.2 `runContinuationCycle` 复用已有 session（不再构造 `--resume` 命令）
- [ ] 5.3 reconciliation release 时调用 session store 销毁 session
- [ ] 5.4 保持 eventBus 集成不变（onEvent 透传）

## 6. 测试

- [ ] 6.1 为 SDK runner 编写单元测试（mock SDK query，验证事件映射、timeout、canUseTool）
- [ ] 6.2 为 session store 编写单元测试（create/get/destroy 生命周期）
- [ ] 6.3 确保现有 CLI 路径测试仍通过（SSH fallback）
- [ ] 6.4 全量 `pnpm check` + `pnpm test` 通过

## 7. 文档与验收

- [ ] 7.1 更新 `WORKFLOW.example.md` 示例配置（移除 CLI-only 字段，展示 SDK 配置）
- [ ] 7.2 更新 `README.md` 前置依赖说明
- [ ] 7.3 端到端手动验证：本地 daemon 用 SDK 模式处理真实 issue
