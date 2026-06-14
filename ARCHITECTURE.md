# ARCHITECTURE.md

> 当前实现架构说明。历史路线图与契约演进记录见 [`PLAN.md`](./PLAN.md)，可执行规范以 [`openspec/specs/`](./openspec/specs/) 为准。

## 1. 定位

`codebuddy-auto` 是 OpenAI Symphony 调度语义的 TypeScript 参考实现。它不复刻 Symphony 的 Elixir/OTP 后端，而是在 Node.js 生态里完成同一类编排任务：

- 从 tracker 读取候选 issue
- 为每个 issue 准备隔离 workspace
- 用 CodeBuddy Agent SDK 或 SSH CLI fallback 驱动 agent 多轮执行
- 在 turn 边界做 handoff、retry、progress gate 与 cleanup
- 通过 status API、SSE 与 Dashboard 暴露运行态

当前主路径是 `worker.kind: local`：调度器在本进程内创建 CodeBuddy SDK session，并由长期运行的 per-issue worker 完成多轮 turn。`worker.kind: ssh` 是远端/CLI fallback，保留单轮 CLI subprocess + continuation cycle 的模型。

## 2. 组件边界

| 层 | 目录 | 职责 |
|---|---|---|
| CLI | `typescript/src/cli.ts`, `main.ts` | `init`、`check`、`daemon`、`status` 等命令入口 |
| workflow/config | `workflow/`, `config/` | 读取 `WORKFLOW.md`、解析 front matter、合并默认值、preflight、动态 reload |
| spec | `spec/` | 跨模块共享类型与 zod schema |
| tracker | `tracker/` | `CNBTracker` / `LocalTracker`，把外部 issue 归一化为内部 `Issue` |
| scheduler | `scheduler/` | tick 主循环、候选选择、reconcile、dispatch、retry、startup cleanup |
| worker | `worker/` | local 模式 per-issue SDK session 生命周期 |
| runner | `runner/` | SDK turn adapter 与 SSH/CLI fallback adapter |
| workspace | `workspace/` | issue workspace 映射、目录创建/复用/移除、git worktree、hooks |
| progress | `progress/` | workspace/tracker fingerprint 与 no-progress 判断 |
| transcript | `transcript/` | 本地 SQLite observability store，保存 agent 对话、Dashboard event history 与原始 SDK/CLI payload |
| logging/status | `logging/` | pino logger、runtime snapshot、HTTP API、SSE event bus |
| dashboard | `typescript/dashboard/` | React Dashboard，消费 bootstrap/state/events API |

依赖方向以 `scheduler` 为编排中心：tracker、workspace、runner、worker、logging 都不反向决定 issue 的调度生命周期。共享实体只放在 `spec/`。

## 3. 运行时主流程

启动 `daemon` 后，系统先载入 workflow/config，执行 preflight 和 startup cleanup，然后进入定时 tick。

```text
                    ┌──────────────────────┐
       SIGINT/TERM ─┤   start-scheduler    │
                    │  (per-process root)  │
                    └──────────┬───────────┘
                               | tick every polling.intervalMs
                               ▼
                    ┌──────────────────────┐
                    │  run-scheduler-once  │
                    └──┬─────────┬───────┬─┘
                       |         |       |
        ┌──────────────▼──┐  ┌───▼───┐  ┌▼──────────────────┐
        │ release-retry   │  │ recon-│  │  run-dispatch-    │
        │ (drop expired   │  │ cile  │  │  cycle            │
        │  retry entries) │  │       │  │                   │
        └─────────────────┘  └───┬───┘  └──┬──┬─────────────┘
                                 |         |  |
                  workerHandleStore ▼      |  | kind === 'local'?
                                           |  |
                                           |  └─► dispatch-local-issue
                                           |        | (background promise)
                                           |        ▼
                                           |    run-issue-worker
                                           |   (SDK session loop)
                                           |
                                           ▼ kind === 'ssh' only
                                    run-continuation-cycle
                                    (legacy per-turn CLI)
```

每个 tick 严格走五步：

1. **Release expired retry claims**：`state.retryAttempts` 中 `dueAtMs <= now` 且不在 `state.running` 的 entry 直接清除，让 issue 重回候选集。
2. **Reconcile running issues**：用 `tracker.fetchIssueStatesByIds(running)` 拉一批 tracker state，`reconcile-runtime-state` 处理结果：
   - SSH 模式 / 没有 `WorkerHandle` 的条目：直接从 `state.running` 删除 + 标 `state.completed`，必要时清理 workspace。
   - local 模式有活 worker 的条目：不删 `state.running`，改为 `workerHandleStore.requestGracefulExit(issueId) = true`。Worker 在下一个 turn 边界自查并退出，避免半截工具调用留下脏状态。
3. **Reconcile stuck issues**：对不在 running 中的 stuck issue 重新读取 tracker state；如果出现 finish label、离开 active state、进入 terminal state，或 tracker 不再返回，则释放本进程内的 stuck/progress bookkeeping。
4. **Continuation cycle**：仅在 `worker.kind === 'ssh'` 调用 `run-continuation-cycle`。local 模式不走这条路：worker 自己在内部跑多轮。
5. **Dispatch cycle**：调用 `run-dispatch-cycle`：先用 `plan-dispatch-cycle` 算 `availableSlots = maxConcurrentAgents - |running|`，按候选 issue 排序后，根据 `worker.kind` 分流：
   - `local`：`dispatch-local-issue(issue, ...)`，异步启动，不 await。
   - `ssh`：旧路径，单轮 `runCodebuddyTurn` + 写入 `state.running` + 创建 retry entry。

### 3.1 Local Worker 生命周期

`dispatch-local-issue` 把 issue 准备好后启动一个背景 Promise，scheduler tick 马上返回：

```text
dispatch-local-issue(issue)
  ├─ createRunAttempt → 工作目录 + 空 RunningEntry
  ├─ before_run hook  → 失败则 schedule retry
  ├─ state.running[id] = runningEntry      // 让后续 tick 不再选这个 issue
  ├─ state.claimed.add(id)
  ├─ eventBus.emit('dispatch_started')
  └─ ┌─ runIssueWorker(...) (background)
     │     │
     │     │ loop while turnCount < liveConfig.agent.maxTurns:
     │     │   ┌─ 顶部检查 handle.gracefulExitRequested → 退
     │     │   ├─ message = turn 1 ? initialPrompt+suffix : continuationGuidance
     │     │   ├─ session.send(message)
     │     │   ├─ for await m of session.stream():
     │     │   │     - system_init → emit session_started
     │     │   │     - result      → handle.turnCount++; emit turn_completed
     │     │   ├─ tracker.fetchIssueStatesByIds([id])
     │     │   │     - finish_label 出现 → exitReason=finish_label_observed
     │     │   │     - state 不再 active → exitReason=issue_inactive
     │     │   ├─ record progress fingerprint
     │     │   │     - repeated >= no_progress_threshold → exitReason=stuck_no_progress
     │     │   └─ 否则继续下一轮
     │     │
     │     │ 退出后:
     │     │   max_turns_reached → state.stuck[id] = max_turns_reached
     │     │
     │     └─ finally: session.close(); handleStore.release(id)
     │
     └─ 外层 IIFE finally:
          - delete state.running[id]
          - 根据 exitReason 分类:
              terminal*  → drop claimed + add completed
              stuck*     → drop claimed + state.stuck[id]
              retryable* → drop claimed only (下一 tick 可重试)
              aborted    → 不动 (SIGINT 时为重启留干净状态)
          - run after_run hook
```

`* terminal = finish_label_observed | issue_inactive | graceful_exit_requested`
`* stuck = max_turns_reached | stuck_no_progress`
`* retryable = turn_failed | turn_timed_out | startup_failed`

`runIssueWorker` 持有一个 SDK session，在每个 turn 后重新读取 tracker，并根据 finish label、issue state、graceful exit、max turns、progress fingerprint 决定是否继续。

`agent.max_turns` 只限制外层 worker session 内启动/消费的 coding-agent turn 数；不会作为 CodeBuddy SDK/CLI 的内部 `maxTurns` / `--max-turns` 传下去。底层 CodeBuddy 单次执行预算由 `codebuddy.sdk_max_turns` 单独控制，默认值为 `100`。

## 4. Worker 模式

| 模式 | 入口 | Agent 执行 | continuation |
|---|---|---|---|
| `local` | `dispatchLocalIssue` + `runIssueWorker` | `@tencent-ai/agent-sdk` in-process session | worker 内部多轮循环 |
| `ssh` | `runDispatchCycle` / `runContinuationCycle` | SSH 中执行 CodeBuddy CLI fallback | scheduler 每 tick 单独续跑 |

local 是默认和优先路径。SSH 模式用于远端执行环境，仍复用同一套 tracker、workspace、runtime state、status API。

## 5. Issue 生命周期

对齐 Symphony agent-driven 完成信号，用标签模拟 Linear 工作流：

```text
open + agent-ready  →  处理中  →  open + agent-finish  →  closed
     (Todo)         (In Progress)      (In Review)        (Done)
```

1. 人工贴 `agent-ready` → 成为候选
2. Scheduler dispatch → 创建 workspace → agent 执行
3. Agent 修复 → 验证 → commit/push → `cnb issues add-labels --labels agent-finish`
4. Scheduler 检测到 `agent-finish` → 停止 continuation 并 release
5. 人工审核合并 → 关闭 issue → reconciliation 清理 workspace

安全边界：每次 continuation 前检查标签；`agent-finish` 只由 agent 在完成验证、commit/push、handoff 准备后主动添加。达到 `maxTurns` 不会自动贴 `agent-finish`，而是记录为 stuck，等待人工处理或 tracker 状态变化。

progress gate 是额外保护层：在 turn 边界计算 workspace/tracker fingerprint，连续 `agent.no_progress_threshold` 次无变化后暂停自动续跑。它不运行目标仓库验证命令，也不写 tracker label。

```yaml
# WORKFLOW.md front matter
tracker:
  candidate_label: agent-ready
  exclude_label: skip-agent
  finish_label: agent-finish

agent:
  max_turns: 30
  no_progress_threshold: 3

codebuddy:
  # CodeBuddy SDK/CLI internal turn budget.
  sdk_max_turns: 100
```

`no_progress_threshold` 表示连续多少次 turn 边界的 progress fingerprint 没变化后，当前进程把 issue 标为 `stuck: no_progress` 并停止自动续跑。默认值是 `3`。它不代表失败验证，也不会写 tracker label。

stuck issue 的处理方式：

1. Dashboard / `codebuddy-auto status` 会显示 stuck reason。
2. Scheduler 不再自动 dispatch / continue 这个 issue。
3. 如果 tracker 后续出现 `agent-finish`、issue 离开 active state、进入 terminal state，或 tracker 不再返回该 issue，reconciliation 会按正常 handoff/release 规则释放它。

## 6. Runtime State

| 字段 | 谁写 | 谁读 | 作用 |
|---|---|---|---|
| `state.running[id]` | dispatch + worker callbacks | plan-dispatch / dashboard / reconcile | 这个 issue 被当前进程占着 |
| `state.claimed` | dispatch + worker exit | select-dispatch-candidates | 防止 race window 期内重复派发 |
| `state.completed` | worker exit / reconcile | dashboard | 信息性，不参与调度 |
| `state.runners[id]` (= WorkerHandle) | worker 入口 register | reconcile / worker turn 顶部 | 协作式 graceful-exit 开关 |
| `state.retryAttempts[id]` | dispatch failure / SSH continuation | run-scheduler-once / continuation cycle | SSH 路径专用；local 路径不写 |
| `state.progress[id]` | worker / SSH continuation turn 边界 | dashboard / status | workspace + tracker 指纹，供 no-progress 判断 |
| `state.stuck[id]` | worker / continuation / maxTurns | scheduler / dashboard / status | 本进程内暂停自动续跑，直到 tracker handoff 或 inactive release |

tracker 是外部 truth source，runtime state 是本进程调度账本。进程重启后的恢复依赖 tracker 状态和 workspace 文件系统，而不是恢复一个精确的内存 session。

### 6.1 Transcript Store

Transcript store 是一个持久化观测面，不是 scheduler runtime state 的恢复机制。它包含两类 durable 数据：完整 agent transcript，以及 Dashboard Events 面板使用的 event history。

```text
WORKFLOW.md
  transcript.enabled / sqlite_path
        │
        ▼
createWorkflowRuntimeSource
  ├─ enabled  → openSqliteTranscriptStore(.codebuddy-auto/transcripts.sqlite)
  └─ disabled → createDisabledTranscriptStore()
        │
        ▼
runner / worker append transcript events
        │
        ▼
status API / Dashboard Transcript view

eventBus.emit(issue/scheduler/state events)
        │
        ▼
dashboard_events table
        │
        ▼
status API / Dashboard Events history
```

它保存：

- user prompt：首轮 task prompt 与 continuation prompt
- assistant message：SDK / CLI stream 中提取到的文本
- runtime/result/error：session_started、turn_completed、turn_failed、timeout、stderr、malformed line
- raw payload：SDK message 或 CLI stream-json 的原始 JSON 载荷
- Dashboard event history：issue_event、scheduler_event、state_snapshot 的 id、timestamp、issueId 与 payload

它不保存、也不恢复：

- `state.running` / `state.claimed` / `state.retryAttempts`
- live SDK session object
- worker handle / graceful-exit channel
- progress gate 的调度决策

因此进程重启后，调度仍以 tracker state + workspace 为准重新判断候选；SQLite 只用于事后查看完整对话过程和 Dashboard event history。transcript 写入失败会让当前 agent turn 明确失败，避免 Dashboard 显示“成功”但缺失关键对话记录；Dashboard event 写入失败不会中断调度或 SSE live delivery。

## 7. Symphony SPEC 对位

| 章节 | 实现 |
|---|---|
| §7.1 worker re-checks tracker each turn | `runIssueWorker` 每个 result 后 `fetchIssueStatesByIds` |
| §7.3 worker exit + 1s continuation retry | local: 单 worker 跑完整生命周期，无 1s 续跑；SSH: 走 `runContinuationCycle` |
| §10.3 app-server alive across turns | local: 一次 `unstable_v2_createSession` 串 N 轮；SSH: 每轮新 CLI 子进程 + `--resume` |
| §13.5 absolute token totals → delta | `dispatch-local-issue.onTurnComplete` 用 `lastReportedTotals` 算 delta |

## 8. API 与 Dashboard

status server 提供两类接口：

- Dashboard bootstrap：`GET /api/v1/dashboard/bootstrap`
- 运行态与控制：`GET /api/v1/state`、`GET /api/v1/events`、`GET /api/v1/<issue>`、`POST /api/v1/refresh`
- Dashboard event history：`GET /api/v1/events/history?issueId=<id>&after=<eventId>&limit=<n>`
- Transcript：`GET /api/v1/issues/<issueId>/transcript?after=<id>&limit=<n>`

Dashboard 是观察面，不参与调度决策。SSE event bus 透出 dispatch、session、turn、progress、stuck 等 live events，并把 Dashboard event history 追加到 SQLite。Events view 初始读取持久化 history 后继续接 SSE；Transcript view 读取 SQLite 中的完整对话事件。两者并列展示：Events 用于实时排障和短期运行轨迹，Transcript 用于查看完整对话历史。

## 9. 文档分工

| 文档 | 用途 |
|---|---|
| `README.md` | 项目定位、安装、快速开始、常用入口 |
| `ARCHITECTURE.md` | 当前实现架构和运行模型 |
| `PLAN.md` | 历史路线图、契约演进、旧决策背景 |
| `openspec/specs/` | 当前可执行能力规范 |
| `docs/references/` | 上游/平台调研材料与 spike 结论 |

不要把新的实现细节继续堆到 README。行为变更先走 OpenSpec；架构说明更新到本文；历史背景才进入 PLAN。
