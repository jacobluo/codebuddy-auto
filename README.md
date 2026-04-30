# agentfirst-f1

> **TypeScript 参考实现 · 基于 OpenAI Symphony SPEC + CodeBuddy Code CLI**
>
> 状态：🟡 起步阶段（M0 计划制定中 · 无可运行实现）

## 项目定位

本仓库是 [OpenAI Symphony](https://github.com/openai/symphony) 调度规范的一个 **TypeScript 参考实现**，使用 [CodeBuddy Code CLI](https://copilot.tencent.com/docs/cli/) 作为编码 agent 的执行层。

Symphony 官方用 Elixir/OTP 实现参考版；本项目用 TypeScript / Node.js 实现，目标用户是希望在 Node 生态内部署类 Symphony 调度器的团队。

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
- **契约不降维**：`PLAN.md` 14 章节完整对齐 Symphony 语义
- **实现分阶段**：M1 单机 + CNB tracker；M4 再做 Dashboard 与 SSH worker
- **Linear 永不接入**：用 cnb.cool issue 替代

## 目录结构

```
agentfirst-f1/
├── README.md                      ← 本文件
├── PLAN.md                        ← 项目计划 + 语言无关契约主干（M0 起草中）
├── scripts/                       ← 通用 bash 工具
│   ├── baseline.sh                  基线快照（JSON 出品）
│   └── diff-baseline.sh             基线对比（回归判定）
├── typescript/                    ← TypeScript 参考实现（M1 起动工）
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

## 快速开始

```bash
# 验证基础工具链
bash scripts/baseline.sh --no-tests    # 应输出合法 JSON
```

M1 实现落地后本节会扩充为端到端命令。

## 里程碑

| 里程碑 | 产出 | 状态 |
|---|---|---|
| M0 | `PLAN.md` v0.1 骨架 + 两份 spike（CodeBuddy CLI / cnb API） | 🟡 进行中 |
| M1 | `typescript/` 最小可跑：CNBTracker + LocalWorker + CodeBuddy CLI 单 turn | ⚪ 待启动 |
| M2 | continuation（`--resume`）+ baseline 闭环 + multi-turn | ⚪ 待启动 |
| M3 | `max_concurrent_agents` 多 issue 并发 + per-task git worktree | ⚪ 待启动 |
| M4 | Dashboard（SSE/WS）+ RemoteWorker（SSH） | ⚪ 待启动 |

详细契约章节与当前阶段待办见 [`PLAN.md`](./PLAN.md)。

## License

Apache-2.0（与 OpenAI Symphony 保持一致）
