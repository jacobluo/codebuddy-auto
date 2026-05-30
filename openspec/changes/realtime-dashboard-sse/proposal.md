## Why

当前 Dashboard 通过 5 秒轮询 `/api/v1/state` 获取状态，无法看到 agent 在每个 issue 内部的实时活动（如正在读代码、正在修改文件等）。用户需要一个实时事件流来观察 agent 的工作细节，而不仅是最终结果。

Symphony SPEC §13.7 定义了 OPTIONAL HTTP 观测面，但未规定推送机制。本提案在现有 HTTP status API 基础上增加 SSE（Server-Sent Events）实时推送，使 Dashboard 能展示每个 issue 的 agent 事件流。

## What Changes

- 新增 `EventBus` 组件：内存事件总线，接收来自 runner 和 scheduler 的实时事件，分发给 SSE 连接
- 改造 `runCodebuddyTurn()`：增加 `onEvent` callback，每解析一行 NDJSON 即实时 emit（不再只批量返回）
- 改造 `runDispatchCycle` 和 `runContinuationCycle`：传入 onEvent callback，同时 emit 调度层事件（dispatch_started / continuation_scheduled / issue_released）
- 新增 SSE endpoint `GET /api/v1/events`：支持可选 `?issueId=<id>` 过滤，支持 `Last-Event-ID` 断线重连回放
- 重写 Dashboard HTML：左侧 issue 列表 + 右侧 issue live detail 面板，基于 `EventSource` 实时更新
- EventBus 保留 per-issue 最近 200 条事件，全局最近 1000 条，用于重连回放

## Capabilities

### New Capabilities
- `realtime-event-bus`: 内存事件总线，支持 emit / subscribe / history，为实时推送提供数据源
- `sse-event-stream`: SSE endpoint + 客户端协议，支持全局和 per-issue 事件订阅与断线回放

### Modified Capabilities
- `codebuddy-cli-integration`: runner 增加 onEvent streaming callback（原有批量返回行为保持兼容）

## Impact

- **代码**：`src/logging/event-bus.ts`（新增）、`src/runner/run-codebuddy-turn.ts`、`src/scheduler/run-dispatch-cycle.ts`、`src/scheduler/run-continuation-cycle.ts`、`src/logging/http-status-server.ts`
- **API**：新增 `GET /api/v1/events` SSE endpoint
- **依赖**：无新 npm 依赖（SSE 用原生 HTTP response `text/event-stream`）
- **PLAN.md 章节**：§13 Logging / Status / Observability（扩展 HTTP 观测面）、§10 Agent Runner Protocol（onEvent callback 扩展）
- **Dashboard**：`GET /` 完全重写前端，从轮询改为 SSE 实时
