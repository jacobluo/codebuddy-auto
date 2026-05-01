# Spike A & B 设计文档（M0 阻塞解除）

> 本文档是 brainstorming 阶段的产出，定义两份 M0 spike 的**目标、验证清单、判定标准**。
> 创建日期：2026-05-01
> 状态：待动手验证

---

## 0. 为什么要做这两份 spike

`PLAN.md` §3.1 列出：

- **Spike A**：CodeBuddy Code CLI 能力验证 → `docs/references/codebuddy-cli-capabilities.md`
- **Spike B**：cnb.cool Issue API 能力验证 → `docs/references/cnb-issue-api.md`

两份 spike 未完成前，`PLAN.md` §4（Tracker 接口）和 §5（Agent 协议）不起草。

本设计文档是 brainstorming 阶段（AGENTS §4 MUST）的结果，用于约束 spike 动手时不偏航。

---

## 1. 已锁定的前置决策（本轮 brainstorming 产出）

### 1.1 Tracker 架构

| 维度 | 决策 |
|---|---|
| 主 backend | **cnb.cool**（非 Linear / 非 TAPD / 非 GitHub） |
| Tracker 接口 | **插件化**（对齐 Symphony SPEC §18.2 TODO） |
| M1 实现范围 | CNBTracker（主）+ LocalTracker（测试/离线） |
| 其他 backend | TAPDTracker / GitHubTracker / LinearTracker —— 未来扩展，不进 M1 |

**关键判断**：cnb.cool 作为**代码托管 + issue 系统一体化平台**，在 Symphony §4.1.1 Issue 字段对齐度上与 GitHub 等同（单表 issue 模型），优于 TAPD（三表模型：需求 / 缺陷 / 任务）。

### 1.2 Symphony §4.1.1 Issue 字段映射（CNBTracker）

| Symphony 字段 | cnb 实现 | 策略 |
|---|---|---|
| `id` | cnb issue id | 原生 |
| `identifier` | cnb issue number（形如 `#101`） | 原生 |
| `title` | 原生 | 原生 |
| `description` | 原生 | 原生 |
| `priority` | cnb 原生优先级 | 🟢 **原生**（不需要 label 模拟） |
| `state` | cnb state + label 扩展为 `needs-review` 之类中间态 | 约定 |
| `branch_name` | 约定生成：`issue/<number>` | 约定 |
| `url` | 原生 | 原生 |
| `labels` | 原生（含自定义 label） | 原生 |
| `blocked_by` | 🟡 **label 模拟**：`blocked-by:#N` | 约定（M1 做） |
| `created_at` / `updated_at` | 原生 | 原生 |

**Symphony 原生缺失但 cnb 有的额外字段**：`assignee`（处理人）—— 可能对未来"issue 分派策略"有用，先作为扩展字段保留。

### 1.3 命名策略

Symphony SPEC 里 LiveSession 有超过一半字段带 `codex_` 前缀（如 `codex_input_tokens` / `codex_app_server_pid`）。

**本项目统一改为 `agent_*`**，理由：
1. 和 Agent Runner 插件化方向对齐（未来可能加 Claude Code / Codex backend）
2. 命名即接口，读者直接能对应到 `Agent` 抽象
3. `PLAN.md` §3 State Schema 里保留一张 Symphony→本项目字段映射表，便于对照阅读

### 1.4 Scheduler State 持久化策略

**不持久化**。完全对齐 Symphony SPEC §14.3 Partial State Recovery：

- 无 retry 定时器持久化
- 无 running session 持久化
- 重启恢复路径：**tracker 重新 poll + filesystem workspace 保留**

**PLAN.md §3 必须显式写这条**，防止未来不自觉引入 SQLite / Redis。

---

## 2. Spike A 设计（CodeBuddy Code CLI 能力验证）

### 2.1 环境确认

- 二进制：`/opt/homebrew/bin/codebuddy`
- 版本：2.93.6
- 凭据：已配置，可实际跑

### 2.2 产出档位

**A2 档位**：能力清单 + 完整捕获一次多 turn 对话的 stdout 样本。
- 产出体量：~150-200 行 md + 附原始样本
- 目的：为 `PLAN.md` §5 Agent 协议起草提供直接输入
- 不做：边界压测（超时 / Ctrl-C / 网络断，留给 M1 实现 runner 时现场补）

### 2.3 验证清单（17 项 × 5 维度）

#### 维度 1：基础调用与参数签名
- [A.1.1] `codebuddy --help` 完整输出
- [A.1.2] `codebuddy code` 子命令是否存在
- [A.1.3] 最简调用 `codebuddy code "hello"` 的响应与退出码

#### 维度 2：Session / Resume（**对 PLAN §5 决定性**）
- [A.2.1] 首次调用能否获取 session_id（stdout / env / file / flag）
- [A.2.2] 能否 `--resume <session_id>` / `--continue`
- [A.2.3] Resume 后上下文是否真的保留（两轮对话测试）
- [A.2.4] session 持久化位置（用户级 vs 工作区级）
- [A.2.5] 并发同一 session 会怎样

#### 维度 3：事件流与输出格式（**对 PLAN §5 决定性**）
- [A.3.1] 默认 stdout 是纯文本还是结构化（JSON / NDJSON）
- [A.3.2] 有无 `--output-format json` / `--stream` / `--quiet` flag
- [A.3.3] 结构化事件的 schema（`type` / `timestamp` / `payload` ...）
- [A.3.4] 事件类型清单，对位 Symphony §10.4 的 11 种事件
- [A.3.5] token usage 获取方式（绝对 vs delta —— PLAN §11）

#### 维度 4：控制与约束（§9 超时矩阵的现实约束）
- [A.4.1] `--max-turns <n>` 支持
- [A.4.2] `--timeout` / turn 级超时
- [A.4.3] sandbox / approval 策略传参
- [A.4.4] `--cwd` 工作目录（§9 Invariant 1 必需）

#### 维度 5：退出码与异常（粗线条，不压测）
- [A.5.1] 正常完成的退出码
- [A.5.2] 用户中断（Ctrl-C）的退出码

### 2.4 Spike A 产出长什么样

文件：`docs/references/codebuddy-cli-capabilities.md`

结构：
```
# 摘要（一句话结论）
# 环境
# 17 项验证结果（Yes/No + 证据）
# 事件流样本（多 turn 对话原始 stdout）
# 对 Symphony §10 的兼容性评估
# 对 PLAN §5 的建议
# 已知风险 / 待压测项
```

### 2.5 完成定义（Done）

- [ ] 17 个验证项全部给出 Yes/No/降级 三档结论
- [ ] 至少捕获 **一次 2+ turn 的完整 stdout 样本**（用于事件流分析）
- [ ] 对 PLAN §5 的 Agent 协议给出**明确结构建议**（session_id 来源、事件映射表、continuation 实现路径）
- [ ] 明确回答：**CodeBuddy CLI 能否承接 Symphony §10 Agent Runner Protocol？**（🟢 能 / 🟡 部分能 + 降级点 / 🔴 不能 + 替代方案）

---

## 3. Spike B 设计（cnb.cool Issue API 能力验证）

### 3.1 产出档位

同 A2 档位：能力清单 + curl 样本。

### 3.2 验证清单（6 维度 × 20 项）

#### 维度 1：认证与基础调用
- [B.1.1] 认证方式（PAT / OAuth / cookie）
- [B.1.2] 最简调用 `GET /api/.../issues/:n` 能否跑通
- [B.1.3] 速率限制（QPS / 超限响应）
- [B.1.4] API 文档链接

#### 维度 2：候选 issue 查询（§11 REQUIRED #1 `fetch_candidate_issues`）
- [B.2.1] 按 label 过滤
- [B.2.2] 按 state 过滤（open）
- [B.2.3] 多 label 组合（AND / NOT）
- [B.2.4] 分页机制与页大小
- [B.2.5] 排序参数

#### 维度 3：批量查询（§11 REQUIRED #2 #3）
- [B.3.1] 批量按 id 查 issue（reconciliation 刚需）
- [B.3.2] 不支持批量时的延迟评估
- [B.3.3] 终态 issue 查询（startup cleanup）

#### 维度 4：Agent 自更新 ticket（§10.5 `linear_graphql` 替代，对应 `cnb_api` 工具）
- [B.4.1] 创建评论
- [B.4.2] 改 label（增 / 删）
- [B.4.3] 改 state / 关闭 issue
- [B.4.4] 改 assignee
- [B.4.5] 权限模型（账号 / token 粒度）

#### 维度 5：自定义字段 / 扩展
- [B.5.1] 自定义字段存在性
- [B.5.2] API 读写自定义字段
- [B.5.3] `attempt` 计数存 label 还是自定义字段

#### 维度 6：Webhook / 事件流（M4 加分项，M1 不用）
- [B.6.1] issue 变更 webhook 是否存在（记录可行性）

### 3.3 Spike B 产出长什么样

文件：`docs/references/cnb-issue-api.md`

结构：
```
# 摘要（一句话结论）
# 认证
# Symphony §11.1 REQUIRED 操作映射表（3 个）
# §4.1.1 Issue 字段映射表
# Agent 工具能力（cnb_api 工具设计草案）
# 已知限制（速率 / 批量 / 权限）
# 附录：原始 curl 样本
```

### 3.4 完成定义（Done）

- [ ] 20 个验证项全部给出 Yes/No/降级 三档结论
- [ ] Symphony §11.1 的 3 个 REQUIRED 操作全部有具体 cnb API 映射（或明确不可行）
- [ ] `blocked-by:#N` label 约定的**可行性**已验证（查询 + 批量 + 评论所需权限都通）
- [ ] 明确回答：**cnb API 能否承接 Symphony §11 Tracker Integration Contract？**（🟢 能 / 🟡 部分能 + 降级点 / 🔴 不能）

---

## 4. 执行顺序

**先 A 后 B**，理由已在 brainstorming 确认：
1. CLI spike 结论直接决定 PLAN §5（最难章节）
2. cnb 不理想有 Plan B（git note / PR body 带标记），CLI 不 resume 则要重设计
3. 单人串行心智负担低

---

## 5. 不在本 spike 范围

避免 scope creep，以下**明确不做**：

- 压测边界（超时 / Ctrl-C / 网络断）—— 留给 M1 runner 实现时
- 完整事件类型穷举 —— 够 §5 起草就行
- Webhook 实现 —— M4 再说
- 多 agent backend 兼容性 —— 先只验 CodeBuddy
- cnb Git 相关 API —— 代码仓库操作在 `workspace.hooks.after_create` 里，与 tracker 无关

---

## 6. 变更记录

| 版本 | 日期 | 摘要 |
|---|---|---|
| v0.1 | 2026-05-01 | brainstorming 完成；锁定 cnb 主 tracker / 字段策略 / agent_* 命名 / 不持久化；17+20 项验证清单定稿 |
