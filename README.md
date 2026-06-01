# codebuddy-auto

> **TypeScript 参考实现 · 基于 OpenAI Symphony SPEC + CodeBuddy Code SDK**

[OpenAI Symphony](https://github.com/openai/symphony) 调度规范的 TypeScript 参考实现。Symphony 官方用 Elixir/OTP，本项目面向希望在 Node.js 生态部署类 Symphony 调度器的团队。

- 编排层：TypeScript / Node.js 20 LTS
- Agent 执行：[CodeBuddy Agent SDK](https://www.codebuddy.cn/docs/cli/sdk-typescript)（in-process）
- Issue tracker：cnb.cool git issue
- 契约对齐：`PLAN.md` 按最新 Symphony SPEC 18 章 + Appendix A 落地，Linear 永不接入

完整任务规划、里程碑与待办以 [`PLAN.md`](./PLAN.md) 为准。

## 与 Symphony 官方实现的关系

| 维度 | Symphony 官方 | codebuddy-auto |
|---|---|---|
| 定位 | 规范 + 参考实现 | 另一个语言的参考实现 |
| 语言 | Elixir / OTP | **TypeScript / Node.js 20 LTS** |
| Agent 执行 | codex app-server（stdio 子进程） | **CodeBuddy Agent SDK（in-process）** |
| 调度模型 | BEAM supervisor tree | Node 子进程 + 心跳 + 崩溃重启 |
| Tracker | Linear | **cnb.cool git issue**（主）+ 本地目录（fallback） |
| 对标契约 | `symphony/SPEC.md` | 本仓库 `PLAN.md`（契约完整对齐 + 实现分阶段） |

关键策略：

- **契约不降维**：`PLAN.md` 按最新版 Symphony SPEC 的 18 章 + Appendix A 补齐语义边界
- **实现已覆盖 M1 ~ M4 主线**：单机调度、并发与 worktree、Dashboard、Live SSE 事件流均已落地
- **Linear 永不接入**：用 cnb.cool issue 替代

## 目录结构

```
codebuddy-auto/
├── PLAN.md                ← 项目计划 + 语言无关契约主干
├── scripts/               ← baseline.sh / diff-baseline.sh
├── typescript/            ← TypeScript 参考实现（src/test/package.json）
└── docs/references/       ← Symphony / cnb issue API 解读
```

## 前置依赖

- Node.js ≥ 20 LTS、pnpm ≥ 9、git、jq
- cnb CLI：`curl -fsSL https://cnb.cool/cnb/skills/cnb-skill/-/git/raw/main/install.sh | sh`

| 环境变量 | 必须 | 说明 |
|---|---|---|
| `CODEBUDDY_API_KEY` | ✓ | CodeBuddy Agent SDK 认证 |
| `CNB_TOKEN` | ✓ | cnb.cool API token（tracker + cnb CLI） |
| `CNB_USERNAME` / `CNB_PASSWORD` | ✓ | cnb.cool git 认证（hooks 中 clone/push） |
| `CNB_API_ENDPOINT` | 可选 | 默认 `https://api.cnb.cool` |

## 快速开始

```bash
cd typescript
pnpm install
cp .env.example .env             # 填入 CODEBUDDY_API_KEY、CNB_TOKEN 等
cp WORKFLOW.example.md WORKFLOW.md   # 改 projectSlug、clone 地址、prompt

set -a; source .env; set +a
pnpm build
node dist/src/main.js WORKFLOW.md --daemon
```

> Prompt 中务必包含 `{{ issue.description }}`，否则 agent 拿不到正文。

调度器只会捞取 **open + `agent-ready` 标签** 的 issue。

Dashboard：

- `GET /` — 实时 SSE 驱动的 HTML
- `GET /api/v1/state` / `events` / `<issue>` — 结构化 snapshot / SSE / 单 issue
- `POST /api/v1/refresh` — 排队一次额外 tick

## Issue 生命周期

对齐 Symphony agent-driven 完成信号，用标签模拟 Linear 工作流：

```
open + agent-ready  →  处理中  →  open + agent-finish  →  closed
     (Todo)         (In Progress)      (In Review)        (Done)
```

1. 人工贴 `agent-ready` → 成为候选
2. Scheduler dispatch → 创建 workspace → agent 执行
3. Agent 修复 → 验证 → commit/push → `cnb issues add-labels --labels agent-finish`
4. Scheduler 检测到 `agent-finish` → 停止 continuation 并 release
5. 人工审核合并 → 关闭 issue → reconciliation 清理 workspace

安全网：每次 continuation 前检查标签；达到 `maxTurns` 自动贴 `agent-finish`；审核未过则人工撤掉标签即可重启。

```yaml
# WORKFLOW.md front matter
tracker:
  candidate_label: agent-ready
  exclude_label: skip-agent
  finish_label: agent-finish
```

## Scheduler ↔ Worker 调用细节

```
                    ┌──────────────────────┐
       SIGINT/TERM ─┤   start-scheduler    │
                    │  (per-process root)  │
                    └──────────┬───────────┘
                               │ tick every polling.intervalMs
                               ▼
                    ┌──────────────────────┐
                    │  run-scheduler-once  │
                    └──┬─────────┬───────┬─┘
                       │         │       │
        ┌──────────────▼──┐  ┌───▼───┐  ┌▼──────────────────┐
        │ release-retry   │  │ recon-│  │  run-dispatch-    │
        │ (drop expired   │  │ cile  │  │  cycle            │
        │  retry entries) │  │       │  │                   │
        └─────────────────┘  └───┬───┘  └──┬──┬─────────────┘
                                 │         │  │
                  workerHandleSt ▼         │  │ kind === 'local'?
                                           │  │
                                           │  └─► dispatch-local-issue
                                           │         │ (background promise)
                                           │         ▼
                                           │     run-issue-worker
                                           │   (SDK session loop)
                                           │
                                           ▼ kind === 'ssh' only
                                    run-continuation-cycle
                                    (legacy per-turn CLI)
```

### scheduler tick (run-scheduler-once)

每个 tick 严格走四步：

1. **Release expired retry claims** — `state.retryAttempts` 中 `dueAtMs <= now` 且不在 `state.running` 的 entry 直接清除，让 issue 重回候选集。
2. **Reconcile running issues** — 用 `tracker.fetchIssueStatesByIds(running)` 拉一批 tracker state，`reconcile-runtime-state` 处理结果：
   - SSH 模式 / 没有 `WorkerHandle` 的条目 → 直接从 `state.running` 删除 + 标 `state.completed`，必要时清理 workspace。
   - **Local 模式** 有活 worker 的条目 → 不删 `state.running`，改为 `workerHandleStore.requestGracefulExit(issueId) = true`（cooperative）。Worker 在下一个 turn 边界自查并退出，避免半截工具调用留下脏状态。
3. **Continuation cycle** — **仅在 `worker.kind === 'ssh'`** 调用 `run-continuation-cycle`。Local 模式不走这条路：worker 自己在内部跑多轮。
4. **Dispatch cycle** — 调用 `run-dispatch-cycle`：先用 `plan-dispatch-cycle` 算 `availableSlots = maxConcurrentAgents - |running|`，按候选 issue 排序后，根据 `worker.kind` 分流：
   - `local` → `dispatch-local-issue(issue, …)`（异步、不 await）
   - `ssh`   → 旧路径：单轮 `runCodebuddyTurn` + 写入 `state.running` + 创建 retry entry。

### local 模式的 worker 生命周期

`dispatch-local-issue` 把 issue 准备好后启动一个**背景 Promise**，scheduler tick 马上返回：

```
dispatch-local-issue(issue)
  ├─ createRunAttempt → 工作目录 + 空 RunningEntry
  ├─ before_run hook  → 失败则 schedule retry
  ├─ state.running[id] = runningEntry      // ← 让后续 tick 不再选这个 issue
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
     │     │   └─ 否则继续下一轮
     │     │
     │     │ 退出后:
     │     │   max_turns_reached → tracker.addLabel(finish_label) (兜底)
     │     │
     │     └─ finally: session.close(); handleStore.release(id)
     │
     └─ 外层 IIFE finally:
          - delete state.running[id]
          - 根据 exitReason 分类:
              terminal*  → drop claimed + add completed
              retryable* → drop claimed only (下一 tick 可重试)
              aborted    → 不动 (SIGINT 时为重启留干净状态)
          - run after_run hook
```

`* terminal = finish_label_observed | issue_inactive | max_turns_reached | graceful_exit_requested`
`* retryable = turn_failed | turn_timed_out | startup_failed`

### 关键状态

| 字段 | 谁写 | 谁读 | 作用 |
|---|---|---|---|
| `state.running[id]` | dispatch + worker callbacks | plan-dispatch / dashboard / reconcile | "这个 issue 被人占着" |
| `state.claimed` | dispatch + worker exit | select-dispatch-candidates | 防止 race window 期内重复派发 |
| `state.completed` | worker exit / reconcile | dashboard | 信息性，不参与调度 |
| `state.runners[id]` (= WorkerHandle) | worker 入口 register | reconcile / worker turn 顶部 | 协作式 graceful-exit 开关 |
| `state.retryAttempts[id]` | dispatch failure / SSH continuation | run-scheduler-once / continuation cycle | SSH 路径专用；local 路径不写 |

### Symphony SPEC 对位

| 章节 | 实现 |
|---|---|
| §7.1 worker re-checks tracker each turn | `runIssueWorker` 每个 result 后 `fetchIssueStatesByIds` |
| §7.3 worker exit + 1s continuation retry | local: 单 worker 跑完整生命周期，无 1s 续跑；SSH: 走 `runContinuationCycle` |
| §10.3 app-server alive across turns | local: 一次 `unstable_v2_createSession` 串 N 轮；SSH: 每轮新 CLI 子进程 + `--resume` |
| §13.5 absolute token totals → delta | `dispatch-local-issue.onTurnComplete` 用 `lastReportedTotals` 算 delta |

## 目标仓库要求（Harness Engineering）

Symphony 假设目标仓库已采用 [Harness Engineering](https://openai.com/index/harness-engineering/) 体系，agent 才能稳定地完成工作：

| 条件 | 说明 | 为什么需要 |
|---|---|---|
| **CI Pipeline** | 仓库配有自动化构建/测试流水线 | Agent 提交的代码能被 CI 自动验证，不依赖人工判断对错 |
| **测试覆盖** | 核心功能有单元 / 集成测试 | Agent 改完代码可以跑测试自验，也是 PR 门禁的基础 |
| **Lint / 格式化规则** | ESLint、Prettier 或等价工具已配置 | Agent 通过 lint 发现规范问题，避免提交不合规代码 |
| **PR 门禁** | 分支保护 + CI 必须通过才能合入 | 即使 agent 代码有问题，也不会直接污染主分支 |
| **明确的项目结构** | README / AGENTS.md 描述了仓库约定 | Agent 能理解"在哪改、怎么改、怎么验证" |

**如果目标仓库缺少这些基础设施**，agent 行为将高度依赖 prompt 引导，且无法自动验证正确性。建议至少：

1. 配置一个可运行的测试命令（如 `pnpm test`）
2. 在 WORKFLOW.md 的 prompt 中明确写出验证步骤
3. 让 agent 提 PR 而非直接 push master，由人工审核

## License

Apache-2.0（与 OpenAI Symphony 保持一致）
