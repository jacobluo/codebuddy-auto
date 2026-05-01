# Symphony 解读与借鉴清单

> 整理自 2026-04-30 对 `github.com/openai/symphony` 的调研。
> 本文件是 agentfirst-f1 起草 `PLAN.md` 和 `typescript/` 实现的**输入材料**，不是项目产出本身。
>
> **2026-05-01 修订**：语言从 Python 改为 TypeScript、执行层从 SDK 改为 CodeBuddy Code CLI、
> tracker 从"本地目录"改为"cnb.cool + LocalTracker 双 backend"。详见 `PLAN.md`。

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

官方明确鼓励"用任何语言按 SPEC 自己实现一份"——agentfirst-f1 就是这个方向的 TypeScript 版。

---

## 二、Symphony 工作流程

1. 轮询 Linear 获取候选 issue
2. 为每个 issue 创建独立 workspace
3. 在 workspace 内以 App Server 模式启动 Codex
4. 向 Codex 发送 workflow prompt
5. 持续驱动 Codex 直至任务完成
6. 提供 `linear_graphql` 工具让 agent 自行更新 ticket
7. issue 进入终态（Done / Closed / Cancelled / Duplicate）时停 agent + 清 workspace

**agentfirst-f1 的策略**（2026-05-01 修订：**契约完整对齐 + 实现分阶段**，不再"降维"）：

| Symphony | agentfirst-f1 |
|---|---|
| Linear API 轮询 | **cnb.cool git issue**（主 backend）+ 本地目录（fallback，用于测试） |
| Codex app-server（stdio 子进程） | **CodeBuddy Code CLI（stdio 子进程）** ← 同构，不是降维 |
| max_concurrent=10 多 issue 并行 | M1 单并发；M3 对齐 max_concurrent_agents |
| OTP 监督树 | Node 子进程 + 心跳 + 崩溃重启（语义等价，物理不可抄） |
| Phoenix LiveView dashboard | 结构化日志 + JSON 快照（MUST）；Web dashboard M4（MAY） |
| linear_graphql 工具 | `cnb_api` 工具（agent 在 CLI 内调用 cnb REST/GraphQL 更新 issue） |

---

## 三、15 条借鉴清单（按优先级）

### P0 必抄（架构级）

#### 1. SPEC/impl 双层结构
- 根目录是契约文档（本项目为 `PLAN.md`），子目录是参考实现
- 契约稳定、实现可换
- **落点**：本仓库 `PLAN.md` + `typescript/` 分层已经按这个做了

#### 2. Workflow-as-Code（YAML front matter + prompt body）
```yaml
---
tracker:
  kind: linear
  project_slug: "..."
workspace:
  root: ~/code/workspaces
hooks:
  after_create: |
    git clone git@github.com:your-org/your-repo.git .
agent:
  max_concurrent_agents: 10
  max_turns: 20
codex:
  command: codex app-server
  approval_policy: {"reject": {...}}
  thread_sandbox: workspace-write
---

You are working on issue {{ issue.identifier }}.
```
- 配置跟仓库一起版本化
- 运行时可热重载，失败时保留上一份有效配置
- **落点**：agentfirst-f1 的 `WORKFLOW.md`（M1 加，格式对齐 Symphony）

#### 3. Run 生命周期 11 阶段状态机
```
PreparingWorkspace → BuildingPrompt → LaunchingAgentProcess
→ InitializingSession → StreamingTurn → Finishing
→ [Succeeded | Failed | TimedOut | Stalled | CanceledByReconciliation]
```
- 比 "running / done / failed" 三态诊断精度高得多
- **落点**：`PLAN.md` §6

#### 4. Continuation 机制（worker 退出 ≠ 完成）
- worker 正常退出后 1 秒 retry，重新检查 tracker 状态
- 若仍 active，在**同 session_id + 同 workspace** 启动下一轮（最多 `agent.max_turns`）
- 首轮渲染完整 prompt；后续轮次仅发"继续指引"
- **落点**：`PLAN.md` §5 Agent 协议；依赖 CodeBuddy Code CLI 的 `--resume` 能力（M0 spike 验证）

### P1 应抄（规则/工程细节）

#### 5. 三个安全不变量
- **Invariant 1**：Coding agent 仅在 per-issue workspace 中运行（launch 前校验 `cwd == workspace_path`）
- **Invariant 2**：Workspace 路径必须在 workspace root 下（规范化绝对路径 + prefix 校验）
- **Invariant 3**：Workspace key 经过 sanitization（仅 `[A-Za-z0-9._-]`）
- **落点**：`PLAN.md` §7 工作空间管理

#### 6. 严格模板渲染
- 未知变量/filter 必须失败，不允许静默注入默认值
- **落点**：`PLAN.md` §5，与 CodeBuddy Code CLI 的 prompt 拼装层对接

#### 7. 超时矩阵（8 个默认值）
| 超时 | 默认值 | 用途 |
|---|---|---|
| `polling.interval_ms` | 30000 | 轮询周期 |
| `hooks.timeout_ms` | 60000 | workspace hooks |
| `codebuddy.turn_timeout_ms` | 3600000 (1h) | 总轮次流 |
| `codebuddy.read_timeout_ms` | 5000 | 请求/响应读取 |
| `codebuddy.stall_timeout_ms` | 300000 (5m) | 事件静默检测 |
| `agent.max_retry_backoff_ms` | 300000 (5m) | 重试回退上限 |
| `agent.max_turns` | 20 | 单 worker 轮次上限 |
| `agent.max_concurrent_agents` | 10 | 全局并发 |
- **落点**：`PLAN.md` §9（字段名 `codex.*` → `codebuddy.*`）

#### 8. 重试与回退策略
- **正常延续 retry**：固定 `1000ms`
- **失败驱动 retry**：`delay = min(10000 * 2^(attempt-1), agent.max_retry_backoff_ms)`
- **落点**：`PLAN.md` §6

#### 9. Token 核算：绝对总量 vs delta
- **优先**：绝对 thread 总量（`thread/tokenUsage/updated`、`total_token_usage`）
- **忽略**：delta 式 payload 作为累计值
- 用"上次报告的总量"计算增量，避免重复计数
- **落点**：`PLAN.md` §11

#### 10. 配置验证 Preflight
- **启动前**：workflow file 可加载、tracker.kind 存在、api_key / 凭据存在、`codebuddy` CLI 可执行
- **每 Tick 重新验证**：失败跳过此 tick 的派发，但 reconciliation 仍运行
- **落点**：`PLAN.md` §10

#### 11. 重启恢复：内存态 + tracker/FS 恢复
- Symphony 刻意不持久化调度状态
- 重启后：无 retry 定时器恢复、无 running session 恢复
- 恢复路径：终态 workspace 清理 + 重新轮询 + 重新派发
- **落点**：`PLAN.md` §3，与 state persistence 的设计对立

### P2 可抄（流程/测试）

#### 12. 三档一致性测试矩阵
- **Core Conformance**：所有实现必需的确定性测试
- **Extension Conformance**：可选扩展（若实现则必需）
- **Real Integration Profile**：生产前推荐的依赖环境烟测
- **落点**：`PLAN.md` §13 + `typescript/test/` 分层（vitest）

#### 13. 信任边界由实现方显式声明
- Symphony 不强制统一 approval/sandbox 策略
- 实现方须声明自己的信任边界
- **落点**：`WORKFLOW.md` 的 `codebuddy.approval_policy` / `codebuddy.sandbox`

#### 14. 结构化日志 + 运行时快照 JSON
- 结构化字段：`issue_id` / `issue_identifier` / `session_id`
- 快照 JSON 示例（Symphony SPEC §5.5）：
  ```json
  {
    "generated_at": "时间戳",
    "counts": {"running": N, "retrying": N},
    "running": [...],
    "codebuddy_totals": {"input_tokens", "output_tokens", "total_tokens", "seconds_running"},
    "rate_limits": null
  }
  ```
- **落点**：`PLAN.md` §12

### 分阶段实现（不是"不抄"）

#### 15. 架构/产品层的分期与等价替代（2026-05-01 修订）
| Symphony 特性 | agentfirst-f1 的处置 |
|---|---|
| Elixir/OTP + BEAM 监督树 | **物理不可抄**；以 "Node 子进程 + 心跳 + 崩溃重启" 作为语义等价实现（PLAN §14） |
| Linear API + linear_graphql 工具 | **永不接入**；用 cnb.cool git issue + `cnb_api` 工具等价替代（PLAN §4） |
| Phoenix LiveView + Bandit HTTP | 结构化日志 + JSON 快照为 MUST；Web dashboard 为 MAY，M4 交付 |
| SSH Worker 多机部署 | 接口预留（Worker 抽象），M4 交付 RemoteWorker |
| Codex app-server stdio 协议 | **同构替代**：CodeBuddy Code CLI 子进程；不是降维 |

---

## 四、Symphony SPEC.md 里的其他要点

### 组件接口（Symphony §2）
| 组件 | 职责 |
|---|---|
| Workflow Loader | 读 `WORKFLOW.md`，解析 YAML front matter + prompt body |
| Config Layer | 类型化 getter，默认值与环境变量 $VAR 解析 |
| Issue Tracker Client | 获取候选/刷新状态/获取终态 |
| Orchestrator | poll tick、内存运行时状态、dispatch/retry/stop/release |
| Workspace Manager | issue → 工作目录，执行 hooks |
| Agent Runner | 创建 workspace、拼 prompt、启动 agent、流式返回事件 |
| Status Surface（可选） | 操作员可见运行时状态 |
| Logging | 结构化日志 |

这张表几乎可以**原样**搬到 agentfirst-f1 的 `PLAN.md` §2 架构分层（只需把"Codex app-server 子进程"替换为"CodeBuddy Code CLI 子进程"）。

### Agent 输出事件类型（Symphony §4.2）
```
session_started       startup_failed
turn_completed        turn_failed
turn_cancelled        turn_ended_with_error
turn_input_required   approval_auto_approved
unsupported_tool_call notification
other_message         malformed
```
每个事件包含：`event` / `timestamp` / `codex_app_server_pid` / 可选 `usage` / payload

agentfirst-f1 的 CodeBuddy Code CLI 事件模型需要自己映射到这套事件语义（M0 spike 任务之一）。

---

## 五、从 teamagent2 `.harness/` 带过来的有用经验

（不是直接拷贝，是**吸收为 PLAN.md 的设计决策**）

1. **baseline.sh 递归守卫**：runtime 在测试里跑时，调用 baseline.sh 要显式传 `--no-tests`；baseline.sh 自身检查 `$PYTEST_CURRENT_TEST` 环境变量兜底（TS 侧 vitest 没有等价环境变量，需要在 runtime 显式传 `--no-tests`）。M2 踩过一次级联爆炸坑，2160 个临时 task 目录被爆炸产出。
2. **task_id 防碰撞**：不要只用秒级时间戳，加 `process.hrtime.bigint() + pid` 防同秒冲突。
3. **workspace 路径算法**：路径拼接写法非常容易算错，加 self-test 验证。
4. **mock 模式的合法边界**：不要在 runtime 里"注入默认值让校验通过"——Symphony §5 严格模板渲染已经否决这个做法。
5. **YAML 示例块的双路提取**：先 `yaml.parse`，失败再按行扫描，不要无条件走 fallback。

---

## 六、起草 PLAN.md 契约章节的建议顺序

1. **§1 项目定位**（最容易，30min）
2. **§14 Non-Goals**（最容易，明确 Non-Goals 框住范围，含 Linear 永不接入 + M4 延期项）
3. **§6 Run 生命周期**（直接抄 Symphony 11 阶段）
4. **§9 超时矩阵**（直接抄 Symphony 8 个默认值，字段名 `codex.*` → `codebuddy.*`）
5. **§3 State Schema**（中等，TS interface + zod schema）
6. **§7 工作空间管理**（中等，Node path sanitize 规则）
7. **§5 Agent 协议**（最难，需要先做 CodeBuddy Code CLI spike 确认 session/resume 能力）
8. **§8 Workflow 格式**（中等，对齐 Symphony YAML）
9. **§4 Tracker 接口**（中等，CNBTracker + LocalTracker 双 backend 抽象；需先做 cnb API spike）
10. **§2 架构分层**（组件分图，最后收束）

剩余 §10/§11/§12/§13 属于工程细节，可以一边写 `typescript/` 一边补。

---

## 七、阻塞点（M0 spike 已解除）

### 7.1 CodeBuddy Code CLI session/continuation 能力 — 🟢 已解除（2026-05-01）

**产出**：[`docs/references/codebuddy-cli-capabilities.md`](./codebuddy-cli-capabilities.md)

**结论**：CodeBuddy Code CLI 2.93.6 能充分承接 Symphony §10 Agent Runner Protocol。原生支持
`--session-id` / `--resume` / `--continue` + NDJSON 结构化事件流（`--output-format stream-json`）+
`--max-turns` / `--permission-mode` / `--sandbox` / `--mcp-config`。缺的 `--cwd` 和 `--timeout`
由 orchestrator 侧补位（Node spawn cwd + AbortController 计时）。

### 7.2 cnb.cool Issue API 能力 — 🟡 已解除（2026-05-01，带 3 处降级）

**产出**：[`docs/references/cnb-issue-api.md`](./cnb-issue-api.md)

**结论**：REST / Bearer token / 无公开 rate-limit header。核心能力（按 label 过滤 / comment /
label 增删 / state 改（需 vnd accept + state+reason 成对）/ assignee）全部支持。三处降级：

- ❌ 无批量按 id 查询 → Symphony §11 #3 `fetchIssueStatesByIds` 退化为 N 次并发单查
- ❌ `labels=` 是 OR 语义，无 NOT → "含 agent-ready 且不含 skip-agent" 必须 orchestrator 侧客户端二次过滤
- ❌ 无 issue 级 custom fields → `attempt` / `blocked-by:#N` 等元数据用 label 前缀约定承载

**状态映射草案**详见该报告 §3.3。

两份 spike 均已解除，`PLAN.md` §4 / §5 可进入起草阶段。
