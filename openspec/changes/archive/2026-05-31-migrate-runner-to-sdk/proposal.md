## Why

当前 runner 层使用 CodeBuddy CLI 子进程（spawn + NDJSON stdout），每次 continuation 都是一个独立短命进程，session 通过 `--resume` 外部恢复。这导致：

1. **Token 开销高**：每次 resume 重载 50K+ tokens 上下文
2. **无法进程内多 turn**：不对齐 Symphony §16.5 的 worker 内 turn loop + tracker 检查语义
3. **子进程管理复杂**：spawn/readline/kill/timeout/stall 占 ~480 行代码
4. **实时事件有间隙**：进程间空窗期无法推送事件

CodeBuddy 已提供 `@tencent-ai/agent-sdk`（TypeScript，Preview 阶段），支持 in-process session + async iterator + canUseTool 回调。迁移后可完美对齐 Symphony 的 Codex App Server 语义，同时大幅简化代码和降低 token 成本。
sdk 参考 https://www.codebuddy.cn/docs/cli/sdk-typescript

## What Changes

- **替换** `runCodebuddyTurn()` 实现：从 `spawn` + NDJSON 解析改为 SDK `query()` async iterator
- **替换** `buildCodebuddyCommand()`：从拼 CLI 参数改为构造 SDK options 对象
- **新增** session 生命周期管理：per-issue session 创建/复用/关闭
- **新增** `canUseTool` 权限回调：可在 agent 执行工具前检查 tracker 状态
- **移除** subprocess timeout 管理（read/turn/stall timeout）：SDK 内部管理超时，或用 `maxTurns` 控制
- **新增** `@tencent-ai/agent-sdk` npm 依赖
- **移除** 对 `--resume` / `--session-id` / `--print` / `--output-format stream-json` CLI 参数的依赖

## Capabilities

### New Capabilities
- `sdk-session-management`: per-issue SDK session 的创建、复用、关闭生命周期，以及 canUseTool 权限回调

### Modified Capabilities
- `codebuddy-cli-integration`: runner 从 CLI 子进程模式切换为 SDK in-process 模式，事件映射从 NDJSON 解析改为 async iterator 消费

## Impact

- **代码**：`src/runner/` 全部重写（`run-codebuddy-turn.ts`、`build-codebuddy-command.ts`）；`src/runner/index.ts` 导出变更
- **依赖**：新增 `@tencent-ai/agent-sdk`（**AGENTS.md §1 技术栈需要更新**）
- **配置**：`codebuddy.command` 字段不再需要；新增 `codebuddy.model` / `codebuddy.settingSources` 等 SDK 配置项
- **PLAN.md 章节**：§10 Agent Runner Protocol（从 CLI subprocess 改为 SDK in-process）
- **测试**：`test/runner/` 需要重写（不再 spawn fake CLI 脚本，改为 mock SDK）
- **兼容性**：**BREAKING** — 移除 CLI 子进程路径，`worker.kind: ssh` 的 RemoteWorker 需要另行处理（SDK 不支持远端执行）
