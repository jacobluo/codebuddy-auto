## Context

当前 `src/runner/` 基于 `child_process.spawn` 拉起 CodeBuddy CLI，通过 `readline` 逐行消费 NDJSON stdout。每次 dispatch/continuation 都是独立子进程，session 靠 `--resume` flag 恢复。

CodeBuddy Agent SDK (`@tencent-ai/agent-sdk`) 提供 in-process TypeScript API：
- `query()`: 单次查询，返回 async iterator
- `unstable_v2_createSession()`: 多轮对话，session 在内存中保持
- `canUseTool`: 每次工具调用前的权限回调
- Hook 系统：PreToolUse / PostToolUse / SessionStart / SessionEnd

SDK 当前为 Preview 阶段（v0.1.0+），API 可能变化。

## Goals / Non-Goals

**Goals:**
- Runner 从子进程改为 SDK in-process 调用
- Per-issue session 创建一次，多 turn 复用（对齐 Symphony worker 内 turn loop）
- 事件通过 async iterator 实时 emit 到 EventBus
- 通过 `canUseTool` 实现 tracker 状态感知（agent 执行破坏性操作前检查 issue 是否仍 active）
- 保持 scheduler / workspace / logging / config 层不变
- 保持 EventBus + SSE Dashboard 不变

**Non-Goals:**
- 不迁移 RemoteWorker（SSH 模式仍需 CLI subprocess，保留为 fallback）
- 不在 SDK 层实现 `cnb_api` 工具注册（后续单独做）
- 不依赖 SDK 的 MCP/SubAgent 能力（当前不需要）
- 不改变 `ServiceConfig` 的整体结构（只调整 `codebuddy.*` 字段）

## Decisions

### D1：SDK session 生命周期 = issue 生命周期

```
dispatch(issue)
  └─ session = createSession({ cwd: workspacePath, ... })
  └─ turn 1: session.query(prompt)
  └─ check tracker → still active
  └─ turn 2: session.query(continuation)
  └─ ...
  └─ maxTurns 或 issue 不再 active → session 销毁
```

Session 存储在 `RunningEntry` 中（或独立 Map），随 issue release 一起清理。

### D2：双模 runner（SDK + CLI fallback）

```typescript
// config 决定走哪条路
if (config.worker.kind === 'ssh') {
  // 远端执行仍用 CLI subprocess
  return runCodebuddyTurnCli(input);
} else {
  // 本地执行用 SDK
  return runCodebuddyTurnSdk(input);
}
```

保留 CLI 路径作为 RemoteWorker 的 fallback，不做 breaking change for SSH 用户。

### D3：事件映射

| SDK message.type | 映射到 CodebuddyRunnerEvent |
|---|---|
| `system` (初始化) | `session_started` |
| `assistant` (文本/工具调用) | `notification` |
| `result` (查询完成) | `turn_completed` / `turn_failed` |
| `result` + is_error | `turn_failed` |

映射层保持现有 `CodebuddyRunnerEvent` 类型不变，下游 scheduler / EventBus / Dashboard 无感知。

### D4：canUseTool 集成策略

初期仅做日志记录，不阻断：
```typescript
canUseTool: (tool) => {
  eventBus?.emit({ type: 'issue_event', issueId, payload: { event: 'tool_call', tool: tool.name } });
  return true; // 后续可扩展为 tracker 检查
}
```

后续可升级为：push/exec 等危险操作前检查 tracker 状态，若 issue 已关则拒绝。

### D5：超时策略

SDK 通过 `maxTurns` 控制执行范围。外层 scheduler 保留 wall-clock timeout：
- 如果 SDK query 超过 `turnTimeoutMs` 没返回 → abort session
- 用 `AbortController` 或 `Promise.race` 实现

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| SDK 是 Preview，API 可能变 | 封装在 runner 层内部，变 API 只改一个文件 |
| 同进程无隔离，SDK bug 可能打挂 scheduler | 高信任本地环境可接受；SSH 模式保留进程隔离 |
| Session 内存占用 | 一个 session ≈ 一个 issue；`max_concurrent_agents` 限制上限 |
| `unstable_v2_createSession` 可能被移除 | 有 fallback 到 `query()` 单次调用（退化为类似 CLI 行为） |
| 新增 npm 依赖 | AGENTS.md 要更新技术栈说明 |
