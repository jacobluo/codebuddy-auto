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
