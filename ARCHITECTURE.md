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
| logging/status | `logging/` | pino logger、runtime snapshot、HTTP API、SSE event bus |
| dashboard | `typescript/dashboard/` | React Dashboard，消费 bootstrap/state/events API |

依赖方向以 `scheduler` 为编排中心：tracker、workspace、runner、worker、logging 都不反向决定 issue 的调度生命周期。共享实体只放在 `spec/`。

## 3. 运行时主流程

启动 `daemon` 后，系统先载入 workflow/config，执行 preflight 和 startup cleanup，然后进入定时 tick。每个 tick 的核心顺序是：

1. 释放已到期且不在运行中的 retry entry。
2. Reconcile running issue：重新读取 tracker 状态，必要时清理运行态或请求 local worker graceful exit。
3. Reconcile stuck issue：如果 tracker 已 handoff、inactive、terminal 或不再返回该 issue，则释放本进程内 stuck/progress 记录。
4. SSH 模式运行 continuation cycle；local 模式跳过，因为 worker 自己持有 SDK session 并连续跑多轮。
5. Dispatch cycle：按并发上限和候选排序派发 issue。

local 模式 dispatch 后不会等待 worker 完成，而是启动背景 Promise：

```text
run-scheduler-once
  -> run-dispatch-cycle
    -> dispatch-local-issue
      -> createRunAttempt
      -> before_run hook
      -> state.running[id] = runningEntry
      -> runIssueWorker(...) in background
```

`runIssueWorker` 持有一个 SDK session，在每个 turn 后重新读取 tracker，并根据 finish label、issue state、graceful exit、max turns、progress fingerprint 决定是否继续。

## 4. Worker 模式

| 模式 | 入口 | Agent 执行 | continuation |
|---|---|---|---|
| `local` | `dispatchLocalIssue` + `runIssueWorker` | `@tencent-ai/agent-sdk` in-process session | worker 内部多轮循环 |
| `ssh` | `runDispatchCycle` / `runContinuationCycle` | SSH 中执行 CodeBuddy CLI fallback | scheduler 每 tick 单独续跑 |

local 是默认和优先路径。SSH 模式用于远端执行环境，仍复用同一套 tracker、workspace、runtime state、status API。

## 5. Issue 生命周期

默认 CNB 标签模型：

```text
open + agent-ready -> running -> open + agent-finish -> reviewed/closed
```

`agent-ready` 是候选标签，`skip-agent` 排除候选，`agent-finish` 是 agent-driven handoff 信号。达到 `agent.max_turns` 不会自动贴 `agent-finish`；系统会把 issue 标记为本进程内 `stuck: max_turns_reached`，等待人工处理或 tracker 状态变化。

progress gate 是额外保护层：在 turn 边界计算 workspace/tracker fingerprint，连续 `agent.no_progress_threshold` 次无变化后暂停自动续跑。它不运行目标仓库验证命令，也不写 tracker label。

## 6. Runtime State

| 字段 | 含义 |
|---|---|
| `running` | 当前进程正在处理的 issue |
| `claimed` | 当前进程已占有的 issue，覆盖 running 与等待 retry 的窗口 |
| `retryAttempts` | SSH continuation 或失败重试的到期时间与错误摘要 |
| `completed` | 当前进程观察到已完成 handoff/release 的 issue |
| `progress` | 最近一次 progress fingerprint |
| `stuck` | 本进程内暂停自动续跑的 issue 与原因 |
| `runners` | local 模式 worker handle，用于 graceful exit |

tracker 是外部 truth source，runtime state 是本进程调度账本。进程重启后的恢复依赖 tracker 状态和 workspace 文件系统，而不是恢复一个精确的内存 session。

## 7. API 与 Dashboard

status server 提供两类接口：

- Dashboard bootstrap：`GET /api/v1/dashboard/bootstrap`
- 运行态与控制：`GET /api/v1/state`、`GET /api/v1/events`、`GET /api/v1/<issue>`、`POST /api/v1/refresh`

Dashboard 是观察面，不参与调度决策。SSE event bus 透出 dispatch、session、turn、progress、stuck 等事件，前端只消费这些投影。

## 8. 文档分工

| 文档 | 用途 |
|---|---|
| `README.md` | 项目定位、安装、快速开始、常用入口 |
| `ARCHITECTURE.md` | 当前实现架构和运行模型 |
| `PLAN.md` | 历史路线图、契约演进、旧决策背景 |
| `openspec/specs/` | 当前可执行能力规范 |
| `docs/references/` | 上游/平台调研材料与 spike 结论 |

不要把新的实现细节继续堆到 README。行为变更先走 OpenSpec；架构说明更新到本文；历史背景才进入 PLAN。
