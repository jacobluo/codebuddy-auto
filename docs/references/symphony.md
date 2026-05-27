# Symphony 解读与借鉴清单

> 整理自 2026-04-30 对 `github.com/openai/symphony` 的调研。
> 本文件是 agentfirst-f1 起草 `PLAN.md` 和 `typescript/` 实现的**输入材料**，不是项目产出本身。
>
> **2026-05-27 修订**：`PLAN.md` 已完成正式章节主线，`typescript/` 已完成 M1 ~ M4 主线；本文件保留为“为何这样设计”的参考索引。

---

## 一、Symphony 是什么

**定位**：Codex 编码 agent 的编排层（Orchestration Layer），不是通用 Agent 框架。

**核心主张**：
> "Turns project work into isolated, autonomous implementation runs, allowing teams to manage work instead of supervising coding agents."

**仓库结构**：
```
symphony/
├── SPEC.md        ← 语言无关契约（~7KB 规范）
└── elixir/        ← 参考实现（Mix 项目，可独立运行）
    ├── lib/
    ├── test/
    ├── WORKFLOW.md
    └── mix.exs
```

官方明确鼓励"用任何语言按 SPEC 自己实现一份"，agentfirst-f1 就是这个方向的 TypeScript 版。

---

## 二、Symphony 工作流程

1. 轮询 Linear 获取候选 issue
2. 为每个 issue 创建独立 workspace
3. 在 workspace 内以 App Server 模式启动 Codex
4. 向 Codex 发送 workflow prompt
5. 持续驱动 Codex 直至任务完成
6. 提供 `linear_graphql` 工具让 agent 自行更新 ticket
7. issue 进入终态（Done / Closed / Cancelled / Duplicate）时停 agent + 清 workspace

**agentfirst-f1 的策略**：

| Symphony | agentfirst-f1 |
|---|---|
| Linear API 轮询 | **cnb.cool git issue**（主 backend）+ 本地目录（fallback，用于测试） |
| Codex app-server（stdio 子进程） | **CodeBuddy Code CLI（stdio 子进程）** ← 同构，不是降维 |
| max_concurrent=10 多 issue 并行 | M3 已对齐 `max_concurrent_agents` |
| OTP 监督树 | Node 子进程 + 心跳 + 崩溃重启（语义等价，物理不可抄） |
| Phoenix LiveView dashboard | 结构化日志 + JSON 快照（MUST）；Dashboard 已由 status server 首页落地 |
| linear_graphql 工具 | `cnb_api` 工具（agent 在 CLI 内调用 cnb REST/GraphQL 更新 issue） |
| SSH Worker 多机部署 | M4 已落地 `worker.kind: ssh` 的 RemoteWorker transport |

---

## 三、借鉴清单（按优先级）

### P0 必抄（架构级）

#### 1. SPEC/impl 双层结构
- 根目录是契约文档（本项目为 `PLAN.md`），子目录是参考实现
- 契约稳定、实现可换
- **落点**：`PLAN.md` 正式章节主线 + `typescript/` 分层实现

#### 2. Workflow-as-Code（YAML front matter + prompt body）
- 配置跟仓库一起版本化
- 运行时可热重载，失败时保留上一份有效配置
- **落点**：`PLAN.md` `§5 Workflow Specification` + `§6 Configuration Specification`

#### 3. Run 生命周期状态机
- 比 "running / done / failed" 三态诊断精度高得多
- **落点**：`PLAN.md` `§7 Orchestration State Machine`

#### 4. Continuation 机制（worker 退出 ≠ 完成）
- worker 正常退出后短延迟 retry，重新检查 tracker 状态
- 若仍 active，在**同 session_id + 同 workspace** 启动下一轮（最多 `agent.max_turns`）
- 首轮渲染完整 prompt；后续轮次仅发"继续指引"
- **落点**：`PLAN.md` `§8 Polling / Scheduling / Reconciliation` + `§10 Agent Runner Protocol` + `§12 Prompt Construction`

### P1 应抄（规则/工程细节）

#### 5. 三个安全不变量
- Coding agent 仅在 per-issue workspace 中运行
- Workspace 路径必须在 workspace root 下
- Workspace key 经过 sanitization
- **落点**：`PLAN.md` `§9 Workspace Management and Safety`

#### 6. 严格模板渲染
- 未知变量/filter 必须失败，不允许静默注入默认值
- **落点**：`PLAN.md` `§5 Workflow Specification` + `§12 Prompt Construction`

#### 7. 超时矩阵
- poll / hooks / turn / read / stall / retry backoff / max turns / concurrency 都要显式配置
- **落点**：`PLAN.md` `§6 Configuration Specification`

#### 8. 重试与回退策略
- continuation retry 用固定短延迟
- failure retry 用指数回退
- **落点**：`PLAN.md` `§8 Polling / Scheduling / Reconciliation`

#### 9. Token 核算：绝对总量 vs delta
- 优先 absolute totals
- 用"上次报告总量"做差值累计，避免重复计数
- **落点**：`PLAN.md` `§11 Token / Runtime / Rate-Limit Accounting`

#### 10. 配置验证 Preflight
- 启动前校验 workflow / tracker / CLI / workspace
- reload 失败保留 last-known-good runtime
- **落点**：`PLAN.md` `§6 Configuration Specification` + `§14 Failure Model and Recovery`

#### 11. 重启恢复：内存态 + tracker/FS 恢复
- 不持久化调度状态
- 重启后依靠 tracker/filesystem 重新进入正确状态
- **落点**：`PLAN.md` `§14 Failure Model and Recovery`

### P2 可抄（流程/测试）

#### 12. 三档一致性测试矩阵
- Core Conformance
- Extension Conformance
- Real Integration Profile
- **落点**：`PLAN.md` `§17 Test Matrix` + `typescript/test/`

#### 13. 信任边界由实现方显式声明
- approval / sandbox / hook 风险不能隐含
- **落点**：`PLAN.md` `§15 Security and Operational Safety`

#### 14. 结构化日志 + 运行时快照 JSON
- 日志字段与 snapshot shape 要稳定
- Dashboard / CLI status / HTTP API 共用同一状态源
- **落点**：`PLAN.md` `§13 Logging / Status / Observability`

#### 15. 架构/产品层的等价替代
| Symphony 特性 | agentfirst-f1 的处置 |
|---|---|
| Elixir/OTP + BEAM 监督树 | 以 Node 子进程 + 心跳 + 崩溃重启作为语义等价实现（`PLAN.md` `§14`） |
| Linear API + linear_graphql 工具 | 永不接入；用 cnb.cool git issue + `cnb_api` 工具等价替代（`PLAN.md` `§4`） |
| Phoenix LiveView + Bandit HTTP | 结构化日志 + JSON 快照为 MUST；Dashboard 已落地到 `GET /` |
| SSH Worker 多机部署 | 已实现 `worker.kind: ssh` RemoteWorker transport，仍保持本地 scheduler 主导 |
| Codex app-server stdio 协议 | 同构替代：CodeBuddy Code CLI 子进程 |

---

## 四、Symphony SPEC.md 里的其他要点

### 组件接口（Symphony §3）
| 组件 | 职责 |
|---|---|
| Workflow Loader | 读 `WORKFLOW.md`，解析 YAML front matter + prompt body |
| Config Layer | 类型化 getter，默认值与环境变量 `$VAR` 解析 |
| Issue Tracker Client | 获取候选/刷新状态/获取终态 |
| Orchestrator | poll tick、内存运行时状态、dispatch/retry/stop/release |
| Workspace Manager | issue → 工作目录，执行 hooks |
| Agent Runner | 创建 workspace、拼 prompt、启动 agent、流式返回事件 |
| Status Surface（可选） | 操作员可见运行时状态 |
| Logging | 结构化日志 |

这张表对应本仓库的 `PLAN.md` `§2 System Overview`。

### Agent 输出事件类型（Symphony §10.4）
```
session_started       startup_failed
turn_completed        turn_failed
turn_cancelled        turn_ended_with_error
turn_input_required   approval_auto_approved
unsupported_tool_call notification
other_message         malformed
```

本项目的 CodeBuddy CLI 事件语义映射对应 `PLAN.md` `§10 Agent Runner Protocol`。

---

## 五、从 teamagent2 `.harness/` 带过来的有用经验

1. `baseline.sh` 递归守卫：测试里必须显式传 `--no-tests`
2. `task_id` 防碰撞：不要只用秒级时间戳
3. workspace 路径算法：路径拼接要有 self-test
4. mock 模式边界：不要注入默认值偷偷放行 strict contract
5. YAML 示例块提取：先 `yaml.parse`，失败再做兜底扫描

这些经验已吸收到 `PLAN.md` 与 `typescript/test/` 的设计里。

---

## 六、当前对应关系

截至 2026-05-27，本仓库已经完成：

- `PLAN.md` 正式章节主线（`§1 ~ §18 + Appendix A`）
- `typescript/` M1 ~ M4 主线能力
- Dashboard（`GET /`）
- RemoteWorker（`worker.kind: ssh`）

因此本文件现在的用途是：

- 解释为什么 `PLAN.md` 这样组织
- 记录 Symphony → agentfirst-f1 的等价替换思路
- 作为后续增量扩展时的设计背景材料
