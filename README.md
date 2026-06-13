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
├── package.json           ← 根目录本地安装入口（bin 指向 typescript/dist）
├── examples/workflows/    ← 可复制修改的 WORKFLOW.md 示例
├── scripts/               ← baseline.sh / diff-baseline.sh / install-cnb-harness
├── templates/             ← 可安装到业务仓库的 harness 标准模板
├── typescript/            ← TypeScript 实现（src/test/dashboard/package.json）
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
pnpm install
pnpm build
```

创建一个独立的调度运行目录，并初始化 `WORKFLOW.md`：

```bash
mkdir -p ../codebuddy-auto-runner
cd ../codebuddy-auto-runner
node ../codebuddy-auto/typescript/dist/src/main.js init
```

然后编辑 `WORKFLOW.md`，把 `your-org/your-repo` 和 clone URL 改成业务仓库。也可以初始化时直接填好 workflow 里的业务仓库：

```bash
node ../codebuddy-auto/typescript/dist/src/main.js init \
  --project relaxorg/symphony_repo_crm \
  --repo-url https://cnb.cool/relaxorg/symphony_repo_crm.git
```

导出必要环境变量后检查并启动：

```bash
export CODEBUDDY_API_KEY=...
export CNB_TOKEN=...
node ../codebuddy-auto/typescript/dist/src/main.js check
node ../codebuddy-auto/typescript/dist/src/main.js daemon
```

如果你自己维护私有凭据文件，也可以手动 `source`，但 `codebuddy-auto init` 不会生成或读取 `.env`。

调度器只会捞取 **open + `agent-ready` 标签** 的 issue。

## 本地安装 CLI

不发布到 npm registry 时，也可以从源码安装成本机命令；不需要 NPM 账号。

```bash
git clone https://cnb.cool/relaxorg/codebuddy-auto.git
cd codebuddy-auto
pnpm install
pnpm build
pnpm setup          # 首次使用 pnpm 全局命令时需要；执行后重开 shell 或 source ~/.zshrc
pnpm link --global
```

安装后可直接运行：

```bash
mkdir -p ../codebuddy-auto-runner
cd ../codebuddy-auto-runner
codebuddy-auto init
# 编辑 WORKFLOW.md，或初始化时传 --project / --repo-url 直接填好业务仓库
export CODEBUDDY_API_KEY=...
export CNB_TOKEN=...
codebuddy-auto check
codebuddy-auto daemon
```

`init` 会在当前目录生成 `WORKFLOW.md`，并创建 `.codebuddy-auto/workspaces/`。不传参数时会在交互式终端询问 project 和 repo URL；非交互环境会生成可编辑占位值。已有 `WORKFLOW.md` 时默认不会覆盖，确认要重建时使用 `codebuddy-auto init --force`。凭据由 shell / CI 环境显式提供，`init` 不生成 `.env`。

如果 `pnpm link --global` 报 `ERR_PNPM_NO_GLOBAL_BIN_DIR`，说明本机还没有 pnpm 全局 bin 目录。执行 `pnpm setup` 后重开 shell，再运行 `pnpm link --global`。

也可以不用 pnpm 全局 link，直接从源码目录安装到 npm 的全局 prefix：

```bash
cd codebuddy-auto
pnpm build
npm install -g .
```

或者打成本地 tarball 再安装：

```bash
cd codebuddy-auto
pnpm build
pnpm pack
npm install -g ./relaxorg-codebuddy-auto-0.1.0.tgz
```

当前包仍保留 `"private": true`，目的是允许本地 `link/pack`，同时避免误发布到 npm registry。

## CNB Issue Harness

`codebuddy-auto` 维护标准 CNB issue template，但 CNB 只会读取业务仓库里的模板。把模板安装到业务仓库：

```bash
./scripts/install-cnb-harness ../symphony_repo_crm
```

这会写入：

```text
../symphony_repo_crm/.cnb/ISSUE_TEMPLATE/agent-ready.yml
```

默认不会覆盖已有模板；要刷新为标准模板：

```bash
./scripts/install-cnb-harness --overwrite ../symphony_repo_crm
```

业务仓库需要先创建这些 CNB labels：

```text
agent-ready
skip-agent
agent-finish
```

其中 `agent-ready` 是 scheduler 候选标签；issue 表单里的 `Task type` 是给 agent 读的任务分类，不是调度标签。更多说明见 [`docs/cnb-harness.md`](./docs/cnb-harness.md)。

Dashboard：

- `GET /` — 由 status server 托管的 React SPA shell（静态资源来自 `typescript/dist/dashboard`）
- `GET /api/v1/dashboard/bootstrap` — Dashboard 首屏 bootstrap 数据（配置摘要 + 初始 snapshot + `repoUrl` + `serverTime`）。snapshot 会包含 `running`、`retrying`、`progress`、`stuck`、`completedIssueIds`
- `GET /api/v1/state` / `events` / `<issue>` — 结构化 snapshot / SSE / 单 issue；SSE 会透出 `progress_fingerprint_recorded` 与 `issue_stuck`
- `POST /api/v1/refresh` — 排队一次额外 tick

前端开发：

```bash
pnpm run dev:dashboard
# 默认代理到 http://127.0.0.1:4317
# 如 status server 监听其他地址，可用 DASHBOARD_PROXY_TARGET 覆盖
# DASHBOARD_PROXY_TARGET=http://127.0.0.1:4567 pnpm run dev:dashboard
```

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

安全边界：每次 continuation 前检查标签；`agent-finish` 只由 agent 在完成验证、commit/push、handoff 准备后主动添加。达到 `maxTurns` 不会自动贴 `agent-finish`，而是记录为 stuck，等待人工处理或 tracker 状态变化。

progress gate 是在 Symphony-compatible handoff 之外的增强层：它只比较 workspace/tracker 指纹来识别连续无进展的 turn，并把 issue 暂停在本进程内。scheduler 不运行或解释业务仓库的 `npm run verify` 等项目命令，验证仍由 workflow prompt 中的 agent 负责。

```yaml
# WORKFLOW.md front matter
tracker:
  candidate_label: agent-ready
  exclude_label: skip-agent
  finish_label: agent-finish

agent:
  max_turns: 30
  no_progress_threshold: 3
```

`no_progress_threshold` 表示连续多少次 turn 边界的 progress fingerprint 没变化后，当前进程把 issue 标为 `stuck: no_progress` 并停止自动续跑。默认值是 `3`。它不代表失败验证，也不会写 tracker label。

stuck issue 的处理方式：

1. Dashboard / `codebuddy-auto status` 会显示 stuck reason。
2. Scheduler 不再自动 dispatch / continue 这个 issue。
3. 如果 tracker 后续出现 `agent-finish`、issue 离开 active state、进入 terminal state，或 tracker 不再返回该 issue，reconciliation 会按正常 handoff/release 规则释放它。

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

每个 tick 严格走五步：

1. **Release expired retry claims** — `state.retryAttempts` 中 `dueAtMs <= now` 且不在 `state.running` 的 entry 直接清除，让 issue 重回候选集。
2. **Reconcile running issues** — 用 `tracker.fetchIssueStatesByIds(running)` 拉一批 tracker state，`reconcile-runtime-state` 处理结果：
   - SSH 模式 / 没有 `WorkerHandle` 的条目 → 直接从 `state.running` 删除 + 标 `state.completed`，必要时清理 workspace。
   - **Local 模式** 有活 worker 的条目 → 不删 `state.running`，改为 `workerHandleStore.requestGracefulExit(issueId) = true`（cooperative）。Worker 在下一个 turn 边界自查并退出，避免半截工具调用留下脏状态。
3. **Reconcile stuck issues** — 对不在 running 中的 stuck issue 重新读取 tracker state；如果出现 finish label、离开 active state、进入 terminal state，或 tracker 不再返回，则释放本进程内的 stuck/progress bookkeeping。
4. **Continuation cycle** — **仅在 `worker.kind === 'ssh'`** 调用 `run-continuation-cycle`。Local 模式不走这条路：worker 自己在内部跑多轮。
5. **Dispatch cycle** — 调用 `run-dispatch-cycle`：先用 `plan-dispatch-cycle` 算 `availableSlots = maxConcurrentAgents - |running|`，按候选 issue 排序后，根据 `worker.kind` 分流：
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

### 关键状态

| 字段 | 谁写 | 谁读 | 作用 |
|---|---|---|---|
| `state.running[id]` | dispatch + worker callbacks | plan-dispatch / dashboard / reconcile | "这个 issue 被人占着" |
| `state.claimed` | dispatch + worker exit | select-dispatch-candidates | 防止 race window 期内重复派发 |
| `state.completed` | worker exit / reconcile | dashboard | 信息性，不参与调度 |
| `state.runners[id]` (= WorkerHandle) | worker 入口 register | reconcile / worker turn 顶部 | 协作式 graceful-exit 开关 |
| `state.retryAttempts[id]` | dispatch failure / SSH continuation | run-scheduler-once / continuation cycle | SSH 路径专用；local 路径不写 |
| `state.progress[id]` | worker / SSH continuation turn 边界 | dashboard / status | workspace + tracker 指纹，供 no-progress 判断 |
| `state.stuck[id]` | worker / continuation / maxTurns | scheduler / dashboard / status | 本进程内暂停自动续跑，直到 tracker handoff 或 inactive release |

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
