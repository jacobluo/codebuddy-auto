# PLAN.md 项目计划

> **状态**：M0 / M1 / M2 / M3 已完成；PLAN 正在继续补齐正式契约章节。本文件是 codebuddy-auto 的**项目计划 + 契约主干**，
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
| Dashboard | 已实现为 status-server 首页 | `GET /` 基于 `/api/v1/state` 渲染仪表盘 |
| Worker | `local | ssh` 双模式已落地 | M4 补齐 RemoteWorker（SSH transport） |
| 对标策略 | **契约完整对齐 Symphony，实现分阶段落地** | 非降维，是插件化 + 分期 |

---

## 1. 里程碑

| 里程碑 | 状态 | 契约章节（PLAN） | 实现（`typescript/`） |
|---|---|---|---|
| **M0** | 🟢 已完成 | 18 章 + Appendix A 的差距映射、spike 结论、roadmap 骨架 | 两份 spike 文档 + `PLAN.md` 与最新版 SPEC 的差距分析对齐 |
| **M1** | 🟢 已完成 | 将 PLAN 中与单机最小调度器直接相关的章节补成可实现契约 | `typescript/` 已闭环单机调度主流程：poll/reconcile/continuation/retry/workspace cleanup/daemon status API |
| **M2** | 🟢 已完成 | continuation、baseline 闭环、多 turn 相关章节细化 | continuation / multi-turn 主路径、baseline / diff-baseline 脚本闭环、approval/notification 事件映射与自动化测试已补齐 |
| **M3** | 🟢 已完成 | 并发调度、git worktree、安全边界进一步细化 | `max_concurrent_agents` 多 issue 并发、per-task git worktree 生命周期、安全 preflight，以及 scheduler 各阶段 partial-failure 容错已完成 |
| **M4** | 🟢 已完成 | dashboard / remote worker extension 契约补齐 | Dashboard（`GET /` + status API）+ RemoteWorker（`worker.kind: ssh`）已落地 |

---

## 2. 正式契约章节主线

本节开始作为 `PLAN.md` 的正式正文主线，按上游 Symphony SPEC 的 `§1 ~ §18 + Appendix A` 组织。
后文迁移差距分析仅保留为补充材料，不再充当实现主线。

### 2.1 章节目录

| 章节 | 状态 | 范围 |
|---|---|---|
| `§1` Problem Statement / Project Positioning | 🟢 | 定义 codebuddy-auto 解决的问题、与 Symphony 的对位关系、handoff 边界 |
| `§2` System Overview | 🟢 | 组件分层、依赖方向、外部依赖、运行时边界 |
| `§3` State Schema | 🟢 | `Issue / WorkflowDefinition / Workspace / RunAttempt / RetryEntry / RuntimeState` |
| `§4` Tracker Integration Contract | 🟢 | `CNBTracker / LocalTracker` 抽象、归一化、错误面、读写边界 |
| `§5` Workflow Specification | 🟢 | `WORKFLOW.md` 路径发现、front matter、prompt body、严格模板规则 |
| `§6` Configuration Specification | 🟢 | typed config、默认值、路径解析、reload、preflight、关键字段摘要 |
| `§7` Orchestration State Machine | 🟢 | `Unclaimed / Claimed / Running / RetryQueued / Released` 与 11 阶段 run lifecycle |
| `§8` Polling / Scheduling / Reconciliation | 🟢 | poll tick、候选筛选、并发限制、retry/backoff、startup cleanup |
| `§9` Workspace Management and Safety | 🟢 | workspace layout、create/reuse、hooks、git worktree、自愈与安全不变量 |
| `§10` Agent Runner Protocol | 🟢 | CodeBuddy CLI launch contract、事件映射、timeout/error mapping |
| `§11` Token / Runtime / Rate-Limit Accounting | 🟢 | totals 聚合、delta 去重、seconds running、latest rate-limit snapshot |
| `§12` Prompt Construction | 🟢 | issue + attempt 注入、continuation prompt、失败语义 |
| `§13` Logging / Status / Observability | 🟢 | pino 字段、runtime snapshot、human-readable status、HTTP status API |
| `§14` Failure Model and Recovery | 🟢 | config/workspace/runner/tracker/observability 故障与恢复策略 |
| `§15` Security and Operational Safety | 🟢 | trust boundary、secret handling、hook 风险、filesystem safety |
| `§16` Reference Algorithms | 🟢 | startup / tick / reconcile / dispatch / worker attempt / on-exit 伪代码 |
| `§17` Test Matrix | 🟢 | Core Conformance、扩展验证、真实集成烟测 |
| `§18` Definition of Done | 🟢 | REQUIRED / RECOMMENDED checklist 与交付门槛 |
| `Appendix A` SSH Worker Extension | 🟢 | RemoteWorker 扩展边界，明确不属于当前本地主线 |

### 2.2 `§1` Problem Statement / Project Positioning

**状态**：🟢 已起草

- `codebuddy-auto` 的目标不是复刻 Symphony 的具体后端实现，而是在本地 Node.js 环境中提供一套与其调度语义对齐的参考实现。
- 本项目要解决的问题固定为：持续读取 tracker issue、为每个 issue 创建隔离工作目录、驱动 CodeBuddy CLI 执行多轮 coding turn、维护 retry / reconciliation / cleanup，并对外暴露最小运行态观察面。
- 与上游 Symphony 的等价替换关系固定为：`Linear -> cnb.cool`、`Codex app-server -> CodeBuddy Code CLI`、`Elixir/OTP orchestration -> Node subprocess orchestration`。
- 本项目的 handoff 边界固定在“把一个 issue 从可派发状态推进到 workflow 所定义的 handoff state”。handoff state 可以是 tracker 的终态，也可以是“等待人工 review / 等待外部合入”等中间态，不强制等于 `Done`。
- 本项目负责 orchestration，不负责组织级业务策略。是否评论 issue、是否开 PR、如何写变更说明，默认交给 workflow prompt 引导 agent 自主完成，而不是写死在 scheduler 中。
- Non-Goals 固定包括：不接入 Linear、不复刻 OTP 监督树、不在当前主线内实现 RemoteWorker、不把 Dashboard 当作主流程前提。
- 本项目默认运行于高信任本地环境，目标是“工程上可靠的本地编排器”，不是“可对抗恶意 agent / 恶意 hook 的强隔离沙箱”。
- conformance 主线固定为 LocalWorker。RemoteWorker 与 richer dashboard 只作为后续扩展，占位存在但不参与当前最小闭环定义。

### 2.3 `§2` System Overview

**状态**：🟢 已起草

- 系统组件固定分为七层：`workflow loader`、`config layer`、`tracker client`、`scheduler/orchestrator`、`workspace manager`、`agent runner`、`logging/status surface`。
- `spec/` 是共享类型中枢，向下为所有模块提供统一 schema 与 runtime types；除 `spec/` 外，依赖方向必须保持单向，禁止底层反向依赖 scheduler。
- 运行期权威状态只存在于 scheduler：`running`、`claimed`、`retryAttempts`、`completed` 都由 scheduler 持有并驱动变迁。
- tracker 层只负责把外部 ticket 系统归一化为 `Issue` 流，不持有调度状态，也不直接了解 session、workspace、retry timer。
- workspace 层只负责 issue 到目录的映射、目录创建/复用/移除、hook 执行与 git worktree 生命周期；它不决定 issue 是否应该继续运行。
- runner 层只负责把 CodeBuddy CLI 进程抽象成可消费事件流；它不决定 issue release、cleanup、tracker writes 或整体调度顺序。
- logging/status 层只消费运行态并向外投影，不反向影响 dispatch 决策；即使状态面异常，主调度流程也应尽量继续。
- 外部依赖固定为：cnb.cool API、本地文件系统、CodeBuddy CLI、可选 git CLI、宿主环境变量与认证材料。
- 运行面最小入口固定为：读取 `WORKFLOW.md`，载入有效 config，完成 startup cleanup，然后进入定时 tick；可选通过 status server 触发额外 refresh tick。

### 2.4 `§3` State Schema

**状态**：🟢 已起草

本章定义所有跨模块共享实体。约束原则只有一条：外部输入先在边界处做 zod `parse()`，进入调度器后只流动规范化对象。

- `Issue` 是 tracker 归一化后的权威 ticket 视图，当前最小字段集固定为：`id`、`identifier`、`title`、`description`、`priority`、`state`、`branchName`、`url`、`labels`、`blockedBy`、`createdAt`、`updatedAt`。
- `Issue.labels` 一律为字符串数组；`Issue.blockedBy` 一律为 `{ id, identifier, state }[]`；未知字段不得在调度核心内部隐式透传。
- `WorkflowDefinition` 固定为 `{ config, promptTemplate, workflowPath }`。其中 `config` 保留 front matter 的原始对象视图，`promptTemplate` 是 trim 后的正文模板，`workflowPath` 必须是绝对路径。
- `ServiceConfig` 是 workflow front matter 经默认值合并、路径解析、schema 校验后的类型化运行时配置；它是 `scheduler / runner / workspace / logging` 的唯一配置输入。
- `WorkspaceState` 固定为 `{ path, workspaceKey, createdNow }`。`path` 必须位于 `workspace.root` 内；`workspaceKey` 来自 issue identifier 的稳定 sanitize；`createdNow` 区分复用目录与本轮新建目录。
- `RunAttemptContext` 固定为 `{ issue, workspacePath, workspaceCreatedNow, runningEntry }`，用于把 workspace 初始化结果与首轮运行态一次性交给 dispatch。
- `RunningEntry` 是单个 issue 的活动运行态快照，当前字段固定为：`issue`、`workspacePath`、`sessionId`、`startedAt`、`turnCount`、`lastEvent`、`lastEventAt`、`secondsRunning`、`tokenUsage`、`lastReportedTotals`。
- `RunningEntry.sessionId` 表示 CodeBuddy 会话标识。首轮拉起前允许为 `null`；拿到 `session_started` 事件后必须落入该字段；continuation 轮次必须复用该 session id。
- `RunningEntry.turnCount` 记录当前 issue 已完成或正在处理的 turn 数。首轮 dispatch 结束后为 1；每次 continuation 成功或被显式消费后递增。
- `tokenUsage` 保存对外展示用累计 totals；`lastReportedTotals` 保存 provider 最近一次 absolute totals，用于把增量事件去重折算为稳定聚合值。
- `RetryEntry` 固定为 `{ issueId, identifier, mode, attempt, dueAtMs, error }`，其中 `mode` 仅允许 `continuation | failure`。
- `RetryEntry.attempt` 表示同一 retry mode 下的第几次调度；`continuation` 模式使用固定 1 秒重试；`failure` 模式使用指数回退并受 `agent.maxRetryBackoffMs` 限制。
- `OrchestratorRuntimeState` 固定由 `running`、`claimed`、`retryAttempts`、`completed`、`progress`、`stuck` 六部分构成，且 `scheduler` 是其唯一权威持有者。
- `claimed` 表示本进程已占有但不一定正在运行的 issue id 集合，覆盖 `running` 与“等待 dueAt 的 retry issue”；`completed` 只记录本进程观察到已完成主流程的 issue id，用于 snapshot 和后续清理判断。
- `progress` 保存每个 issue 最近一次 turn 边界的 workspace/tracker 指纹；`stuck` 保存本进程内暂停自动续跑的 issue 及原因。二者是 progress-gate 增强层，不是 tracker handoff 真相源。
- tracker 返回的新 `Issue` 快照可以替换 `runningEntry.issue` 中的元数据字段，但不得回写或重写 `sessionId`、`tokenUsage`、`turnCount` 这类编排期状态。

### 2.5 `§4` Tracker Integration Contract

**状态**：🟢 已起草

- 当前标准 tracker backend 固定为 `CNBTracker` 与 `LocalTracker`。前者面向真实 cnb.cool 仓库 issue；后者面向本地 JSON 文件集，用于测试与离线试运行。
- tracker 抽象面固定为三个只读方法：`fetchCandidateIssues()`、`fetchIssuesByStates(states)`、`fetchIssueStatesByIds(issueIds)`。scheduler 不依赖额外私有接口。
- `fetchCandidateIssues()` 返回“可能可派发”的 issue 列表；最终是否真的 dispatch 由 scheduler 再根据 claimed/running/retry/blocker/concurrency 做二次筛选。
- `fetchIssuesByStates()` 主要用于 startup cleanup；`fetchIssueStatesByIds()` 主要用于 reconciliation，不要求返回完整 issue，只要求返回 state refresh 所需最小字段。
- tracker 必须负责把后端 payload 归一化为 `Issue`，包括 labels、blockedBy、priority、state、createdAt、updatedAt 等字段收口；调度核心不得散落后端特定字段解析逻辑。
- 对 cnb backend，当前能力降级必须被正式吸收：没有 batch-by-id 接口时允许 `fetchIssueStatesByIds()` 逐个 issue fan-out；labels 过滤能力不足时允许客户端二次过滤；custom fields 不可用时允许 label 前缀或既有字段承载最小元数据。
- `CNBTracker.fetchCandidateIssues()` 当前以 candidate label 为主过滤，并剔除 exclude label；这属于 backend 适配细节，不改变 scheduler 的通用候选选择语义。
- tracker 失败按调用场景分层处理：candidate fetch failure 影响本轮 dispatch；running refresh failure 只影响 reconciliation；startup cleanup fetch failure 不得阻断 daemon 存活。
- scheduler 默认只读 tracker。comment、PR、state transition 等写操作原则上由 agent 借助工具自行执行，而不是由 tracker contract 内建承诺。
- 任何进入系统的 tracker 外部响应都必须在边界处经 schema 校验后再流入调度器；不得在 scheduler 内部以 `as Issue` 的方式兜底。

### 2.6 `§5` Workflow Specification

**状态**：🟢 已起草

- workflow 文件入口固定为仓库内 `WORKFLOW.md`。路径解析优先级固定为：显式传入路径优先，未传入时默认取当前工作目录下的 `WORKFLOW.md`。
- `resolveWorkflowPath()` 必须返回绝对路径，并显式标记本次解析是否来自默认路径，便于 CLI 与日志区分“显式指定”与“默认发现”。
- 文件格式固定为 `YAML front matter + Markdown body`。没有 front matter 时，`config` 视为 `{}`，整个文件正文在 trim 后作为 prompt template。
- 存在 front matter 时，YAML 顶层必须解码为对象；数组、标量、`null` 都视为非法 workflow 格式。
- `promptTemplate` 在载入时就做 trim，避免前后空行在首轮 prompt 和 continuation prompt 中引入不稳定差异。
- front matter 只承担配置输入职责；调度运行时不得直接消费未经类型化的 `workflow.config` 字段，必须经 `loadServiceConfig()` 转换为 `ServiceConfig` 后再使用。
- prompt 渲染上下文当前固定为：`{ issue, attempt: { turnCount } }`。章节未声明的额外变量一律不得注入。
- 模板渲染采用 strict mode：未知变量路径、访问到不存在的对象路径、以及值类型不是字符串或数字时，必须立即抛错。
- strict mode 不允许静默留空，不允许把未识别变量原样输出到 prompt。任何模板错误都要被视为可诊断故障，而不是“尽量跑起来”。
- workflow read / parse / validation 失败属于配置错误：启动阶段阻止 daemon 进入可派发状态；reload 阶段保留上一份 last-known-good runtime，只暴露错误并暂停新派发。
- workflow 章节只定义 prompt 源文件与模板边界；issue comment、PR 描述、tracker writes 等业务文案由 agent 自行通过工具执行，不属于 workflow contract。

### 2.7 `§6` Configuration Specification

**状态**：🟢 已起草

- 配置解析顺序固定为：`defaults -> workflow front matter -> alias normalization -> path/env normalization -> typed validation -> preflight`。
- `defaults` 由 `DEFAULT_SERVICE_CONFIG` 提供，当前至少覆盖 tracker、polling、workspace、hooks、server、agent、codebuddy 七个分组。
- front matter 的命名允许保留 snake_case 输入，但进入运行时后必须统一转成 camelCase 字段。例如：`workspace.source_root -> workspace.sourceRoot`、`agent.max_concurrent_agents -> agent.maxConcurrentAgents`、`codebuddy.turn_timeout_ms -> codebuddy.turnTimeoutMs`。
- 路径与环境变量解析规则固定如下：`$VAR` 先做环境变量替换；`~/...` 展开到 `$HOME`；非绝对路径一律相对 `WORKFLOW.md` 所在目录解析。
- 当前必须做路径解析的字段包括：`workspace.root`、`workspace.sourceRoot`、`codebuddy.mcpConfig`、`codebuddy.addDirs[]`。
- 当前必须做环境变量解析的字段包括：`tracker.apiKey`，以及所有声明为路径值的字符串在做路径解析前也要先过一遍环境变量展开。
- 类型校验由 `serviceConfigSchema.parse()` 完成。非法值必须在边界处失败，禁止在后续模块内部使用 `as ServiceConfig` 逃过校验。
- preflight 属于“运行前环境校验”，与 schema 校验分层处理。schema 负责结构和值类型；preflight 负责文件系统、git repo、必需认证材料等宿主条件。
- 当前 preflight 最低要求包括：`tracker.kind` 非空、`tracker.apiKey` 非空、cnb 模式下 `endpoint/projectSlug` 非空、`codebuddy.command` 非空、`workspace.root` 存在。
- 当 `workspace.mode = git-worktree` 时，preflight 还必须校验：`workspace.sourceRoot` 存在且为 git 仓库，且 `workspace.root` 与 `workspace.sourceRoot` 不得相等、不得互相嵌套。
- reload 失败时，daemon 继续沿用上一份有效的 `tracker/config/promptTemplate`。错误只进入日志与状态面，不得把正在运行的 scheduler 主循环打挂。
- 配置章节只定义解释规则，不承诺“热更新后立即重建所有运行中的 issue 上下文”；正在运行的 attempt 以启动该 attempt 时拍下的配置快照为准。

### 2.8 `§7` Orchestration State Machine

**状态**：🟢 已起草

> **Update (2026-05-31, change `sdk-multi-turn-worker`)**: state-machine entries
> below assume the legacy "scheduler drives one CLI turn per tick + 1s
> continuation retry" model. That still applies to `worker.kind === 'ssh'`. For
> `worker.kind === 'local'` the multi-turn loop is now driven inside the
> `IssueWorker` (one async function per issue), and `runContinuationCycle` is
> not invoked. Reconciliation flips `WorkerHandle.gracefulExitRequested = true`
> so the worker exits at its next turn boundary instead of having
> `state.running` ripped out from under it. See spec
> `openspec/specs/sdk-multi-turn-worker/spec.md`.

- issue 编排状态主链固定为：`Unclaimed -> Claimed -> Running -> RetryQueued -> Released`，并允许通过 progress-gate 增强层进入 `Stuck` 暂停态。
- `Unclaimed` 表示 issue 仅存在于 tracker 视图中，本进程尚未占有它。
- `Claimed` 表示 issue 已被本进程占有，但当前可能尚未启动 runner，或正在等待 retry due time 到达。
- `Running` 表示 issue 在 `state.running` 中存在活动运行态，并可能伴随一个 continuation retry entry。
- `RetryQueued` 是 Claimed 的子语义，表示 issue 已计划下一次 continuation/failure retry，必须继续保留 claim，直到 dueAt 到达或 issue 被 release。
- `Stuck` 表示 issue 在本进程内被暂停自动续跑，原因包括 `no_progress` 或 `max_turns_reached`。它不等同于完成，不自动写 tracker label，也不运行项目验证命令。
- `Released` 表示 issue 已从本进程的 `running / claimed / retryAttempts` 中移除，并可视情况进入 completed 或 workspace cleanup 路径。
- 单次 attempt 生命周期可细分为：`SelectingIssue`、`PreparingWorkspace`、`RunningBeforeHook`、`BuildingPrompt`、`BuildingCommand`、`LaunchingAgentProcess`、`ReadingStream`、`ClassifyingResult`、`SchedulingNextStep`、`RunningAfterHook`、`FinalizingRuntimeState`。
- 正常首轮 dispatch 的状态迁移为：candidate selected -> claimed -> attempt success -> running persisted -> continuation retry queued。
- 正常 continuation 的状态迁移为：retry due -> attempt resumed -> running updated -> 记录 progress fingerprint -> 若未达 maxTurns 且未触发 no-progress threshold 则 continuation retry re-queued，否则进入 stuck 并等待 tracker/reconciliation 或人工处理。
- 异常路径的核心触发器固定为：workspace setup failure、beforeRun failure、runner event failure、timeout/stall、unexpected throw、retry timer fired、reconciliation release、startup cleanup。
- 单个 issue 的异常必须尽量收口为 issue 级 retry 或 release，不得把同轮其他 issue 的状态迁移一并回滚。

### 2.9 `§8` Polling / Scheduling / Reconciliation

**状态**：🟢 已起草

- scheduler tick 顺序固定为五步：释放到期 retry claim、reconcile active runs、reconcile stuck issues 的 tracker handoff/inactive 状态、执行 continuation cycle、执行 dispatch cycle。
- “释放到期 retry claim” 只针对 `dueAtMs <= now` 且当前不在 `running` 中的 retry entry；释放时同时删除 retry entry 与 claimed 标记，使该 issue 重新进入可派发候选集。
- reconciliation 只刷新当前 `running` issue 的 tracker state，不扫描全量 tracker。其职责是识别已脱离活动态的 issue，并决定是否 cleanup workspace。
- reconciliation release 的判定固定为：tracker 不再返回该 issue，或其 state 已进入 terminalStates。前者通常表示 issue 已不可见或已不再需要本地继续持有；后者表示可按终态策略进入 cleanup。
- stuck reconciliation 的判定固定为：stuck issue 如果收到配置的 finish label、离开 active states、进入 terminalStates，或 tracker 不再返回，则按正常 handoff/release 规则清理本进程的 stuck/progress bookkeeping。
- continuation cycle 只处理已到期的 retry entry，且要求对应 running entry 仍存在；若 running entry 已不存在，则应直接清理 retry bookkeeping。
- dispatch cycle 先取 tracker candidates，再按 active state、非 terminal、非 claimed、非 running、非 stuck、非 blocked、并发配额、priority/createdAt 排序规则做筛选。
- blockedBy 规则当前固定为：仅当 issue 本身处于 `todo` 状态时，若存在 blocker 且 blocker.state 非 `closed`，则视为 blocked，不参与 dispatch。
- 并发控制同时受全局 `agent.maxConcurrentAgents` 与分状态 `agent.maxConcurrentAgentsByState` 约束；分状态限流按 issue 当前 state 的小写归一化结果计算。
- retry 语义固定为两类：`continuation` 使用固定 1000ms；`failure` 使用指数回退并受 `agent.maxRetryBackoffMs` 上限限制。
- startup cleanup 与 reconciliation cleanup 都必须坚持“单项失败不打断整轮”原则：记录首个错误，继续处理其余 issue。
- refresh API 触发的额外 tick 与定时 tick 共享同一执行路径，不允许出现两套分叉调度逻辑。

### 2.10 `§9` Workspace Management and Safety

**状态**：🟢 已起草

- workspace root 下每个 issue 对应一个稳定的 sanitized workspace key。issue identifier 到目录名的映射必须稳定且可重复计算。
- 任意最终 workspacePath 都必须先通过 path containment 校验，确保路径位于配置的 `workspace.root` 内，防止路径穿越或异常拼接。
- 当前支持两种模式：`directory` 与 `git-worktree`。两种模式都必须支持 create-or-reuse 语义，同一 issue 的 workspace 允许跨轮次复用。
- `directory` 模式下，若目录已存在且是合法目录，则视为复用；不存在时递归创建。
- `git-worktree` 模式下，若目录不存在，则必须先对 source repo 执行 `git worktree prune`，再执行 `git worktree add --detach <workspacePath> HEAD`；若目录已存在则视为复用。
- `git-worktree` 模式的前置不变量固定为：`workspace.sourceRoot` 必须存在、必须是 git 仓库、不得与 `workspace.root` 相等、两者不得互相嵌套。
- hook 语义固定如下：`afterCreate` 仅在本轮新建 workspace 后执行，失败时必须回滚新建目录或 worktree；`beforeRun` 失败中止本次 attempt 并转入 retry；`afterRun` 失败只记日志；`beforeRemove` 失败不阻断最终 cleanup。
- remove 语义固定为 best-effort：目录模式下用递归删除；worktree 模式下执行 `git worktree remove --force` 后再执行 `git worktree prune`，减少 stale metadata 堆积。
- 当 worktree 目录被外部删除时，cleanup 仍必须尽量清理 git admin metadata，避免 stale worktree 记录阻断后续重建。
- workspace 层不负责拷贝仓库、切分支或决定 PR 提交流程；它只保证 issue 有一个隔离、可重复进入、可清理的工作目录。

### 2.11 `§10` Agent Runner Protocol

**状态**：🟢 已起草

> **Update (2026-05-31, change `sdk-multi-turn-worker`)**: §10 below describes the
> SSH (`worker.kind === 'ssh'`) realization, which still spawns a CodeBuddy CLI
> subprocess per turn and resumes by `--session-id` / `--resume`. **Local mode
> (`worker.kind === 'local'`) now satisfies SPEC §10.3 long-lived-thread
> semantics**: a single `unstable_v2_createSession` is opened on dispatch and
> reused for every continuation turn within one worker, so the CodeBuddy CLI
> subprocess stays alive across turns. The local-mode invariants live in
> `openspec/specs/sdk-multi-turn-worker/spec.md`; the §10 contract below
> applies to SSH only.

- runner 分为两层：`buildCodebuddyCommand()` 负责把类型化配置翻译成 CLI 启动参数；`runCodebuddyTurn()` 负责执行子进程、消费事件流、做 timeout 与错误归一。
- 启动命令固定以 `codebuddy.command` 为基底，并强制附加 `--print --output-format stream-json`，确保 stdout 可被稳定消费。
- 首轮 attempt 必须显式传入 `--session-id <sessionId>`；continuation attempt 必须传入 `--resume <existingSessionId>`，不得为 continuation 新建会话。
- runner 必须把以下配置字段翻译到 CLI：`agent.maxTurns`、`codebuddy.permissionMode`、`codebuddy.subagentPermissionMode`、`codebuddy.sandbox`、`codebuddy.tools`、`codebuddy.allowedTools`、`codebuddy.disallowedTools`、`codebuddy.addDirs`、`codebuddy.mcpConfig`、`codebuddy.mcpStrict`、`codebuddy.dangerouslySkipPermissions`。
- `command.cwd` 固定为 issue 对应的 workspace 路径；runner 不得在仓库根目录直接执行 agent 进程。
- stdout 协议固定为逐行 NDJSON。每行都要先 `JSON.parse()`，再经 zod union 校验；不匹配 schema 的行统一映射为 `malformed` 事件，而不是直接崩溃整个 attempt。
- 当前标准事件映射如下：
- `system/init -> session_started`
- `result + approval_auto_approved -> approval_auto_approved`
- `result + permission_denials -> turn_input_required`
- `result + is_error=true -> turn_failed`
- `result + success -> turn_completed`
- `assistant -> notification`
- `message` 与 `file-history-snapshot` 等未升级为领域语义的消息先映射到 `other_message`
- runner 必须同时监听 stdout 与 stderr。stderr 行要保留到结果对象里，供 scheduler 在失败日志与 retry error 中引用。
- timeout 语义固定分三类：`readTimeoutMs` 表示“启动后迟迟无任何输出”；`turnTimeoutMs` 表示整轮执行超时；`stallTimeoutMs` 表示已有输出但长时间无新输出。三者都需要通过 kill 子进程触发收口，并映射成可辨识事件。
- 子进程退出码本身不是唯一真相。scheduler 应优先看归一后的最后领域事件，再结合退出码与 stderr 做 retry 分类。
- runner 只负责把 provider 事件流压缩为本地事件，不直接做 tracker 写操作，也不直接决定 release/cleanup；这些决策全部留给 scheduler。

### 2.12 `§11` Token / Runtime / Rate-Limit Accounting

**状态**：🟢 已起草

- token 核算以 provider 报出的 absolute totals 为主，不以“本次事件的 delta”直接累加。当前 `RunningEntry.lastReportedTotals` 就是去重基线。
- 当 provider 只在某些事件中重复上报累计 usage 时，`updateTokenUsage()` 必须使用“本次 absolute totals - 上次 absolute totals”的差值更新 `tokenUsage`，避免重复累计。
- 当前累计字段固定为：`inputTokens`、`outputTokens`、`totalTokens`、`cacheCreationInputTokens`、`cacheReadInputTokens`、`creditCost`。
- `totalTokens` 是展示聚合值，必须与输入/输出/缓存字段保持一致来源；不得混入人工估算值。
- `secondsRunning` 属于 issue 级 runtime 指标，保存在 `RunningEntry` 中，并在 snapshot 层做全局聚合。
- runtime snapshot 的 totals 只聚合当前 `running` 集合，不追溯已 completed issue 的历史消耗。这意味着 status API 反映的是“当前活跃运行面”，不是长期账本。
- rate-limit snapshot 仍是预留扩展位。当前 runner 尚未稳定暴露结构化 rate-limit 事件，因此本章只固定语义位置，不要求现有 status API 输出该字段。
- 一旦后续 runner 补齐 rate-limit 事件，新增字段必须遵循“latest snapshot wins”原则，而不是把 rate-limit 当累计量相加。

### 2.13 `§12` Prompt Construction

**状态**：🟢 已起草

- 首轮 dispatch prompt 固定来自 workflow 正文模板，渲染上下文为 `issue` 与 `attempt.turnCount = 1`。
- continuation prompt 不再回读 workflow 正文，而是使用固定 continuation template。当前模板语义固定为提示 agent 进入“第 N 次 continuation turn”，并注入递增后的 `attempt.turnCount`。
- continuation prompt 的目标不是重述整张 issue，而是承接同一 CodeBuddy session 的上下文，因此必须与 `--resume` 一起使用。
- prompt construction 必须保证 issue 隔离：一个 issue 的 prompt、session id、workspacePath 不得复用到另一个 issue。
- 模板渲染失败属于当前 issue 的 attempt failure，必须进入 retry/backoff 路径，并记录可诊断错误字符串；不得因为单个 issue 的 prompt 失败阻断同轮其余 issue。
- prompt construction 不负责注入 tracker 写操作指令、PR 模板或组织级隐式规则；这类组织策略应由 workflow 正文显式表达。
- 当前 contract 只承诺 `issue` 与 `attempt.turnCount` 两组变量。若未来新增变量，必须先在本章登记，再同步到 `renderPrompt()` 的 strict schema。

### 2.14 `§13` Logging / Status / Observability

**状态**：🟢 已起草

- 日志实现固定为 `pino`。除 CLI 入口打印给人看的状态文本外，运行时结构化日志不得退回 `console.*`。
- issue-scoped log context 最低字段集固定为：`issueId`、`issueIdentifier`、`sessionId`、`turnCount`、`retryMode`、`retryAttempt`、`retryDueAtMs`、`lastEvent`。
- runtime snapshot 是 dashboard、CLI status、HTTP status API 的共同数据源，当前 shape 固定为：`generatedAt`、`counts`、`cleanedWorkspaceIssueIds`、`totals`、`running[]`、`retrying[]`、`completedIssueIds[]`。
- `counts` 至少包含 `running`、`retrying`、`claimed`、`completed` 四个整数；`running[]` 按 `identifier` 排序；`retrying[]` 按 `dueAtMs` 再按 `identifier` 排序。
- human-readable status surface 只做 snapshot 的文本投影，不引入新的运行时事实来源。人类可读输出与 HTTP JSON 输出必须来自同一份底层快照。
- 最小 HTTP status API 当前固定提供：`GET /`、`GET /api/v1/state`、`GET /api/v1/<issue_identifier>`、`POST /api/v1/refresh`。
- `POST /api/v1/refresh` 的职责仅是向 scheduler 排队一次额外 tick，请求语义固定为“触发 poll + reconcile”；它不保证立即执行完毕。
- observability sink failure 不得打挂 orchestration 主流程。即使状态服务未启动、snapshot 序列化失败或日志下游异常，issue 调度也应尽量继续。
- Dashboard 已作为 `GET /` 的 SPA 页面落地，但它仍只是 `§13` 的展现层扩展，不得反向定义或篡改 runtime snapshot contract。

### 2.15 `§14` Failure Model and Recovery

**状态**：🟢 已起草

- failure class 固定分为五类：workflow/config、tracker、workspace、runner/session、observability。
- workflow/config failure 发生在解析、schema 校验、preflight 或 reload 阶段。启动时这类错误阻止新一轮服务进入可派发状态；reload 时则保留 last-known-good runtime，并继续让 daemon 存活。
- tracker failure 需要按调用点区分：candidate fetch failure 影响本轮 dispatch；reconciliation refresh failure 只让该轮 running release 判定缺席；startup cleanup failure 只记录错误，不阻断后续 tick。
- workspace failure 包括 create/reuse/remove、path containment、hook 执行、git worktree 管理失败。其默认收口策略是 issue 级 retry，除非错误发生在 cleanup 路径，则记录首个错误并继续其余 cleanup。
- runner/session failure 包括 malformed event、turn_failed、approval/input required、read timeout、turn timeout、stall timeout、以及进程级异常退出。其默认收口策略是 issue 级 retry，并保留最后领域事件与 stderr 供诊断。
- observability failure 包括 logger 下游异常、status server 未启动、snapshot 序列化失败等。这类故障不应反向打挂 orchestration 主流程。
- restart recovery 固定采用 tracker/filesystem 驱动，而不是尝试精确恢复内存中的 timer 和子进程现场。进程重启后重新读取 tracker、重新做 startup cleanup、重新进入 tick 即可。
- 本实现不承诺恢复“一个已经在外部终止的 CodeBuddy session 的精确继续点”；真正的恢复边界是 issue 重新进入候选队列，并按现有 tracker/workspace 状态重新编排。
- 所有“单个 issue 出错”的路径都应优先收敛为 issue 级隔离处理，避免出现“一次坏 issue 让整轮 tick 中断”的系统性故障放大。

### 2.16 `§15` Security and Operational Safety

**状态**：🟢 已起草

- 本项目默认运行在高信任本地环境。这里的“安全”目标是减少误操作和明显危险配置，不是提供可对抗恶意代码的强隔离边界。
- trust boundary 固定为：workflow 文件、hooks、CodeBuddy CLI 子进程、agent 生成的 shell/git 操作都应视为高权限执行面；scheduler 只做最小约束，不承诺把它们沙箱化到不可逃逸。
- secret handling 的最低要求是：认证材料优先来自环境变量或宿主已配置的 CLI 凭据，不写入 runtime snapshot，不主动写入日志，不通过 prompt 模板显式回显。
- 文件系统安全最低要求包括：workspace path containment、workspace key sanitize、禁止 `workspace.root` 与 `workspace.sourceRoot` 的危险重叠，以及只在 issue 对应 workspace 内启动 agent 进程。
- hook 风险必须被显式承认：`afterCreate`、`beforeRun`、`afterRun`、`beforeRemove` 都是任意代码执行点。它们只能用于受信任仓库和受信任操作者场景。
- `git-worktree` 模式的安全目标是“隔离工作目录”，不是“隔离仓库权限”。一旦 source repo 本身带有危险 hook、submodule 或脚本，worktree 仍会继承同一信任面。
- runner 层可通过 permission mode、sandbox、allowed/disallowed tools、MCP strict 等参数降低误操作概率，但这些选项属于风险缓解，不构成形式化安全证明。
- status server 只暴露运行态最小信息，不应输出 API token、原始环境变量、完整 prompt 或 agent 生成的敏感中间文件内容。
- 生产前的最小操作安全建议包括：专用工作目录、最小必要凭据、独立 git 身份、定期清理 workspaces、以及对 workflow/hooks 做代码审查。

### 2.17 `§16` Reference Algorithms

**状态**：🟢 已起草

- `startup(config, tracker)`
  1. 载入 workflow 与 typed config。
  2. 运行 schema validation 与 preflight；若失败则保留 last-known-good runtime 或终止启动。
  3. 对 tracker 中 terminal states 的 issue 执行 startup cleanup，记录首个 cleanup error 但继续其余项。
  4. 启动 scheduler interval，并立即触发首次 tick。
- `tick(state, tracker, config)`
  1. 释放所有到期且当前不在 running 中的 retry claim。
  2. 对 running issues 做 reconciliation，并对需要 cleanup 的 released issue 执行 best-effort workspace cleanup。
  3. 对 stuck issues 做 tracker handoff/inactive reconciliation，释放已完成或已不可继续的 issue。
  4. 执行 continuation cycle。
  5. 执行 dispatch cycle。
  6. 生成 runtime snapshot，写入日志与状态面。
- `reconcile(state, trackerStates, terminalStates)`
  1. 遍历每个 running issue。
  2. 若 tracker 已不再返回该 issue，或 issue state 已进入 terminalStates，则 release 该 issue。
  3. release 时清除 running、retryAttempts、claimed，并把 issue id 加入 completed。
  4. 若 release 原因为 terminal state，则标记后续 cleanupWorkspace=true。
- `dispatchOneIssue(issue)`
  1. 创建或复用 workspace；若失败则为该 issue 计划 failure retry。
  2. 运行 beforeRun hook；若失败则为该 issue 计划 failure retry。
  3. 渲染首轮 prompt，构造 CodeBuddy command，并在 workspace cwd 中执行。
  4. 若 turn 完成，则持久化 running entry、session id、token/runtime totals，并计划 continuation retry。
  5. 若 turn 失败或抛异常，则为该 issue 计划 failure retry。
  6. 运行 afterRun hook；若失败只记录日志。
- `runContinuation(issueId)`
  1. 读取 running entry 与到期 retry entry；若 running entry 已缺失则清理 retry bookkeeping。
  2. 用 continuation template 构造下一轮 prompt，并以 `--resume` 启动 CodeBuddy。
  3. 更新 running entry 的 turnCount、sessionId、lastEvent、secondsRunning、tokenUsage。
  4. 在成功 turn 边界记录 progress fingerprint；若连续无进展达到阈值，则写入 stuck 并停止自动 continuation。
  5. 若未达 maxTurns 且 `turn_completed` 且未 stuck，则计划下一次 continuation retry；若达到 maxTurns，则写入 `max_turns_reached` stuck 而不是贴 finish label。
  6. 若失败，则计划 failure retry。
- `onWorkerExit(issueId, result)`
  1. 提取最后领域事件、stderr、duration、usage。
  2. 将 provider 事件折算为 scheduler 可消费的 success / retry / release 信号。
  3. 所有非成功退出默认收敛为 issue 级 retry，而不是抛出到整轮 tick 顶层。

### 2.18 `§17` Test Matrix

**状态**：🟢 已起草

- `Core Conformance` 是当前本地单机实现的必测主线，至少覆盖：`spec` schema、workflow 解析与模板渲染、config 载入与 preflight、workspace create/remove/hook、tracker 归一化、runner 事件映射与 timeout、scheduler startup/reconcile/dispatch/continuation/retry、logging snapshot/status/http api、CLI 生命周期。
- `Extension Conformance` 覆盖非最小主线但已落地的附加能力，当前至少包括：`git-worktree` 模式、`maxConcurrentAgentsByState`、refresh API、baseline / diff-baseline 脚本。
- `Real Integration Profile` 用于真实依赖烟测，当前应保留给 CodeBuddy CLI 探针、cnb.cool API 探针，以及最小端到端本地试运行。
- 测试目录应继续镜像 `src/` 结构，确保每个核心模块都能在 `typescript/test/` 下找到一一对应的契约验证文件。
- 行为性修改默认先补失败测试，再补实现；文档章程中的 contract 变更也应尽量附带对照测试位置，避免章节与代码长期漂移。
- 对 runner、scheduler、workspace 这类时序敏感模块，优先使用可控 fake CLI、临时目录和可注入时钟/依赖，而不是依赖不稳定的真实外部环境。

### 2.19 `§18` Definition of Done

**状态**：🟢 已起草

- `REQUIRED`：
- 必须存在可解析的 `WORKFLOW.md`，并能通过 schema 校验与 preflight。
- 必须具备 LocalWorker 主线路径：candidate fetch、workspace create/reuse、首轮 dispatch、continuation、retry/backoff、terminal cleanup。
- 必须具备 issue 级隔离：独立 workspace、独立 session id、单个 issue 失败不阻断同轮其他 issue。
- 必须具备最小可观测性：结构化日志、runtime snapshot、CLI status、HTTP status API。
- 必须具备自动化验证：核心模块测试通过，且与当前 contract 对应关系清晰。
- `RECOMMENDED`：
- 建议启用 `git-worktree` 隔离、真实 CodeBuddy CLI 探针、真实 cnb tracker 烟测。
- 建议在长期运行前验证 hook 风险边界、坏配置 reload 行为、以及异常退出后的 restart recovery 观测路径。
- RemoteWorker、Dashboard、更多 tracker writes 策略都属于扩展交付，不属于当前本地 conformance 的 Required 下限。

### 2.20 `Appendix A` SSH Worker Extension

**状态**：🟢 已起草

- RemoteWorker 已作为 M4 扩展落地，但仍不属于当前本地单机 conformance 的 Required 主线。
- 扩展目标固定为：把“issue 调度决策仍留在本地 scheduler”与“agent 实际执行发生在远端受管机器”两件事拆开。
- 即使引入 RemoteWorker，主合同也不改变：tracker、state schema、retry policy、reconciliation、observability 仍由本地主调度器负责。
- 需要新增的只是 worker transport contract，例如：远端 workspace 准备、远端 command launch、stdout/stderr/事件流回传、远端 cleanup、网络失败重试。
- RemoteWorker 必须显式处理 workspace locality：是把仓库同步到远端、在远端直接 clone/sourceRoot，还是通过共享文件系统挂载。该问题属于扩展层决策，不能污染 LocalWorker 主线。
- 网络错误、SSH 建连失败、远端磁盘不足、远端 git 环境异常等，都应在扩展实现中先映射回现有的 workspace/runner failure class，而不是发明第二套状态机。
- 当前实现采用 `ssh` CLI transport，仍不承诺连接复用策略、远端镜像分发方式或多机器调度算法。

## A. 迁移差距分析（对标最新版 Symphony SPEC）

上游 [`docs/references/symphony-spec.md`](./docs/references/symphony-spec.md) 已扩展为 **18 章 + Appendix A**。
当前 `PLAN.md` 已建立正式章节主线，但本节仍保留为迁移补充材料，用于解释旧版差距判断与后续 roadmap，不再充当正文。

状态说明：

- `🔴` 严重滞后：章节边界或内容骨架已不足以承接最新版 SPEC
- `🟡` 部分滞后：主方向仍成立，但缺少最新版 SPEC 的关键约束
- `⚪` 未起草：方向已确定，但尚未落成文档

说明：以下差距判断保留为历史迁移快照，部分章节已在上文正式正文中补齐。

- `🟡` **§1 项目定位**：仍可沿用，但需补上最新版 SPEC 的 `Goals / Non-Goals / trust boundary / handoff state` 边界。
- `🟡` **§2 架构分层**：现仅覆盖组件名，缺少最新版 SPEC §3 的 `abstraction levels` 与 `external dependencies`。
- `🟢` **§3 State Schema**：正式正文已补齐第一版，后续只需在 Appendix / 算法章节里补更多对照说明。
  - 必补：`WorkflowDefinition`、`Workspace`、`RunAttempt`、`RetryEntry`、`Orchestrator Runtime State`
  - 必补：`Issue` 归一化规则、`session_id = <thread_id>-<turn_id>`、`claimed/completed/retry_attempts` 语义
- `🟢` **§4 Tracker 接口**：正式正文已补入 tracker 抽象、降级点与调用点级错误分类；后续仅需在参考文档中补更多上游逐章对照。
  - 现有方向仍对：`fetchCandidateIssues` / `fetchIssuesByStates` / `fetchIssueStatesByIds`
  - 必补：`candidate fetch failure / running refresh failure / startup cleanup failure` 的编排层行为
- `🟢` **§5 Agent 协议**：`§10 + §12` 的本地 runner/prompt contract 已补入正式正文，后续只需与更多真实 CLI 行为继续对齐。
  - 必补：launch contract、session startup responsibilities、streaming turn processing、emitted runtime events
  - 必补：approval / user-input policy、timeout & error mapping、prompt construction / retry / continuation semantics
- `🟢` **§6 Run 生命周期**：正式正文已补入编排状态机、tick 顺序、失败恢复与参考算法映射。
  - 必补：`Unclaimed / Claimed / Running / RetryQueued / Released`
  - 必补：`worker exit(normal|abnormal)`、`retry timer fired`、`reconciliation`、`stall timeout` 触发器
- `🟢` **§7 工作空间管理**：正式正文已补入 workspace layout、hook 语义、git-worktree 不变量与 cleanup 约束。
  - 必补：workspace layout / create-or-reuse / optional population / hooks failure semantics
  - 必补：hook 输出截断、trusted hook 风险声明
- `🟢` **§8 Workflow / Config 主线**：`§5 + §6` 正式正文已补齐，后续工作主要是边缘配置项补注。
  - 必补：workflow file path precedence、front matter schema、typed config resolution pipeline、dynamic reload semantics
  - 必补：validation error surface、`$VAR` / `~` / 相对路径解析规则
- `🟢` **§9 超时矩阵**：相关超时与 backoff 已在 `§6 / §10 / §14` 的正文契约中吸收。
  - 必补：与 `codex.command`、`hooks.timeout_ms`、`max_concurrent_agents_by_state` 一起并入 config cheat sheet
  - 必补：continuation retry 固定 `1000ms` 与 failure retry exponential backoff 的区别
- `🟢` **§10 配置校验 Preflight**：正式正文已补入 schema vs preflight 分层、reload 保活与危险路径校验。
  - 必补：startup validation vs per-tick validation
  - 必补：invalid reload 保留 `last known good config`，不能把服务打挂
- `🟢` **§11 Token 核算**：正式正文已补入 totals 聚合、delta 去重、secondsRunning 与 rate-limit 预留位。
  - 必补：`absolute totals` 优先级、delta 去重、`seconds_running` 聚合、latest rate-limit snapshot
- `🟢` **§12 可观测性**：`§13` 正式正文已补入 snapshot / status API / sink failure 约束。
  - 必补：logging conventions、sink failure behavior、runtime snapshot、human-readable status surface
  - 若实现 HTTP 扩展，还需补：`/api/v1/state`、`/api/v1/<issue_identifier>`、`/api/v1/refresh`
- `🟢` **§13 测试一致性**：`§17 + §18` 正式正文已补入测试矩阵与 DoD 第一版。
  - 必补：workflow/config parsing、workspace safety、tracker client、orchestrator、runner、observability、CLI lifecycle
- `🟢` **§14 Non-Goals**：项目定位、非目标与恢复边界已在 `§1 / §14 / §15 / §18` 正文中收口。
  - 必补：`restart recovery is tracker/filesystem-driven`、安全/硬化由实现显式声明
  - 保持不变：`Linear` 永不接入、Dashboard/SSH 延后、OTP 不做物理复刻

### 2.1 上游新增但本地尚缺的一级章节

以下内容在最新版 SPEC 中已成为一级章节或附录，但本地 `PLAN.md` 还没有显式章节承接：

- `🟢` **§15 安全与操作安全**：正式正文已补入 trust boundary、secret handling、hook 风险与最小操作安全边界。
- `🟢` **§16 参考算法**：正式正文已补入 startup / tick / reconcile / dispatch / continuation / on-exit 伪代码。
- `🟢` **§17 测试与验证矩阵**：正式正文已补入 Core / Extension / Real Integration 三档验证矩阵。
- `🟢` **§18 Implementation Checklist / DoD**：正式正文已补入 REQUIRED / RECOMMENDED 交付门槛。
- `🟢` **Appendix A SSH Worker Extension**：附录已建立，当前明确其为未来扩展且不污染本地主线。

### 2.2 结论

- 本项目方案**仍然可行**，因为核心替换关系没变：`Linear -> cnb`、`Codex app-server -> CodeBuddy CLI/ACP`、`Elixir/OTP -> Node subprocess orchestration`。
- 当前正式章节主线已补齐，剩余工作主要是清理迁移补充材料并同步外部引用文档。
- 当前 `typescript/` 的 M1/M2/M3 主线已完成，接下来的文档工作应集中在安全、参考算法与扩展附录，而不是再重写已落地主线。

### 2.3 可执行补齐清单

以下清单按“先补契约、再写代码”的顺序组织。每项都应产出可检查的文档结果，而不是只做讨论。
其中 `Phase 0` 与 `Phase 1` 是当前整理 `PLAN.md` 的主线，`Phase 2` 之后的内容在正式章节主线建立后推进。

说明：本节勾选状态记录的是 **`PLAN.md` 正式契约章节的补写完成度**，不是 `typescript/` 运行时代码完成度。
目前正式章节主线已基本补齐，因此本清单主要剩余“外部引用同步”和“后续 OpenSpec 拆分”两类收尾事项。

#### Phase 0 — 重排 PLAN 结构（必须先做）

- [x] **Task 0.1**：把 `PLAN.md` 从“差距清单主导”改写为与最新版 SPEC 对齐的 **18 章 + Appendix A 正式章节主线**。
  - 完成标准：`PLAN.md` 以 `§1` 到 `§18` 的正式章节为主线组织内容，并显式标出 `Appendix A`。
- [x] **Task 0.2**：为正式章节目录补上状态标记（`🟢/🟡/⚪`）与一句话范围说明。
  - 完成标准：读章节目录区即可看出“哪些章节已起草、哪些仅占位、哪些仍滞后”。
- [x] **Task 0.3**：把当前“差距分析”保留为过渡信息，但避免它继续充当正式契约正文。
  - 完成标准：差距分析被收拢到 roadmap / migration 语境，正式章节成为主线。

#### Phase 1 — 先补最缺的 5 章（已完成）

- [x] **Task 1.1 — 补 §3 State Schema**
  - 目标：把 `Issue / WorkflowDefinition / Workspace / RunAttempt / LiveSession / RetryEntry / RuntimeState` 定义完整。
  - 完成标准：章节内明确字段、归一化规则、内存态边界，以及 `session_id` / `claimed` / `retry_attempts` 语义。
- [x] **Task 1.2 — 补 §5 Workflow Specification + §6 Configuration Specification**
  - 目标：覆盖 `WORKFLOW.md` 发现规则、front matter schema、`$VAR` / `~` / 相对路径解析、dynamic reload、preflight validation。
  - 完成标准：能直接指导 `workflow/` 与 `config/` 两个目录实现，不再依赖上游 SPEC 反复查漏。
- [x] **Task 1.3 — 补 §10 Agent Runner Protocol + §12 Prompt Construction**
  - 目标：把 CodeBuddy CLI 适配写成正式契约，包括 launch、session、事件映射、approval policy、continuation、prompt retry 语义。
  - 完成标准：`runner/` 可以按本地 `PLAN.md` 实现，不必再回退到 spike 文档拼装规则。
- [x] **Task 1.4 — 补 §13 Logging / Status / Observability**
  - 目标：明确结构化日志字段、snapshot shape、token/runtime/rate-limit 聚合规则、可选 HTTP 扩展边界。
  - 完成标准：`logging/` 与未来 dashboard API 有稳定输入输出契约。
- [x] **Task 1.5 — 补 §17 Test Matrix + §18 Definition of Done**
  - 目标：把 conformance 检查拆成可执行测试清单。
  - 完成标准：每个核心模块至少能映射到一个测试小节，且能作为 `typescript/test/` 的目录依据。

#### Phase 2 — 补运行时主干章节（已完成）

- [x] **Task 2.1 — 补 §1 Problem Statement / Project Positioning**
  - 目标：说明本项目与上游 Symphony、CodeBuddy CLI、cnb tracker 的边界，以及“handoff state 不等于 Done”。
  - 完成标准：不再只有“TS 参考实现”一句描述，而是有明确问题定义和适用边界。
- [x] **Task 2.2 — 补 §2 System Overview**
  - 目标：把 components、abstraction levels、external dependencies 三层都写清楚。
  - 完成标准：`tracker -> scheduler -> runner -> workspace -> logging` 的依赖方向在文档中可直接验证。
- [x] **Task 2.3 — 补 §7 Orchestration State Machine**
  - 目标：写清 `Unclaimed / Claimed / Running / RetryQueued / Released` 与 11 阶段 run lifecycle 的关系。
  - 完成标准：正常退出、异常退出、retry、stall、reconciliation 都有明确状态迁移说明。
- [x] **Task 2.4 — 补 §8 Polling / Scheduling / Reconciliation**
  - 目标：写清 poll tick 顺序、dispatch eligibility、sort 规则、concurrency、retry/backoff、startup cleanup。
  - 完成标准：`scheduler/` 可以直接据此实现主循环，无需再做大范围设计决策。
- [x] **Task 2.5 — 补 §9 Workspace Management and Safety**
  - 目标：补 workspace layout、create/reuse、optional population、hooks、三不变量。
  - 完成标准：`workspace/` 目录行为、hook failure semantics、cleanup 规则可直接落地。
- [x] **Task 2.6 — 补 §4 Tracker Integration Contract**
  - 目标：把 `CNBTracker` 的分页、错误分类、labels/blocker 归一化、writes boundary 写成正式契约。
  - 完成标准：cnb 的 3 个降级点被正式吸收到 contract，而不是只存在 spike 报告里。

#### Phase 3 — 补安全、恢复、参考算法（已完成）

- [x] **Task 3.1 — 补 §14 Failure Model and Recovery**
  - 目标：归类 config / workspace / runner / tracker / observability 故障，并定义恢复策略。
  - 完成标准：restart recovery、skip-dispatch-but-keep-reconcile、worker retry 等行为有统一表述。
- [x] **Task 3.2 — 补 §15 Security and Operational Safety**
  - 目标：明确 trust boundary、secret handling、hook 风险、harness hardening 建议。
  - 完成标准：本项目的高信任/低信任运行假设被正式记录，不再散落在讨论里。
- [x] **Task 3.3 — 补 §16 Reference Algorithms**
  - 目标：为 `startup / tick / reconcile / dispatch / run-agent-attempt / on-worker-exit` 写伪代码。
  - 完成标准：核心流程可由伪代码直接映射为 TypeScript 函数骨架。
- [x] **Task 3.4 — 补 Appendix A SSH Worker Extension 占位**
  - 目标：即便 M4 才实现，也先明确这是 extension，不属于 M1 conformance。
  - 完成标准：RemoteWorker 的未来边界被写清，不与 LocalWorker 主线混淆。

#### Phase 4 — 文档与 roadmap 收尾（避免文档彼此打架）

- [x] **Task 4.1**：同步 `README.md` 的职责边界，去掉 README 承载任务状态与“14 章骨架”心智。
  - 完成标准：README 中仅保留项目目标 / 定位 / 技术路径 / 快速开始，并明确任务规划统一以 `PLAN.md` 为准。
- [x] **Task 4.2**：同步 [`docs/references/symphony.md`](./docs/references/symphony.md)，把“借鉴清单”引用改到最新版章节号。
  - 完成标准：引用的 SPEC 章节编号不再失真。
- [x] **Task 4.3**：把 OpenSpec 后续 change 拆分为若干小 change，而不是一次性重写整份 `PLAN.md`。
  - 建议拆分：`draft-plan-state-schema`、`draft-plan-workflow-config`、`draft-plan-runner-contract`、`draft-plan-observability-and-tests`。
  - 完成标准：每个 change 可在 1 个顶层任务内完成并可审查。

#### 当前建议优先级

1. `P0`：M4 已完成，后续只剩对真实远端环境与 Dashboard 展现细节做增量打磨。
2. `P1`：若继续扩展 RemoteWorker，应补远端 workspace 同步策略与连接复用，而不是改动主状态机。
3. `P2`：若继续扩展 Dashboard，应在不改变 `/api/v1/state` 契约的前提下增加 richer filtering / drill-down。

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
- 🟢 后续工作已完成并纳入 M4：Dashboard 已落地为 status server 首页，RemoteWorker 已落地为 `worker.kind: ssh` 扩展
- 🟡 M3 已启动首个实现增量：workspace/config 已支持 `directory | git-worktree` 模式切换、`workspace.sourceRoot` 解析、git worktree 创建/清理生命周期与对应自动化测试
- 🟡 M3 第二个实现增量：preflight 已在 `git-worktree` 模式下校验 `workspace.sourceRoot` 存在且为 git 仓库，并拒绝 `workspace.root/sourceRoot` 相等或互相嵌套的危险配置
- 🟡 M3 第三个实现增量：workspace 创建前会主动 `git worktree prune`，修复目录被外部删除后 stale worktree 元数据导致的重建失败
- 🟡 M3 第四个实现增量：`afterCreate` hook 失败时会自动回滚新建 workspace / worktree，避免残留半初始化目录
- 🟡 M3 第五个实现增量：worktree 删除后会补跑 `git worktree prune`，减少 stale admin metadata 长期堆积
- 🟡 M3 第六个实现增量：reload 路径已覆盖 git-worktree 非法配置的 last-known-good 保留语义，避免坏配置把 daemon 运行态打挂
- 🟡 M3 第七个实现增量：补齐 `beforeRemove` 失败时仍继续清理 workspace/worktree 的回归测试，锁定现有宽松清理语义
- 🟢 M3 第八个实现增量：worktree 目录已被外部删除时，仍会清理 stale metadata；实现与测试已补齐，覆盖 removal 侧自愈路径
- 🟡 M3 第九个实现增量：startup cleanup 已补 git-worktree terminal issue 清理回归测试，覆盖 daemon 启动阶段的 worktree 收口
- 🟢 M3 第十个实现增量：reconciliation 阶段 workspace cleanup 失败时，continuation 仍继续执行；实现与测试已补齐
- 🟢 M3 第十一个实现增量：同一轮 reconciliation 中即使前一个 released issue 的 cleanup 失败，后续 released issue 仍继续清理；回归测试已补齐
- 🟢 M3 第十二个实现增量：startup cleanup 阶段单个 workspace cleanup 失败不再中断后续清理，且会通过 `cleanupError` 暴露首个错误；实现与测试已补齐
- 🟢 M3 第十三个实现增量：dispatch 阶段单个 issue 的 workspace 初始化失败不再打断同轮后续 issue，失败项转入 retry 并记录错误日志；实现与测试已补齐
- 🟢 M3 第十四个实现增量：continuation 阶段单个 issue 的运行异常不再打断后续 continuation，失败项转入 retry 并记录错误日志；实现与测试已补齐
- 🟢 M3 第十五个实现增量：dispatch 阶段单个 issue 在 beforeRun / runner 主路径上的意外抛错也已收口为 issue 级 retry，不阻断同轮后续 issue；实现与测试已补齐

### 3.5 M3 结项说明

- 🟢 调度并发面已收口：`max_concurrent_agents` 与 `max_concurrent_agents_by_state` 已进入 dispatch 选择逻辑并由测试锁定
- 🟢 workspace 隔离面已收口：`git-worktree` 模式、`workspace.sourceRoot`、创建/清理/回滚、stale metadata 自愈、危险嵌套 preflight 均已补齐
- 🟢 运行时鲁棒性已收口：startup cleanup、reconciliation、dispatch、continuation 的单项失败都已转成 issue 级 retry 或错误上报，不再阻断同轮其他 issue
- 🟢 M3 验证面已收口：相关回归已进入 `typescript/test/`，当前全量为 34 个测试文件、153 个测试用例通过

### 3.6 下一步应直接对应的 PLAN 章节

- `§3 State Schema`：把当前 `spec/` 中已出现的 `Issue / RuntimeState / RetryEntry` 扩成正式实体契约
- `§5 Workflow Specification` 与 `§6 Configuration Specification`：把现有 `loadWorkflow()` / `loadServiceConfig()` 的行为上升为正式规范
- `§10 Agent Runner Protocol` 与 `§12 Prompt Construction`：把现有 `buildCodebuddyCommand()` 和 spike 结论汇总成可实现的 runner contract
- `§13 Logging / Status / Observability` 与 `§17 Test Matrix`：让当前 `logging/` 与 `typescript/test/` 有明确完成标准

### 3.7 技术栈选型（确认稿）

详见 [`AGENTS.md` §1 技术栈（锁定）](./AGENTS.md#1-技术栈锁定) 和 [§2 编码规范（硬约束）](./AGENTS.md#2-编码规范硬约束)。
本节不重复。

---

## 4. 已识别的风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | CodeBuddy CLI `--resume` / stream-json / ACP 语义随版本演进漂移 | 用 `scripts/spike-a-probe.sh` 做回归探针；M1 固定一版 CLI 行为基线 |
| R2 | cnb.cool API 的 batch-by-id / labels 过滤 / custom fields 仍有能力缺口 | 在 §4 正式吸收 3 处降级：并发单查、客户端二次过滤、label 前缀承载元数据 |
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
| v1.5 | 2026-05-25 | M3 第二阶段：preflight 增加 `git-worktree` 模式下的 `sourceRoot` git 仓库校验，并拒绝 `workspace.root/sourceRoot` 的危险嵌套关系；同步 README 与测试覆盖安全边界 |
| v1.6 | 2026-05-25 | M3 第三阶段：git worktree 创建前执行 `worktree prune`，补齐 stale metadata 自愈路径与回归测试 |
| v1.7 | 2026-05-25 | M3 第四阶段：workspace `afterCreate` 失败后自动回滚目录/worktree，补齐初始化失败清理语义与回归测试 |
| v1.8 | 2026-05-25 | M3 第五阶段：worktree 删除后补跑 `worktree prune`，收口清理侧的 stale metadata 维护语义 |
| v1.9 | 2026-05-25 | M3 第六阶段：补齐 git-worktree 非法 reload 配置的 last-known-good 保留测试，收口动态配置安全语义 |
| v1.10 | 2026-05-25 | M3 第七阶段：补齐 `beforeRemove` hook 失败仍继续清理的目录/worktree 回归测试，固定当前 cleanup 宽松策略 |
| v1.11 | 2026-05-25 | M3 第八阶段：worktree 目录已缺失时仍清理 stale metadata，补齐 removal 自愈实现与回归测试 |
| v1.12 | 2026-05-25 | M3 第九阶段：startup cleanup 增加 git-worktree terminal issue 清理测试，补齐 daemon 启动侧 worktree 收口覆盖 |
| v1.13 | 2026-05-25 | M3 第十阶段：reconciliation workspace cleanup 失败时仍继续 continuation，补齐实现与回归测试 |
| v1.14 | 2026-05-25 | M3 第十一阶段：同轮 reconciliation 内前序 cleanup 失败不阻断后续 released issue 清理，补齐回归测试 |
| v1.15 | 2026-05-26 | M3 第十二阶段：startup cleanup 对单项 cleanup 失败改为继续其余清理并上报 `cleanupError`，补齐实现、日志与回归测试 |
| v1.16 | 2026-05-26 | M3 第十三阶段：dispatch 对单个 issue 的 workspace 初始化失败改为 issue 级重试，不阻断同轮后续派发，补齐实现与回归测试 |
| v1.17 | 2026-05-26 | M3 第十四阶段：continuation 对单个 issue 的运行异常改为 issue 级重试，不阻断同轮后续 continuation，补齐实现与回归测试 |
| v1.18 | 2026-05-27 | `PLAN.md` 正式章节主线补齐第一批正文：完成 `§3 / §5 / §6 / §10 / §11 / §12 / §13 / §17 / §18`，并同步勾选 Phase 1 文档任务 |
| v1.19 | 2026-05-27 | `PLAN.md` 继续补齐 `§1 / §2 / §4 / §7 / §8 / §9 / §14` 正文，完成 Phase 2 与 Failure/Recovery 主线，并收敛迁移分析中的历史表述 |
| v1.20 | 2026-05-27 | `PLAN.md` 补齐 `§15 / §16 / Appendix A`，完成剩余正式章节主线，并把可执行清单收口到文档引用同步与后续 OpenSpec 拆分 |
| v1.21 | 2026-05-27 | M4 完成：Dashboard 首页与 SSH RemoteWorker 已落地，README/PLAN 同步收口到 M4 已完成状态 |
