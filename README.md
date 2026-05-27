# agentfirst-f1

> **TypeScript 参考实现 · 基于 OpenAI Symphony SPEC + CodeBuddy Code CLI**

## 项目目标

本项目的目标是把 [OpenAI Symphony](https://github.com/openai/symphony) 的调度规范与核心运行语义，**翻译成一套可在 Node.js 生态运行的参考实现**：

- 编排层使用 **TypeScript / Node.js 20 LTS**
- 编码 agent 执行层使用 **CodeBuddy Code CLI**
- issue tracker backend 使用 **cnb.cool git issue**

翻译不是逐行搬运 Elixir 实现，而是在保持 Symphony 契约与调度语义的前提下，把其落地到 Node.js 子进程编排、CodeBuddy CLI 会话续跑、以及 cnb issue 状态同步这三条主线上。

## 项目定位

本仓库是 [OpenAI Symphony](https://github.com/openai/symphony) 调度规范的一个 **TypeScript 参考实现**，使用 [CodeBuddy Code CLI](https://copilot.tencent.com/docs/cli/) 作为编码 agent 的执行层。

Symphony 官方用 Elixir/OTP 实现参考版；本项目用 TypeScript / Node.js 实现，目标用户是希望在 Node 生态内部署类 Symphony 调度器的团队。

当前仓库的主线不是“重写一个长得像 Symphony 的新系统”，而是把 Symphony 的这些核心能力在 Node.js 下重新建立出来：

- 基于 issue 的候选拉取、认领、派发与续跑
- 基于 per-task workspace 的隔离执行
- 基于 CodeBuddy CLI 的 session / resume 运行模型
- 基于 cnb.cool issue 的 tracker 读写与状态同步

## 与 Symphony 官方实现的关系

| 维度 | Symphony 官方 | agentfirst-f1 |
|---|---|---|
| 定位 | 规范 + 参考实现 | 另一个语言的参考实现 |
| 语言 | Elixir/OTP | **TypeScript / Node.js 20 LTS** |
| Agent 执行 | codex app-server（stdio 子进程） | **CodeBuddy Code CLI（stdio 子进程）** |
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

## 前置依赖

- **Node.js ≥ 20 LTS**
- **pnpm ≥ 9**
- **jq**（`baseline.sh` 需要）
- **CodeBuddy Code CLI**（执行阶段）
- **git**
- **ssh**（仅 `worker.kind: ssh` 时需要）

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

当前 `typescript/` 已完成 M1 + M2 + M3 + M4 范围内的主线闭环：workflow/config 加载与 reload、CNB/Local tracker、workspace 创建与清理、CodeBuddy CLI 首轮与 continuation turn、startup cleanup、reconciliation、retry/backoff、baseline / diff-baseline 回归脚本、daemon 模式、Dashboard HTML + status API，以及基于 SSH transport 的 RemoteWorker。

M4 已完成的重点包括：

- `GET /` 仪表盘页面，直接消费既有 `/api/v1/state` 与 `/api/v1/refresh`
- `worker.kind: local | ssh` 抽象，以及 `ssh_host / ssh_user / ssh_port / ssh_options / remote_workspace_root` 配置
- RemoteWorker 通过 SSH 在远端 workspace 执行 CodeBuddy CLI，同时保留本地 scheduler / tracker / retry / observability 主导权

## 运行说明

本项目当前有两条运行路径：

- 本地 worker：默认 `worker.kind: local`，直接在本地 workspace 内拉起 CodeBuddy CLI
- SSH worker：设置 `worker.kind: ssh` 后，通过 `ssh` 把同一条 CodeBuddy 命令转发到远端 workspace 执行

Dashboard 由 daemon 状态服务直接提供：

- `GET /`：人类可读 Dashboard
- `GET /api/v1/state`：结构化 runtime snapshot
- `GET /api/v1/<issue_identifier>`：单 issue 运行态
- `POST /api/v1/refresh`：排队一次额外 scheduler tick

## 规划说明

README 只保留项目目标、定位、技术路径和快速开始，不再承载任务状态、里程碑状态或待办清单。

所有任务规划、章节状态、里程碑推进和当前待办，统一以 [`PLAN.md`](./PLAN.md) 为准。

## License

Apache-2.0（与 OpenAI Symphony 保持一致）
