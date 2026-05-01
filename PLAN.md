# PLAN.md — agentfirst-f1 项目计划

> **状态**：M0 起草中。本文件是 agentfirst-f1 的**项目计划 + 契约主干**，对齐 Symphony SPEC 的语义，但
> backend 与技术栈按本项目实际选型（TypeScript / CodeBuddy Code CLI / cnb.cool）落地。
>
> 章节完成后把 ⚪ 改为 🟢。

---

## 0. 决策快照（2026-05-01 锁定）

| 维度 | 决策 | 备注 |
|---|---|---|
| 实现语言 | **TypeScript / Node.js 20 LTS** | 原计划 Python，因切 CLI 子进程改 TS |
| 包管理 | **pnpm** | |
| Agent 执行层 | **CodeBuddy Code CLI 子进程** | 非 SDK in-process；对位 Symphony 的 codex app-server |
| Tracker 主 backend | **cnb（cnb.cool git issue）** | 不接 Linear |
| Tracker fallback | **LocalTracker**（本地目录） | 测试/离线用 |
| Dashboard | SPEC 中为 MAY，M4 再做 | |
| Worker | 抽象接口预留，M1 只实现 LocalWorker | SSH/RemoteWorker 延后 |
| 对标策略 | **契约完整对齐 Symphony，实现分阶段落地** | 非降维，是插件化 + 分期 |

---

## 1. 里程碑

| 里程碑 | 契约章节（PLAN） | 实现（`typescript/`） |
|---|---|---|
| **M0** | 全部 14 章节 v0.1 骨架（含 CNB tracker / worker 抽象 / dashboard 占位） | 两份 spike 文档：CodeBuddy CLI + cnb API |
| **M1** | — | `typescript/` 最小可跑：CNBTracker + LocalWorker + CodeBuddy CLI 单 turn + 单并发 |
| **M2** | — | Continuation（基于 CLI `--resume`）+ baseline 闭环 + multi-turn |
| **M3** | — | `max_concurrent_agents` 多 issue 并发 + per-task git worktree |
| **M4** | — | Dashboard（SSE / WS）+ RemoteWorker（SSH）—— 按需取其一或都做 |

---

## 2. 契约章节骨架（对标 Symphony SPEC）

起草顺序建议：§1 → §14 → §6 → §9 → §3 → §7 → §5 → §8 → §4 → §2 → §10/§11/§12/§13。

- ⚪ **§1 项目定位**：与 Symphony 官方规范、TS 参考实现、CodeBuddy CLI 的边界
- ⚪ **§2 架构分层**：Workflow Loader / Config / Tracker / Orchestrator / Workspace / Runner / Status / Logging
- ⚪ **§3 State Schema**：运行时内存态（TS 类型 + zod 校验）+ 持久化策略（刻意不持久化调度状态）
- ⚪ **§4 Tracker 接口**：
  - 接口：`fetchCandidateIssues` / `fetchIssuesByStates` / `fetchIssueStatesByIds`
  - 两个 backend：`CNBTracker`（主）/ `LocalTracker`（fallback）
  - 显式状态映射表：Symphony 语义状态 ↔ cnb issue.state + label
- ⚪ **§5 Agent 协议**：
  - CodeBuddy Code CLI 调用契约（启动参数 / stdio 事件流 / 退出码语义）
  - session / thread 语义（依赖 CLI `--resume` 能力，待 spike 验证）
  - Continuation 规则（首轮渲染完整 prompt，后续轮仅发"继续指引"）
- ⚪ **§6 Run 生命周期**：11 阶段状态机（直接对齐 Symphony）
  ```
  PreparingWorkspace → BuildingPrompt → LaunchingAgentProcess
  → InitializingSession → StreamingTurn → Finishing
  → [Succeeded | Failed | TimedOut | Stalled | CanceledByReconciliation]
  ```
- ⚪ **§7 工作空间管理**：per-task 目录 + 三不变量（cwd 校验 / workspace root prefix 校验 / key sanitization）
- ⚪ **§8 Workflow 格式**：YAML front matter + prompt body；严格模板渲染（未知变量必须失败）
- ⚪ **§9 超时矩阵**：8 个默认值（直接对齐 Symphony）
  | 超时 | 默认值 |
  |---|---|
  | `polling.interval_ms` | 30000 |
  | `hooks.timeout_ms` | 60000 |
  | `codebuddy.turn_timeout_ms` | 3600000 (1h) |
  | `codebuddy.read_timeout_ms` | 5000 |
  | `codebuddy.stall_timeout_ms` | 300000 (5m) |
  | `agent.max_retry_backoff_ms` | 300000 (5m) |
  | `agent.max_turns` | 20 |
  | `agent.max_concurrent_agents` | 10 |
- ⚪ **§10 配置校验 Preflight**：启动前 + per-tick 校验；失败跳过本 tick 的派发
- ⚪ **§11 Token 核算**：绝对总量 vs delta 的坑（优先绝对 thread 总量）
- ⚪ **§12 可观测性**：结构化日志 + 运行时快照 JSON（MUST）；Web dashboard（MAY，M4）
- ⚪ **§13 测试一致性**：Core / Extension / Real Integration 三档
- ⚪ **§14 Non-Goals**：
  - Linear 集成 —— **永不进入本项目范围**
  - Phoenix LiveView 等价 Dashboard —— M4 再说
  - SSH Worker 多机 —— M4 再说
  - Elixir/OTP 监督树 —— 物理不可抄，以 "Node 子进程 + 心跳 + 崩溃重启" 作为语义等价实现

---

## 3. M0 待办（当前阶段）

### 3.1 阻塞性 spike（必须先做）

两份 spike 已纳入 OpenSpec change **`m0-spike-codebuddy-and-cnb`**（见 `openspec/changes/m0-spike-codebuddy-and-cnb/`）。
详细 proposal / design / tasks / 能力骨架 spec 在 change 目录内维护，本节不重复清单。

- 🟢 **Spike A — CodeBuddy CLI 能力验证** → [`docs/references/codebuddy-cli-capabilities.md`](./docs/references/codebuddy-cli-capabilities.md)（2026-05-01 完成，Verdict 🟢）
- 🟢 **Spike B — cnb.cool Issue API 验证** → [`docs/references/cnb-issue-api.md`](./docs/references/cnb-issue-api.md)（2026-05-01 完成，Verdict 🟡 带 3 处降级）

两份 spike 完成且 change 归档（`/opsx:archive`）后，PLAN §4 和 §5 才有起草的前提。

### 3.2 文档修订

- 🟢 `SPEC.md` → 重命名并扩写为 `PLAN.md`（本文件）
- ⚪ `README.md`：Python → TS、SDK → CLI、Linear 字样清理、里程碑表对齐、目录结构对齐
- ⚪ `docs/references/symphony.md`：第 "#15 不抄" 小节重写为"分阶段实现 + 不做 Linear"

### 3.3 骨架搭建（spike 验证通过后）

- ⚪ 新建 `typescript/` 目录
  ```
  typescript/
  ├── package.json         (pnpm + 工作区预留)
  ├── tsconfig.json
  ├── src/
  │   ├── spec/            ← 类型定义 + zod schema（对应 §3）
  │   ├── tracker/         ← CNBTracker + LocalTracker（对应 §4）
  │   ├── runner/          ← CodeBuddy CLI 子进程封装（对应 §5）
  │   ├── scheduler/       ← poll loop + dispatch（对应 §2）
  │   ├── workspace/       ← per-task 目录 + 三不变量（对应 §7）
  │   └── index.ts
  └── test/                ← vitest
  ```
- ⚪ `scripts/baseline.sh` 的 `TESTS_DIR` / `API_SRC_DIR` 默认值从 `python/*` 改为 `typescript/*`

### 3.4 技术栈选型（确认稿）

详见 [`AGENTS.md` §1 技术栈（锁定）](./AGENTS.md#1-技术栈锁定) 和 [§2 编码规范（硬约束）](./AGENTS.md#2-编码规范硬约束)。
本节不重复。

---

## 4. 已识别的风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | CodeBuddy CLI 不支持严格的 `--resume` 语义 | M0 spike 先验；若不支持，Continuation 机制需自己在调度器侧维持 prompt 历史 |
| R2 | cnb.cool API 不开放评论 / 改 label 权限 | M0 spike 先验；若受限，agent 自更新 ticket 降级为"调度器代为更新"，agent 只在 PR / commit message 里带结构化标记 |
| R3 | 切 TS 后团队心智成本 | 可控；harness-f1 生态本身也是 Node 主导 |
| R4 | Node 无 OTP 级监督树 | 已在 §14 承认，不再视为风险 |

---

## 变更记录

| 版本 | 日期 | 摘要 |
|---|---|---|
| v0.0 | 2026-05-01 | `SPEC.md` 空骨架建立 |
| v0.1 | 2026-05-01 | 重命名为 `PLAN.md`；锁定 TS + pnpm + CodeBuddy CLI + cnb tracker 四项决策；加入 M0 spike 清单 |
| v0.2 | 2026-05-01 | `AGENTS.md` 追加 §5 Superpowers Usage（MUST/SHOULD/NOT 三档），明确开发过程 skill 使用规约 |
| v0.3 | 2026-05-01 | `AGENTS.md` 重构为项目专属规约一站式文档（§1 技术栈 / §2 编码规范 7 条硬约束 / §3 目录结构 / §4 Skill 规约）；PLAN §3.4 迁移至 AGENTS，通用 LLM 行为规则引用项目级 rule `karpathy-guidelines.mdc`；CLI 入口锁定 commander |
| v0.4 | 2026-05-01 | `AGENTS.md` §4 重写为"开发工作流（OpenSpec + Superpowers）"融合版：6 条主流程纪律 + skill 速查表 + OpenSpec change 粒度约束 + NOT 清单 + 边界禁用；决定 M1 动工前引入 `@fission-ai/openspec` |
| v0.5 | 2026-05-01 | `openspec init` 落地；两份 spike 的 design doc 迁移到 `openspec/changes/m0-spike-codebuddy-and-cnb/`（proposal + design + tasks + 两份 skeleton spec）；删除 `docs/plans/2026-05-01-spike-ab-design.md`；AGENTS.md §4.1 豁免清单删除 `docs/plans/` 条目 |
| v0.6 | 2026-05-01 | Spike A 完成（CodeBuddy CLI 2.93.6 🟢 充分承接 §10）；Spike B 完成（cnb.cool REST API 🟡 承接 §11 带 3 处降级：无 batch-by-id / labels OR-only / 无 custom fields）；`scripts/spike-b-probe.sh` 固化为可回归探针 |
