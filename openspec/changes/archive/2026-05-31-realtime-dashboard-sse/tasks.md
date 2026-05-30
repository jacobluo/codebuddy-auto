## 1. EventBus 核心

- [x] 1.1 创建 `src/logging/event-bus.ts`：DashboardEvent 类型定义 + EventBus 实现（emit / subscribe / history + ring buffer 淘汰）
- [x] 1.2 为 EventBus 编写单元测试（emit / subscribe / unsubscribe / history 边界 / callback 异常兜底）
- [x] 1.3 在 `src/logging/index.ts` barrel 中导出 EventBus

## 2. Runner onEvent callback

- [x] 2.1 扩展 `RunCodebuddyTurnInput` 接口添加 `onEvent?: (event: CodebuddyRunnerEvent) => void`
- [x] 2.2 在 `stdoutReader.on('line')` 中解析事件后调用 `onEvent?.(event)`（try/catch 包裹）
- [x] 2.3 添加测试：onEvent 被逐行调用、onEvent 异常不中断 runner

## 3. Scheduler 集成 EventBus

- [x] 3.1 `startScheduler` 接受可选 `eventBus` 参数并透传到 `runSchedulerOnce`
- [x] 3.2 `runDispatchCycle` 接受 eventBus，在 dispatch 前后 emit `scheduler_event`，并把 `onEvent` 传给 runner
- [x] 3.3 `runContinuationCycle` 接受 eventBus，在 continuation 前后 emit `scheduler_event`，并把 `onEvent` 传给 runner
- [x] 3.4 在每次 tick 完成后 emit `state_snapshot` 事件
- [x] 3.5 确保现有测试仍通过（eventBus 可选，不传时行为不变）

## 4. SSE endpoint

- [x] 4.1 在 `http-status-server.ts` 中实现 `GET /api/v1/events` handler：设置 SSE headers、subscribe EventBus、格式化输出
- [x] 4.2 支持 `?issueId=<id>` 过滤（subscriber 内部 filter）
- [x] 4.3 支持 `Last-Event-ID` 请求头：从 history 回放 > lastId 的事件
- [x] 4.4 实现 15s keepalive comment（`:keepalive\n\n`）
- [x] 4.5 处理客户端断开：`res.on('close')` 时 unsubscribe
- [x] 4.6 添加集成测试：连接 SSE、接收事件、断线重连回放

## 5. Dashboard 前端重写

- [x] 5.1 重写 `renderDashboardHtml()`：左右分栏布局（issue list + live detail）
- [x] 5.2 左侧 panel：从 `state_snapshot` 事件自动更新 running/retrying 列表
- [x] 5.3 右侧 panel：选中 issue 后创建 `EventSource('/api/v1/events?issueId=X')` 展示实时事件流
- [x] 5.4 事件流渲染：时间戳 + 事件类型 + payload 摘要，自动滚动到底部
- [x] 5.5 issue 切换时关闭旧 EventSource 并创建新连接

## 6. CLI 接入与验收

- [x] 6.1 `cli.ts` 中创建 EventBus 实例并注入 scheduler 和 status server
- [x] 6.2 端到端手动验证：启动 daemon、Dashboard 实时看到 agent 事件流
- [x] 6.3 确保全量测试通过 + 类型检查通过
