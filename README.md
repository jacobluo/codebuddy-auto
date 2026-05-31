# agentfirst-f1

> **TypeScript 参考实现 · 基于 OpenAI Symphony SPEC + CodeBuddy Code CLI**

## 项目目标

本项目的目标是把 [OpenAI Symphony](https://github.com/openai/symphony) 的调度规范与核心运行语义，**翻译成一套可在 Node.js 生态运行的参考实现**：

- 编排层使用 **TypeScript / Node.js 20 LTS**
- 编码 agent 执行层使用 **CodeBuddy Agent SDK**（本地 in-process）/ **CodeBuddy Code CLI**（SSH fallback）
- issue tracker backend 使用 **cnb.cool git issue**

翻译不是逐行搬运 Elixir 实现，而是在保持 Symphony 契约与调度语义的前提下，把其落地到 Node.js 子进程编排、CodeBuddy CLI 会话续跑、以及 cnb issue 状态同步这三条主线上。

## 项目定位

本仓库是 [OpenAI Symphony](https://github.com/openai/symphony) 调度规范的一个 **TypeScript 参考实现**，使用 [CodeBuddy Agent SDK](https://www.codebuddy.cn/docs/cli/sdk-typescript) 作为编码 agent 的执行层。

Symphony 官方用 Elixir/OTP 实现参考版；本项目用 TypeScript / Node.js 实现，目标用户是希望在 Node 生态内部署类 Symphony 调度器的团队。

当前仓库的主线不是“重写一个长得像 Symphony 的新系统”，而是把 Symphony 的这些核心能力在 Node.js 下重新建立出来：

- 基于 issue 的候选拉取、认领、派发与续跑
- 基于 per-task workspace 的隔离执行
- 基于 CodeBuddy Agent SDK 的 in-process 运行模型（SSH 场景 fallback 到 CLI session/resume）
- 基于 cnb.cool issue + cnb CLI 的 tracker 读写与状态同步

## 与 Symphony 官方实现的关系

| 维度 | Symphony 官方 | agentfirst-f1 |
|---|---|---|
| 定位 | 规范 + 参考实现 | 另一个语言的参考实现 |
| 语言 | Elixir/OTP | **TypeScript / Node.js 20 LTS** |
| Agent 执行 | codex app-server（stdio 子进程） | **CodeBuddy Agent SDK（in-process）**；SSH 时 fallback 到 CLI |
| 调度模型 | BEAM supervisor tree | Node 子进程 + 心跳 + 崩溃重启 |
| Tracker | Linear | **cnb.cool git issue**（主）+ 本地目录（fallback） |
| 对标契约 | `symphony/SPEC.md` | 本仓库 `PLAN.md`（契约完整对齐 + 实现分阶段） |

**关键策略**：
- **契约不降维**：`PLAN.md` 按最新版 Symphony SPEC 的 **18 章 + Appendix A** 补齐语义边界
- **实现已覆盖 M1 ~ M4 主线**：单机调度、并发与 worktree、Dashboard、RemoteWorker（SSH）均已落地
- **Linear 永不接入**：用 cnb.cool issue 替代

## 目录结构

```
agentfirst-f1/
├── README.md                      ← 本文件
├── PLAN.md                        ← 项目计划 + 语言无关契约主干
├── scripts/                       ← 通用 bash 工具
│   ├── baseline.sh                  基线快照（JSON 出品）
│   └── diff-baseline.sh             基线对比（回归判定）
├── typescript/                    ← TypeScript 参考实现
│   ├── src/                         源码
│   ├── test/                        vitest 测试
│   ├── package.json
│   └── tsconfig.json
└── docs/
    └── references/
        ├── symphony.md            ← 官方 Symphony SPEC 解读与对照
        ├── codebuddy-cli-capabilities.md   ← M0 spike：CLI session/resume 能力
        └── cnb-issue-api.md               ← M0 spike：cnb.cool API 能力
```

## 目标仓库要求（Harness Engineering）

Symphony 建议目标代码库已采用 [Harness Engineering](https://openai.com/index/harness-engineering/) 体系。这意味着被 agent 处理的仓库本身需要满足以下条件，agent 才能可靠地完成工作：

| 条件 | 说明 | 为什么需要 |
|---|---|---|
| **CI Pipeline** | 仓库配有自动化构建/测试流水线 | Agent 提交的代码能被 CI 自动验证，不依赖人工判断对错 |
| **测试覆盖** | 核心功能有单元/集成测试 | Agent 改完代码可以跑测试自验，也是 PR 门禁的基础 |
| **Lint / 格式化规则** | ESLint、Prettier 或等价工具已配置 | Agent 能通过 lint 发现规范问题，避免提交不合规代码 |
| **PR 门禁** | 分支保护 + CI 必须通过才能合入 | 即使 agent 代码有问题，也不会直接污染主分支 |
| **明确的项目结构** | README / AGENTS.md 描述了仓库约定 | Agent 能理解"在哪改、怎么改、怎么验证" |

**如果目标仓库没有这些基础设施**，agent 的行为将高度依赖 prompt 引导，且无法自动验证正确性。此时建议：

1. 至少配置一个可运行的测试命令（如 `npm test`）
2. 在 WORKFLOW.md 的 prompt 中明确写出验证步骤
3. 让 agent 提 PR 而非直接 push master，由人工审核

## 前置依赖

- **Node.js ≥ 20 LTS**
- **pnpm ≥ 9**
- **jq**（`baseline.sh` 需要）
- **CodeBuddy API Key**（`CODEBUDDY_API_KEY` 环境变量，SDK 认证用）
- **CodeBuddy Code CLI**（仅 `worker.kind: ssh` 时需要，本地 worker 使用 SDK）
- **cnb CLI**（agent 关闭 issue 用）：`curl -fsSL https://cnb.cool/cnb/skills/cnb-skill/-/git/raw/main/install.sh | sh`
- **git**
- **ssh**（仅 `worker.kind: ssh` 时需要）

### 环境变量

| 变量 | 必须 | 说明 |
|---|---|---|
| `CODEBUDDY_API_KEY` | ✓ | CodeBuddy SDK/CLI 认证 |
| `CNB_TOKEN` | ✓ | cnb.cool API token（tracker + cnb CLI） |
| `CNB_USERNAME` | ✓ | cnb.cool git 认证用户名（hooks 中 clone/push） |
| `CNB_PASSWORD` | ✓ | cnb.cool git 认证密码（hooks 中 clone/push） |
| `CNB_API_ENDPOINT` | 可选 | cnb CLI API 端点，默认 `https://api.cnb.cool` |

## 快速开始

```bash
# 验证基础工具链
bash scripts/baseline.sh --no-tests --include-api-hash

# 进入 TypeScript 参考实现
cd typescript
pnpm install
pnpm baseline:no-tests
pnpm test
pnpm check
pnpm baseline:diff /tmp/before.json /tmp/after.json
```

本地试运行推荐先准备两份本地文件：

```bash
cd typescript
cp .env.example .env
cp WORKFLOW.example.md WORKFLOW.md
```

然后在 `.env` 中填写：

- `CODEBUDDY_API_KEY`：CodeBuddy Code CLI 使用的 API key
- `CNB_TOKEN`：cnb.cool API token

再把 `WORKFLOW.md` 里的 `projectSlug`、仓库 clone 地址、prompt 内容改成你的实际项目配置。实践上至少要把 `{{ issue.description }}` 放进 prompt，否则 agent 经常只能看到标题，无法拿到 issue 正文。

启动方式：

```bash
cd typescript
set -a
source .env
set +a
pnpm build
node dist/src/main.js WORKFLOW.md --daemon
```

联调时可直接访问：

- `http://127.0.0.1:4317/` 查看 Dashboard
- `http://127.0.0.1:4317/api/v1/state` 查看 runtime snapshot

要让调度器实际捞取 CNB issue，需要目标 issue 处于 open 状态，并带有 `agent-ready` 标签。

当前 `typescript/` 已完成 M1 + M2 + M3 + M4 范围内的主线闭环：workflow/config 加载与 reload、CNB/Local tracker、workspace 创建与清理、CodeBuddy CLI 首轮与 continuation turn、startup cleanup、reconciliation、retry/backoff、baseline / diff-baseline 回归脚本、daemon 模式、Dashboard HTML + status API，以及基于 SSH transport 的 RemoteWorker。

M4 已完成的重点包括：

- `GET /` 仪表盘页面，直接消费既有 `/api/v1/state` 与 `/api/v1/refresh`
- `worker.kind: local | ssh` 抽象，以及 `ssh_host / ssh_user / ssh_port / ssh_options / remote_workspace_root` 配置
- RemoteWorker 通过 SSH 在远端 workspace 执行 CodeBuddy CLI，同时保留本地 scheduler / tracker / retry / observability 主导权

## 运行说明

本项目 Agent 执行层有两条路径（双模 Runner）：

- **本地 SDK 模式**（默认 `worker.kind: local`）：通过 `@tencent-ai/agent-sdk` in-process 执行，30x token 减少、7.5x 速度提升
- **SSH CLI 模式**：设置 `worker.kind: ssh` 后，通过 SSH 转发 CodeBuddy CLI 命令到远端执行

Dashboard 由 daemon 状态服务直接提供：

- `GET /`：人类可读 Dashboard（实时 SSE 驱动）
- `GET /api/v1/state`：结构化 runtime snapshot
- `GET /api/v1/events`：SSE 事件流（支持 `?issueId=` 过滤、`Last-Event-ID` 重放）
- `GET /api/v1/<issue_identifier>`：单 issue 运行态
- `POST /api/v1/refresh`：排队一次额外 scheduler tick

## Issue 生命周期

对齐 Symphony 的 agent-driven 完成信号模式，用标签模拟 Linear 的多态工作流：

```
┌───────────────────────────────────────────────────────────────────────────┐
│  状态流转（对应 Linear）                                                   │
│                                                                           │
│  open + agent-ready  →  agent 处理中  →  open + agent-finish  →  closed   │
│       (Todo)              (In Progress)       (In Review)         (Done)  │
│                                                                           │
│  触发者:    人工            scheduler          agent             人工审核  │
└───────────────────────────────────────────────────────────────────────────┘
```

**详细流程**：

1. **人工**贴 `agent-ready` 标签 → issue 成为候选
2. **Scheduler** poll → dispatch → 创建 workspace → agent 开始执行
3. **Agent** 修复 → 验证 → commit → push → `cnb issues add-labels --labels agent-finish`
4. **Scheduler** continuation 前检测到 `agent-finish` 标签 → 停止 continuation，release
5. **人工**审核 PR → 合入 → 关闭 issue
6. **Scheduler** reconciliation 检测 `closed` → 清理 workspace

**安全网**：
- 每次 continuation 前检查 tracker 状态 + `agent-finish` 标签
- 达到 maxTurns 时 scheduler 自动添加 `agent-finish` 标签并 release
- 如果审核不通过：人工去掉 `agent-finish` 标签 → agent 可被重新拉起

**配置**（WORKFLOW.md front matter）：

```yaml
tracker:
  candidate_label: agent-ready    # 准入标签（默认）
  exclude_label: skip-agent       # 排除标签（默认）
  finish_label: agent-finish      # 完成标签（默认）
```

## 规划说明

README 只保留项目目标、定位、技术路径和快速开始，不再承载任务状态、里程碑状态或待办清单。

所有任务规划、章节状态、里程碑推进和当前待办，统一以 [`PLAN.md`](./PLAN.md) 为准。

## License

Apache-2.0（与 OpenAI Symphony 保持一致）
