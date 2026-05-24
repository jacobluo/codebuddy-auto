# PLAN.md — agentfirst-f1 项目计划

> **状态**：M0 / M1 / M2 已完成，当前进入 M3 准备阶段；PLAN 正在继续补齐正式契约章节。本文件是 agentfirst-f1 的**项目计划 + 契约主干**，
> 对齐 Symphony SPEC 的语义，但 backend 与技术栈按本项目实际选型（TypeScript / CodeBuddy Code CLI / cnb.cool）落地。
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

| 里程碑 | 状态 | 契约章节（PLAN） | 实现（`typescript/`） |
|---|---|---|---|
| **M0** | 🟢 已完成 | 18 章 + Appendix A 的差距映射、spike 结论、roadmap 骨架 | 两份 spike 文档 + `PLAN.md` 与最新版 SPEC 的差距分析对齐 |
| **M1** | 🟢 已完成 | 将 PLAN 中与单机最小调度器直接相关的章节补成可实现契约 | `typescript/` 已闭环单机调度主流程：poll/reconcile/continuation/retry/workspace cleanup/daemon status API |
| **M2** | 🟢 已完成 | continuation、baseline 闭环、多 turn 相关章节细化 | continuation / multi-turn 主路径、baseline / diff-baseline 脚本闭环、approval/notification 事件映射与自动化测试已补齐 |
| **M3** | 🟡 进行中 | 并发调度、git worktree、安全边界进一步细化 | `max_concurrent_agents` 多 issue 并发已完成；per-task git worktree 基础配置/生命周期已接入，安全边界细化待续 |
| **M4** | ⚪ 待启动 | dashboard / remote worker extension 契约补齐 | Dashboard（SSE / WS）+ RemoteWorker（SSH）—— 按需取其一或都做 |

---

## 2. 契约章节差距清单（对标最新版 Symphony SPEC）

上游 [`docs/references/symphony-spec.md`](./docs/references/symphony-spec.md) 已扩展为 **18 章 + Appendix A**。
当前 `PLAN.md` 仍以“差距分析 + 补齐清单”为主，还不是按最新版 SPEC 重写后的正式 18 章正文；因此本节先显式标注滞后状态，避免后续实现继续按旧章节映射推进。

状态说明：

- `🔴` 严重滞后：章节边界或内容骨架已不足以承接最新版 SPEC
- `🟡` 部分滞后：主方向仍成立，但缺少最新版 SPEC 的关键约束
- `⚪` 未起草：方向已确定，但尚未落成文档

建议起草顺序（按最新版 SPEC 重排）：§1/§2/§3 → §5/§6 → §7/§8/§9 → §10/§11/§12 → §13/§14/§15 → §17/§18 → Appendix A。

- `🟡` **§1 项目定位**：仍可沿用，但需补上最新版 SPEC 的 `Goals / Non-Goals / trust boundary / handoff state` 边界。
- `🟡` **§2 架构分层**：现仅覆盖组件名，缺少最新版 SPEC §3 的 `abstraction levels` 与 `external dependencies`。
- `🔴` **§3 State Schema**：需从“运行时内存态”扩展为最新版 SPEC §4 + §7 的完整实体模型。
  - 必补：`WorkflowDefinition`、`Workspace`、`RunAttempt`、`RetryEntry`、`Orchestrator Runtime State`
  - 必补：`Issue` 归一化规则、`session_id = <thread_id>-<turn_id>`、`claimed/completed/retry_attempts` 语义
- `🟡` **§4 Tracker 接口**：主抽象仍成立，但需补齐最新版 SPEC §11 的分页、错误分类、归一化细则、`Tracker Writes` 边界。
  - 现有方向仍对：`fetchCandidateIssues` / `fetchIssuesByStates` / `fetchIssueStatesByIds`
  - 必补：`candidate fetch failure / running refresh failure / startup cleanup failure` 的编排层行为
- `🔴` **§5 Agent 协议**：这是当前最大滞后点之一，需从“CLI 调用契约”升级为最新版 SPEC §10 + §12 的完整 runner contract。
  - 必补：launch contract、session startup responsibilities、streaming turn processing、emitted runtime events
  - 必补：approval / user-input policy、timeout & error mapping、prompt construction / retry / continuation semantics
- `🟡` **§6 Run 生命周期**：11 阶段状态机仍成立，但缺少最新版 SPEC §7 / §8 / §14 / §16 的编排状态与恢复规则。
  - 必补：`Unclaimed / Claimed / Running / RetryQueued / Released`
  - 必补：`worker exit(normal|abnormal)`、`retry timer fired`、`reconciliation`、`stall timeout` 触发器
- `🟡` **§7 工作空间管理**：三不变量仍成立，但需补齐最新版 SPEC §9 / §15.2 / §15.4。
  - 必补：workspace layout / create-or-reuse / optional population / hooks failure semantics
  - 必补：hook 输出截断、trusted hook 风险声明
- `🔴` **§8 Workflow 格式**：当前只写了 YAML + prompt，明显落后于最新版 SPEC §5 + §6。
  - 必补：workflow file path precedence、front matter schema、typed config resolution pipeline、dynamic reload semantics
  - 必补：validation error surface、`$VAR` / `~` / 相对路径解析规则
- `🟡` **§9 超时矩阵**：8 个默认值仍有效，但已不足以独立承载最新版 SPEC §5.3 / §6.4 / §8.4。
  - 必补：与 `codex.command`、`hooks.timeout_ms`、`max_concurrent_agents_by_state` 一起并入 config cheat sheet
  - 必补：continuation retry 固定 `1000ms` 与 failure retry exponential backoff 的区别
- `🟡` **§10 配置校验 Preflight**：方向正确，但需补齐最新版 SPEC §6.2 / §6.3。
  - 必补：startup validation vs per-tick validation
  - 必补：invalid reload 保留 `last known good config`，不能把服务打挂
- `🟡` **§11 Token 核算**：方向正确，但需补齐最新版 SPEC §13.5 的 token / runtime / rate-limit 三件套。
  - 必补：`absolute totals` 优先级、delta 去重、`seconds_running` 聚合、latest rate-limit snapshot
- `🔴` **§12 可观测性**：当前只有“结构化日志 + JSON 快照”的一句话，已落后于最新版 SPEC §13。
  - 必补：logging conventions、sink failure behavior、runtime snapshot、human-readable status surface
  - 若实现 HTTP 扩展，还需补：`/api/v1/state`、`/api/v1/<issue_identifier>`、`/api/v1/refresh`
- `🔴` **§13 测试一致性**：需要从一句“三档测试”扩展为最新版 SPEC §17 + §18 的验证矩阵与 DoD。
  - 必补：workflow/config parsing、workspace safety、tracker client、orchestrator、runner、observability、CLI lifecycle
- `🟡` **§14 Non-Goals**：非目标仍大体正确，但需与最新版 SPEC §2 / §14 / §15 / §18 对齐。
  - 必补：`restart recovery is tracker/filesystem-driven`、安全/硬化由实现显式声明
  - 保持不变：`Linear` 永不接入、Dashboard/SSH 延后、OTP 不做物理复刻

### 2.1 上游新增但本地尚缺的一级章节

以下内容在最新版 SPEC 中已成为一级章节或附录，但本地 `PLAN.md` 还没有显式章节承接：

- `🔴` **§15 安全与操作安全**：信任边界、文件系统安全、secret handling、hook 风险、harness hardening
- `🔴` **§16 参考算法**：startup / poll / reconcile / dispatch / worker attempt / retry handling 伪代码
- `🔴` **§17 测试与验证矩阵**：Core Conformance / Extension Conformance / Real Integration Profile 的细项清单
- `🔴` **§18 Implementation Checklist / DoD**：哪些能力是 REQUIRED，哪些是 RECOMMENDED extension
- `🟡` **Appendix A SSH Worker Extension**：本项目 roadmap 已有 RemoteWorker，但还没有按上游附录拆出扩展契约

### 2.2 结论

- 本项目方案**仍然可行**，因为核心替换关系没变：`Linear -> cnb`、`Codex app-server -> CodeBuddy CLI/ACP`、`Elixir/OTP -> Node subprocess orchestration`。
- 现在的主要问题不是“方案错误”，而是 **`PLAN.md` 的契约覆盖面已经落后于上游 SPEC 粒度**。
- 当前 `typescript/` 已有最小骨架，但在把它推进到可闭环的 M1 主流程前，至少应先补齐 `§3 / §5 / §8 / §12 / §13`，否则实现会缺少最新版 SPEC 的关键约束面。

### 2.3 可执行补齐清单

以下清单按“先补契约、再写代码”的顺序组织。每项都应产出可检查的文档结果，而不是只做讨论。
其中 `Phase 0` 与 `Phase 1` 是当前整理 `PLAN.md` 的主线，`Phase 2` 之后的内容在正式章节主线建立后推进。

说明：本节勾选状态记录的是 **`PLAN.md` 正式契约章节的补写完成度**，不是 `typescript/` 运行时代码完成度。
因此即使 M1 / M2 的实现已经闭环，下面许多任务仍保持未勾选，因为对应的 18 章正式契约正文还没有真正写入 `PLAN.md`。
当前已完成的是“实现里程碑推进 + README/里程碑状态收口”；当前未完成的主要是“把这些实现事实上升为正式章节契约”。

#### Phase 0 — 重排 PLAN 结构（必须先做）

- [ ] **Task 0.1**：把 `PLAN.md` 从“差距清单主导”改写为与最新版 SPEC 对齐的 **18 章 + Appendix A 正式章节主线**。
  - 完成标准：`PLAN.md` 以 `§1` 到 `§18` 的正式章节为主线组织内容，并显式标出 `Appendix A`。
- [ ] **Task 0.2**：为正式章节目录补上状态标记（`🟢/🟡/⚪`）与一句话范围说明。
  - 完成标准：读章节目录区即可看出“哪些章节已起草、哪些仅占位、哪些仍滞后”。
- [ ] **Task 0.3**：把当前“差距分析”保留为过渡信息，但避免它继续充当正式契约正文。
  - 完成标准：差距分析被收拢到 roadmap / migration 语境，正式章节成为主线。

#### Phase 1 — 先补最缺的 5 章（推进 M1 主流程前必须完成）

- [ ] **Task 1.1 — 补 §3 State Schema**
  - 目标：把 `Issue / WorkflowDefinition / Workspace / RunAttempt / LiveSession / RetryEntry / RuntimeState` 定义完整。
  - 完成标准：章节内明确字段、归一化规则、内存态边界，以及 `session_id` / `claimed` / `retry_attempts` 语义。
- [ ] **Task 1.2 — 补 §5 Workflow Specification + §6 Configuration Specification**
  - 目标：覆盖 `WORKFLOW.md` 发现规则、front matter schema、`$VAR` / `~` / 相对路径解析、dynamic reload、preflight validation。
  - 完成标准：能直接指导 `workflow/` 与 `config/` 两个目录实现，不再依赖上游 SPEC 反复查漏。
- [ ] **Task 1.3 — 补 §10 Agent Runner Protocol + §12 Prompt Construction**
  - 目标：把 CodeBuddy CLI 适配写成正式契约，包括 launch、session、事件映射、approval policy、continuation、prompt retry 语义。
  - 完成标准：`runner/` 可以按本地 `PLAN.md` 实现，不必再回退到 spike 文档拼装规则。
- [ ] **Task 1.4 — 补 §13 Logging / Status / Observability**
  - 目标：明确结构化日志字段、snapshot shape、token/runtime/rate-limit 聚合规则、可选 HTTP 扩展边界。
  - 完成标准：`logging/` 与未来 dashboard API 有稳定输入输出契约。
- [ ] **Task 1.5 — 补 §17 Test Matrix + §18 Definition of Done**
  - 目标：把 conformance 检查拆成可执行测试清单。
  - 完成标准：每个核心模块至少能映射到一个测试小节，且能作为 `typescript/test/` 的目录依据。

#### Phase 2 — 补运行时主干章节（M1 主流程收口前完成）

- [ ] **Task 2.1 — 补 §1 Problem Statement / Project Positioning**
  - 目标：说明本项目与上游 Symphony、CodeBuddy CLI、cnb tracker 的边界，以及“handoff state 不等于 Done”。
  - 完成标准：不再只有“TS 参考实现”一句描述，而是有明确问题定义和适用边界。
- [ ] **Task 2.2 — 补 §2 System Overview**
  - 目标：把 components、abstraction levels、external dependencies 三层都写清楚。
  - 完成标准：`tracker -> scheduler -> runner -> workspace -> logging` 的依赖方向在文档中可直接验证。
- [ ] **Task 2.3 — 补 §7 Orchestration State Machine**
  - 目标：写清 `Unclaimed / Claimed / Running / RetryQueued / Released` 与 11 阶段 run lifecycle 的关系。
  - 完成标准：正常退出、异常退出、retry、stall、reconciliation 都有明确状态迁移说明。
- [ ] **Task 2.4 — 补 §8 Polling / Scheduling / Reconciliation**
  - 目标：写清 poll tick 顺序、dispatch eligibility、sort 规则、concurrency、retry/backoff、startup cleanup。
  - 完成标准：`scheduler/` 可以直接据此实现主循环，无需再做大范围设计决策。
- [ ] **Task 2.5 — 补 §9 Workspace Management and Safety**
  - 目标：补 workspace layout、create/reuse、optional population、hooks、三不变量。
  - 完成标准：`workspace/` 目录行为、hook failure semantics、cleanup 规则可直接落地。
- [ ] **Task 2.6 — 补 §11 Tracker Integration Contract**
  - 目标：把 `CNBTracker` 的分页、错误分类、labels/blocker 归一化、writes boundary 写成正式契约。
  - 完成标准：cnb 的 3 个降级点被正式吸收到 contract，而不是只存在 spike 报告里。

#### Phase 3 — 补安全、恢复、参考算法（M1 期间并行）

- [ ] **Task 3.1 — 补 §14 Failure Model and Recovery**
  - 目标：归类 config / workspace / runner / tracker / observability 故障，并定义恢复策略。
  - 完成标准：restart recovery、skip-dispatch-but-keep-reconcile、worker retry 等行为有统一表述。
- [ ] **Task 3.2 — 补 §15 Security and Operational Safety**
  - 目标：明确 trust boundary、secret handling、hook 风险、harness hardening 建议。
  - 完成标准：本项目的高信任/低信任运行假设被正式记录，不再散落在讨论里。
- [ ] **Task 3.3 — 补 §16 Reference Algorithms**
  - 目标：为 `startup / tick / reconcile / dispatch / run-agent-attempt / on-worker-exit` 写伪代码。
  - 完成标准：核心流程可由伪代码直接映射为 TypeScript 函数骨架。
- [ ] **Task 3.4 — 补 Appendix A SSH Worker Extension 占位**
  - 目标：即便 M4 才实现，也先明确这是 extension，不属于 M1 conformance。
  - 完成标准：RemoteWorker 的未来边界被写清，不与 LocalWorker 主线混淆。

#### Phase 4 — 文档与 roadmap 收尾（避免文档彼此打架）

- [x] **Task 4.1**：同步 `README.md` 的职责边界，去掉 README 承载任务状态与“14 章骨架”心智。
  - 完成标准：README 中仅保留项目目标 / 定位 / 技术路径 / 快速开始，并明确任务规划统一以 `PLAN.md` 为准。
- [ ] **Task 4.2**：同步 [`docs/references/symphony.md`](./docs/references/symphony.md)，把“借鉴清单”引用改到最新版章节号。
  - 完成标准：引用的 SPEC 章节编号不再失真。
- [ ] **Task 4.3**：把 OpenSpec 后续 change 拆分为若干小 change，而不是一次性重写整份 `PLAN.md`。
  - 建议拆分：`draft-plan-state-schema`、`draft-plan-workflow-config`、`draft-plan-runner-contract`、`draft-plan-observability-and-tests`。
  - 完成标准：每个 change 可在 1 个顶层任务内完成并可审查。

#### 当前建议优先级

1. `P0`：`Task 0.1 ~ 0.3`，先把 `PLAN.md` 从“差距分析主导”升级为“正式章节主导”。
2. `P0`：`Task 1.1 ~ 1.5`，这是把 M1 从“最小骨架”推进到“可闭环主流程”的最低文档门槛。
3. `P1`：`Task 2.1 ~ 2.6`，补齐调度主干章节，使 `scheduler / workspace / tracker` 主流程有完整契约。
4. `P2`：`Task 3.1 ~ 3.4` 与 `Task 4.2 ~ 4.3`，用于收束恢复、安全、附录扩展和后续 roadmap。

---

## 3. 当前实现状态（截至 2026-05-19）

### 3.1 已完成的前置验证（M0）

本小节记录已经完成并关闭的前置验证，避免后续把它们继续当作当前待办。

两份 spike 已纳入 OpenSpec change **`m0-spike-codebuddy-and-cnb`**（见 `openspec/changes/m0-spike-codebuddy-and-cnb/`）。
详细 proposal / design / tasks / 能力骨架 spec 在 change 目录内维护，本节不重复清单。

- 🟢 **Spike A — CodeBuddy CLI 能力验证** → [`docs/references/codebuddy-cli-capabilities.md`](./docs/references/codebuddy-cli-capabilities.md)（2026-05-01 完成，Verdict 🟢）
- 🟢 **Spike B — cnb.cool Issue API 验证** → [`docs/references/cnb-issue-api.md`](./docs/references/cnb-issue-api.md)（2026-05-01 完成，Verdict 🟡 带 3 处降级）

两份 spike 已完成且 change 已归档，因此 PLAN §4 和 §5 的细化起草条件已经满足。

### 3.2 已完成的文档收敛

- 🟢 `SPEC.md` → 重命名并扩写为 `PLAN.md`（本文件）
- 🟢 `README.md`：已收敛为“项目目标 / 定位 / 技术路径 / 快速开始”，不再承载任务状态
- 🟡 `docs/references/symphony.md`：已完成“不做 Linear / 分阶段实现”重写；仍需把引用章节号同步到最新版 SPEC

### 3.3 已落地的 TypeScript 骨架

- 🟢 新建 `typescript/` 目录
  ```
  typescript/
  ├── package.json         (pnpm + 工作区预留)
  ├── tsconfig.json
  ├── src/
  │   ├── spec/            ← 类型定义 + zod schema（对应 §3）
  │   ├── tracker/         ← CNBTracker + LocalTracker（对应 §4）
  │   ├── runner/          ← CodeBuddy CLI / ACP 适配层（对应 §10）
  │   ├── scheduler/       ← poll loop + dispatch（对应 §2）
  │   ├── workspace/       ← per-task 目录 + 三不变量（对应 §7）
  │   ├── workflow/        ← WORKFLOW.md 加载 + 模板渲染（对应 §5）
  │   ├── config/          ← typed config + reload/preflight（对应 §6）
  │   ├── logging/         ← pino + snapshot/status surface（对应 §13）
  │   └── index.ts
  └── test/                ← vitest
  ```
- 🟢 `typescript/` 已落地最小骨架：`spec / tracker / runner / scheduler / workspace / workflow / config / logging / cli` 均已有源码与基础测试
- 🟢 `scripts/baseline.sh` 的 `TESTS_DIR` / `API_SRC_DIR` 默认值已从 `python/*` 改为 `typescript/*`
- 🟢 `typescript/test/` 已按 `src/` 主要模块镜像分层，具备基础验证矩阵雏形

### 3.4 M1 结项说明

- 🟢 scheduler 已闭环 startup cleanup、poll loop、reconciliation、continuation、retry/backoff、terminal issue workspace cleanup 与 `beforeRemove` hook 路径
- 🟢 runner 已覆盖真实子进程拉起、NDJSON 事件流解析、read/turn/stall timeout、token/runtime 聚合、continuation resume，以及 approval/user-input 的主要策略面
- 🟢 workflow / config 已覆盖 front matter 解析、workflow path precedence、strict prompt rendering、dynamic reload、last-known-good 运行时保留，以及相对路径 / `$VAR` / `~` / MCP 路径解析
- 🟢 logging 已覆盖 runtime snapshot、token/runtime/rate-limit 近似聚合、human-readable status surface、issue-scoped child logger，以及已接入 daemon 生命周期的最小 HTTP status API
- 🔜 后续工作已移动到后续里程碑：git worktree 隔离与更完整的多 issue runtime 编排归入 M3，richer dashboard / remote worker 归入 M4
- 🟡 M3 已启动首个实现增量：workspace/config 已支持 `directory | git-worktree` 模式切换、`workspace.sourceRoot` 解析、git worktree 创建/清理生命周期与对应自动化测试

### 3.5 下一步应直接对应的 PLAN 章节

- `§3 State Schema`：把当前 `spec/` 中已出现的 `Issue / RuntimeState / RetryEntry` 扩成正式实体契约
- `§5 Workflow Specification` 与 `§6 Configuration Specification`：把现有 `loadWorkflow()` / `loadServiceConfig()` 的行为上升为正式规范
- `§10 Agent Runner Protocol` 与 `§12 Prompt Construction`：把现有 `buildCodebuddyCommand()` 和 spike 结论汇总成可实现的 runner contract
- `§13 Logging / Status / Observability` 与 `§17 Test Matrix`：让当前 `logging/` 与 `typescript/test/` 有明确完成标准

### 3.6 技术栈选型（确认稿）

详见 [`AGENTS.md` §1 技术栈（锁定）](./AGENTS.md#1-技术栈锁定) 和 [§2 编码规范（硬约束）](./AGENTS.md#2-编码规范硬约束)。
本节不重复。

---

## 4. 已识别的风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | CodeBuddy CLI `--resume` / stream-json / ACP 语义随版本演进漂移 | 用 `scripts/spike-a-probe.sh` 做回归探针；M1 固定一版 CLI 行为基线 |
| R2 | cnb.cool API 的 batch-by-id / labels 过滤 / custom fields 仍有能力缺口 | 在 §11 正式吸收 3 处降级：并发单查、客户端二次过滤、label 前缀承载元数据 |
| R3 | 最新版 SPEC 要求的 dynamic reload / observability / test matrix 尚未写入正式契约，且实现也仅到最小骨架 | 先补 `§5/§6/§13/§17/§18`，并同步推进 `typescript/` 的 orchestration / runner 主流程 |
| R4 | 切 TS 后团队心智成本 | 可控；harness-f1 生态本身也是 Node 主导 |
| R5 | Node 无 OTP 级监督树 | 已在 §14 承认，以 "Node 子进程 + 心跳 + 崩溃重启" 作为语义等价实现 |

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
| v0.7 | 2026-05-18 | 基于最新版 `symphony/SPEC.md` 重评项目差距：`PLAN.md` 明确标出 18 章 + Appendix A 映射、滞后章节、可执行补齐清单，并同步修正 M0 里程碑、TS 目录骨架与风险表 |
| v0.8 | 2026-05-19 | README 收敛为项目说明文档；PLAN 将已完成的 M0 文档/骨架事项与仍打开的 M1 缺口分开表述，避免把已落地内容继续记为待办 |
| v0.9 | 2026-05-23 | M1 运行时闭环完成：daemon status API 接入、scheduler 支持外部 refresh tick、README/PLAN 收口为 M1 已完成并把后续能力移动到 M2/M3/M4 |
| v1.0 | 2026-05-24 | M2 起步：baseline / diff-baseline 纳入自动化测试并接入 `typescript` 包脚本，README 快速开始同步收口 |
| v1.1 | 2026-05-24 | runner 细化审批相关事件映射：新增 `notification` / `approval_auto_approved` 语义与对应测试，并补出 `baseline:diff` 包脚本 |
| v1.2 | 2026-05-24 | M2 收口：新增 continuation cycle 行为测试，补齐 multi-turn resume / approval retry 验证，并将里程碑状态切换为 M2 已完成 |
| v1.3 | 2026-05-25 | M3 预备：dispatch 选择逻辑补齐 `max_concurrent_agents_by_state` 限流实现与测试，收束为 worktree / 更完整并发运行时前的最后单机调度增量 |
| v1.4 | 2026-05-25 | M3 第一阶段：workspace lifecycle 接入 `git-worktree` 模式、`workspace.source_root` 配置解析、preflight 校验与创建/清理测试，完成 per-task worktree 基础闭环 |
