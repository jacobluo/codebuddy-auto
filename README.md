# codebuddy-auto

## 演示过程

展示一个 issue 从创建、进入队列、被 agent 处理，到最终形成 PR 的完整链路。

### 1. 创建 agent-ready issue

维护者在 cnb.cool 创建 issue，按模板填写任务类型、问题描述、期望行为和验证方式。`agent-ready` 标签让调度器可以把它识别为候选任务。

![创建 agent-ready issue](./images/0.issue_create.png)

### 2. Issue 进入调度队列

Issue 创建后，`codebuddy-auto` 会在后续 tick 中读取 tracker。符合标签、状态和并发限制的任务会被 claim，并分配独立 workspace。

![Issue 进入调度队列](./images/1.issue_added.png)

### 3. Dashboard 查看实时事件

Dashboard 会显示当前运行中的 issue、worker 状态、SSE 事件流、turn 信息和失败原因。这里可以看到 dispatch、session、turn 等运行事件，便于判断 agent 是否真正开始工作。

![Dashboard 实时事件](./images/2.issue_processing_event.png)

### 4. 查看完整执行过程

Transcript 会持久化 agent 对话、prompt、assistant 输出、错误和关键 runtime payload。相比只看最终状态，它更适合排查“agent 为什么这么改”“在哪一步卡住”这类问题。

![Dashboard transcript 执行过程](./images/3.issue_processing_log.png)

### 5. 从 issue 到 PR

最后一步不是“agent 直接完成项目”，而是把 issue 的执行结果交接给维护者。一个顺利的任务通常会产生代码提交、分支或 PR，并在 tracker 中留下 `agent-finish` 这类 handoff 信号。Dashboard 能看到这个链路，但最终是否合入仍由 CI、代码审核和维护者判断。

![Issue 到 PR 的交接结果](./images/4.issue_to_pr_.png)

> **TypeScript 参考实现 · 基于 OpenAI Symphony SPEC + CodeBuddy Code SDK**

[OpenAI Symphony](https://github.com/openai/symphony) 调度规范的 TypeScript 参考实现。Symphony 官方用 Elixir/OTP，本项目面向希望在 Node.js 生态部署类 Symphony 调度器的团队。

- 编排层：TypeScript / Node.js 20 LTS
- Agent 执行：[CodeBuddy Agent SDK](https://www.codebuddy.cn/docs/cli/sdk-typescript)（in-process）
- Issue tracker：cnb.cool git issue
- 架构说明：[`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 契约与演进：[`openspec/specs/`](./openspec/specs/) + [`PLAN.md`](./PLAN.md)

README 只保留项目定位、安装与快速开始。当前实现架构见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)，历史路线图与契约演进记录见 [`PLAN.md`](./PLAN.md)。

## 与 Symphony 官方实现的关系

| 维度 | Symphony 官方 | codebuddy-auto |
|---|---|---|
| 定位 | 规范 + 参考实现 | 另一个语言的参考实现 |
| 语言 | Elixir / OTP | **TypeScript / Node.js 20 LTS** |
| Agent 执行 | codex app-server（stdio 子进程） | **CodeBuddy Agent SDK（in-process）** |
| 调度模型 | BEAM supervisor tree | Node scheduler + async worker + 可选 CLI fallback |
| Tracker | Linear | **cnb.cool git issue**（主）+ 本地目录（fallback） |
| 对标契约 | `symphony/SPEC.md` | `openspec/specs/` + `ARCHITECTURE.md` |

关键策略：

- **契约不降维**：OpenSpec specs 按 Symphony 调度语义维护能力契约
- **实现已覆盖 M1 ~ M4 主线**：单机调度、并发与 worktree、Dashboard、Live SSE 事件流均已落地
- **Linear 永不接入**：用 cnb.cool issue 替代

## 目录结构

```
codebuddy-auto/
├── ARCHITECTURE.md        ← 当前实现架构与运行模型
├── PLAN.md                ← 历史计划 + 契约演进记录
├── package.json           ← 根目录本地安装入口（bin 指向 typescript/dist）
├── examples/workflows/    ← 可复制修改的 WORKFLOW.md 示例
├── openspec/specs/        ← 当前可执行能力规范
├── scripts/               ← install-cnb-harness
├── templates/             ← 可安装到业务仓库的 harness 标准模板
├── typescript/            ← TypeScript 实现（src/test/dashboard/package.json）
└── docs/references/       ← 上游/平台调研材料与 spike 结论
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

需要临时指定执行模型时，在 `check` / `daemon` / 默认 run-once 命令后追加 `--model <model>`。例如：

```bash
node ../codebuddy-auto/typescript/dist/src/main.js daemon --model codebuddy-opus
```

如果你自己维护私有凭据文件，也可以手动 `source`，但 `codebuddy-auto init` 不会生成或读取 `.env`。

调度器只会捞取 **open + `agent-ready` 标签** 的 issue。

### Transcript 持久化

默认情况下，agent 对话过程会持久化到运行目录下的 SQLite：

```text
.codebuddy-auto/transcripts.sqlite
```

Dashboard 的 issue 详情面板提供 `Events / Transcript` 切换：

- `Events` 先读取 SQLite 中持久化的 issue event 历史，再接入实时 SSE live events
- `Transcript` 从 SQLite 读取持久化的 user prompt、assistant message、result/error、stderr 与原始 SDK/CLI payload

可在 `WORKFLOW.md` front matter 中调整：

```yaml
transcript:
  enabled: true
  sqlite_path: ./.codebuddy-auto/transcripts.sqlite
```

`sqlite_path` 相对 `WORKFLOW.md` 所在目录解析。若需要完全关闭本地 transcript：

```yaml
transcript:
  enabled: false
```

关闭后调度仍可运行，但 Dashboard Transcript API 与持久化 Events 历史 API 会返回 unavailable。Transcript 会保存完整 prompt、agent 输出、工具/错误 payload；Events 会保存调度、turn、progress、stuck 等观测事件 payload。这些数据可能包含仓库内容、issue 内容、路径、命令输出或其他敏感信息；请把该 SQLite 文件按运行凭据同等级别保护，不要提交到业务仓库。

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

也可以用 `codebuddy-auto daemon --model <model>` 临时覆盖 `WORKFLOW.md` 中的 `codebuddy.model`。

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
- `GET /api/v1/events/history` — 读取持久化 Dashboard event history，支持 `issueId` / `after` / `limit`
- `GET /api/v1/issues/<issueId>/transcript` — 读取该 issue 的持久化 transcript，支持 `after` / `limit`
- `POST /api/v1/refresh` — 排队一次额外 tick

前端开发：

```bash
pnpm run dev:dashboard
# 默认代理到 http://127.0.0.1:4317
# 如 status server 监听其他地址，可用 DASHBOARD_PROXY_TARGET 覆盖
# DASHBOARD_PROXY_TARGET=http://127.0.0.1:4567 pnpm run dev:dashboard
```

## 架构与运行模型

当前实现使用 `worker.kind: local` 作为主路径：scheduler dispatch 后启动 per-issue worker，worker 通过 CodeBuddy Agent SDK 持有长会话并在 turn 边界检查 tracker、handoff 与 progress gate。`worker.kind: ssh` 保留为 CLI fallback / RemoteWorker 扩展。

Issue 生命周期、scheduler tick、worker 调用细节、runtime state 与 Dashboard API 的完整说明见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

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

Apache-2.0
