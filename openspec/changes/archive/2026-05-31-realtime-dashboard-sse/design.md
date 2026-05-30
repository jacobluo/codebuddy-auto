## Context

当前 Dashboard（`src/logging/http-status-server.ts`）通过内联 HTML + JS 实现，前端每 5 秒轮询 `/api/v1/state`。runner 的事件（`CodebuddyRunnerEvent`）只在 `runCodebuddyTurn()` 结束时批量返回，运行期间外部无法观测 agent 活动。

SPEC §13 定义了 observability 层不得反向影响 orchestration 主流程——本设计严格遵守此约束。

## Goals / Non-Goals

**Goals:**
- Agent NDJSON 事件实时可观测（session_started / notification / turn_completed 等）
- Scheduler 调度事件实时可观测（dispatch / continuation / release / tick）
- 每个 issue 有独立的事件流视图
- 断线重连后能回放最近事件
- 零新 npm 依赖

**Non-Goals:**
- 不持久化事件到磁盘（纯内存，重启清空）
- 不提供 WebSocket（SSE 足够，且零依赖）
- 不改变 runner 的返回值结构（onEvent 是增量 callback，不替代 batch result）
- 不改变 scheduler 主循环逻辑（EventBus 是只写/只读旁路）
- 不做事件回放分页 API（只做 SSE 重连回放）

## Decisions

### D1：传输选择 SSE 而非 WebSocket

| | SSE | WebSocket |
|---|---|---|
| 需求匹配 | 单向推送 ✅ | 双向（过度） |
| 浏览器 | 原生 EventSource + 自动重连 | 手动管理 |
| Node 实现 | `res.write('data:...\n\n')` | 需要 `ws` 包 |
| 依赖 | **零** | +1 npm dep |

决定：**用 SSE**。

### D2：EventBus 定位为 logging 层组件

```
src/logging/event-bus.ts   ← 新文件
```

EventBus 不属于 scheduler/runner，而是 observability 层。它：
- 被 runner 和 scheduler 写入（emit）
- 被 HTTP server 读取（subscribe）
- 故障时不影响主流程（emit 内部 try/catch 兜底）

### D3：Runner onEvent callback 设计

```typescript
// run-codebuddy-turn.ts 签名扩展
export interface RunCodebuddyTurnInput {
  command: CodebuddyCommand;
  readTimeoutMs?: number;
  turnTimeoutMs?: number;
  stallTimeoutMs?: number;
  onEvent?: (event: CodebuddyRunnerEvent) => void;  // 新增
}
```

- 每行 NDJSON 解析后同时 `events.push(event)` 和 `onEvent?.(event)`
- onEvent 是 fire-and-forget，不 await
- onEvent 抛错不影响 runner 主路径

### D4：SSE endpoint 设计

```
GET /api/v1/events              → 全局事件流
GET /api/v1/events?issueId=3    → 单 issue 事件流
```

协议：
```
id: <monotonic-counter>
event: issue_event | scheduler_event | state_snapshot
data: {"issueId":"3","event":"notification","payload":{...},"timestamp":"..."}

```

客户端重连时带 `Last-Event-ID: <last-seen-id>`，服务端回放 history 中 id > last-seen 的事件。

### D5：内存限制

| 维度 | 限制 |
|---|---|
| Per-issue 事件 | 最近 200 条 |
| 全局事件 | 最近 1000 条 |
| SSE 连接数 | 无硬限制（但 Node single-thread 自然限制） |

### D6：Dashboard 前端重写

```
┌───────────────────┬──────────────────────────────┐
│  Issue List       │  Issue Detail                │
│                   │                              │
│  ● #3 代码规范    │  Status: running turn 8/20   │
│    turn 8 · 52s   │  Session: 3-turn-1           │
│                   │                              │
│  ○ #4 登录 bug    │  ── Live Events ──           │
│    retry #2       │  09:15:32 session_started    │
│                   │  09:15:38 notification:...   │
│                   │  09:16:02 turn_completed     │
│                   │  ...                         │
└───────────────────┴──────────────────────────────┘
```

- 左侧列表：从 state_snapshot 事件自动更新
- 右侧面板：订阅 `?issueId=<selected>` 的 SSE 流
- 选中 issue 时切换 EventSource 连接

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| EventBus 内存泄漏 | Ring buffer 固定上限，超出丢弃最旧事件 |
| onEvent callback 阻塞 runner | callback 内部 try/catch + 同步执行（不 await），且 EventBus.emit 本身同步 |
| 大量 SSE 连接拖慢主线程 | 生产环境通常只有 1-2 个 Dashboard 页面；如极端场景可加连接数 cap |
| 重连回放时事件已被淘汰 | 客户端发现 gap 时 fallback 到 `/api/v1/state` 全量刷新 |
| Dashboard 前端 JS 体积增大 | 仍内联单文件 HTML，不引入构建工具；代码量可控 (~200 行 JS) |
