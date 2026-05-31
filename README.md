# codebuddy-auto

> **TypeScript 参考实现 · 基于 OpenAI Symphony SPEC + CodeBuddy Code SDK**

[OpenAI Symphony](https://github.com/openai/symphony) 调度规范的 TypeScript 参考实现。Symphony 官方用 Elixir/OTP，本项目面向希望在 Node.js 生态部署类 Symphony 调度器的团队。

- 编排层：TypeScript / Node.js 20 LTS
- Agent 执行：[CodeBuddy Agent SDK](https://www.codebuddy.cn/docs/cli/sdk-typescript)（in-process），SSH 场景 fallback 到 CodeBuddy Code CLI
- Issue tracker：cnb.cool git issue
- 契约对齐：`PLAN.md` 按最新 Symphony SPEC 18 章 + Appendix A 落地，Linear 永不接入

完整任务规划、里程碑与待办以 [`PLAN.md`](./PLAN.md) 为准。

## 目录结构

```
codebuddy-auto/
├── PLAN.md                ← 项目计划 + 语言无关契约主干
├── scripts/               ← baseline.sh / diff-baseline.sh
├── typescript/            ← TypeScript 参考实现（src/test/package.json）
└── docs/references/       ← Symphony / CodeBuddy CLI / cnb issue API 解读
```

## 前置依赖

- Node.js ≥ 20 LTS、pnpm ≥ 9、git、jq
- CodeBuddy Code CLI（仅 `worker.kind: ssh` 时需要）
- cnb CLI：`curl -fsSL https://cnb.cool/cnb/skills/cnb-skill/-/git/raw/main/install.sh | sh`

| 环境变量 | 必须 | 说明 |
|---|---|---|
| `CODEBUDDY_API_KEY` | ✓ | CodeBuddy SDK / CLI 认证 |
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

## 运行模式

| `worker.kind` | 执行层 | 说明 |
|---|---|---|
| `local`（默认） | `@tencent-ai/agent-sdk` in-process | 相比 CLI 30× token 减少、7.5× 提速 |
| `ssh` | SSH 转发 CodeBuddy CLI | 远端 workspace 执行；本地保留 scheduler / tracker / retry / observability |

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

## 目标仓库要求

Symphony 假设目标仓库已采用 [Harness Engineering](https://openai.com/index/harness-engineering/)：CI、测试覆盖、lint、PR 门禁、清晰的 AGENTS.md。缺少时建议至少配置一个可运行的测试命令、在 prompt 中写明验证步骤、并强制走 PR 而非直推主干。

## License

Apache-2.0（与 OpenAI Symphony 保持一致）
