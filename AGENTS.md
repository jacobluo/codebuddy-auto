# agentfirst-f1 项目规约

本项目是 [OpenAI Symphony](https://github.com/openai/symphony) 调度规范的 **TypeScript 参考实现**。
本文件是给所有 agent（人类开发者、Claude Code、CodeBuddy Code CLI）看的"项目专属"规约。

**通用 LLM 行为规则**（think before coding / simplicity first / surgical changes / goal-driven execution）
由项目级 rule [`.codebuddy/rules/karpathy-guidelines.mdc`](./.codebuddy/rules/karpathy-guidelines.mdc) 提供，本文件不重复。

---

## 1. 技术栈（锁定）

| 用途 | 选型 | 备注 |
|---|---|---|
| 运行时 | **Node.js ≥ 20 LTS** | |
| 包管理 | **pnpm ≥ 9** | 不用 npm / yarn |
| 语言 | **TypeScript**（`strict: true`） | |
| 测试 | **vitest** | 不用 jest / mocha |
| Schema 校验 | **zod** | 运行时校验 + 类型推导一体 |
| YAML 解析 | **`yaml`** | workflow front matter |
| 子进程 | **原生 `child_process.spawn` + `readline`** | 不引 execa |
| git 操作 | **直接起 `git` 子进程** | 不引 simple-git |
| 日志 | **pino** | 结构化 JSON，低开销 |
| CLI 入口 | **commander** | 生态广、类型好 |

技术栈**不轻易增减**。任何新增依赖必须在 PR 描述里说明为什么内置能力不够。

---

## 2. 编码规范（硬约束）

以下 7 条是硬红线，违反视作 bug：

1. **ESM only**：`"type": "module"`；不混用 CommonJS（`require` / `module.exports`）。
2. **严格 TS**：`strict: true` + `noUncheckedIndexedAccess: true`；`tsconfig.json` 里这两项是红线。
3. **禁用 `any`**：用 `unknown` + 类型收窄，或 zod schema。需要逃生舱时用 `// @ts-expect-error` 并写原因。
4. **禁用默认导出**：一律命名导出；便于 grep / refactor / tree-shaking。
5. **禁用 `console.*`**：一律走 `pino` logger；脚本入口除外。
6. **边界处一律 zod `parse()`**：外部输入（CLI 参数 / 文件 / 子进程 stdout / HTTP 响应）进入系统前必须 `parse()`，不要 `as Type`。对应 PLAN §8 严格模板渲染。
7. **不引 lodash / ramda / underscore**：Node 20 原生 + TS 泛型够用；需要时写 3 行 util。

### 命名与风格
- 文件名 `kebab-case.ts`，类型/类 `PascalCase`，变量/函数 `camelCase`，常量 `UPPER_SNAKE_CASE`。
- 异步一律 `async/await`，不混用 `.then()`。
- 错误处理：抛 `Error` 子类，不抛字符串；自定义错误继承 `Error` 并带 `name`。

---

## 3. 目录结构约定

```
agentfirst-f1/
├── AGENTS.md                ← 本文件（规约）
├── PLAN.md                  ← 项目计划 + 契约主干
├── README.md
├── scripts/                 ← 跨语言的 bash 工具（baseline / diff-baseline）
├── docs/
│   └── references/          ← 调研材料 / spike 结论
└── typescript/              ← TS 参考实现
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── spec/            ← 类型 + zod schema（对应 PLAN §3 State Schema）
    │   ├── tracker/         ← Tracker 接口 + CNBTracker + LocalTracker（对应 §4）
    │   ├── runner/          ← CodeBuddy Code CLI 子进程封装（对应 §5）
    │   ├── scheduler/       ← poll loop + dispatch（对应 §2）
    │   ├── workspace/       ← per-task 目录 + 三不变量（对应 §7）
    │   ├── workflow/        ← WORKFLOW.md 加载与模板渲染（对应 §8）
    │   ├── config/          ← Preflight 校验（对应 §10）
    │   ├── logging/         ← pino 封装 + 结构化字段（对应 §12）
    │   └── index.ts         ← 包入口，命名导出
    └── test/                ← 镜像 src 结构（test/tracker/*.test.ts 对应 src/tracker/*.ts）
```

### 目录约束

- **一层深**：`src/` 下最多一层子目录；不出现 `src/a/b/c/`。
- **边界清晰**：每个子目录只暴露自己的公共 API（通过该目录下的 `index.ts` barrel 文件）。
- **无循环依赖**：`scheduler` 可 import `tracker` / `runner` / `workspace`；反过来不允许。依赖方向为自顶向下。
- **test 镜像**：测试文件路径与源文件 1:1 对应，`.test.ts` 后缀。
- **`spec/` 是类型中枢**：所有跨模块 shared 类型都放这里；禁止在 `src/scheduler/types.ts` 这类散点定义公共类型。

---

## 4. 开发工作流（OpenSpec + Superpowers）

**OpenSpec 管规划，Superpowers 管编码纪律**。两者强绑定，不可单独使用其一。

- **OpenSpec**（`@fission-ai/openspec`）：提供 `/opsx:propose` / `/opsx:apply` / `/opsx:archive` 三段工作流，
  产出 `proposal.md` + `design.md` + `tasks.md` + `specs/`
- **Superpowers**：提供 `brainstorming` / `test-driven-development` / `verification-before-completion` 等 skill

两者都是**开发工具，不是本项目的运行时依赖**。使用者无需手动安装，agent 会在关键节点自动调用。

### 4.1 主流程纪律（6 条）

1. **新功能一律走 `/opsx:propose`**。在 propose **之前**，**必须**调用 `brainstorming` skill 脑暴；
   **不**调用 `writing-plans`——因为 `/opsx:propose` 产出的 `proposal + design + tasks` 已等价于 writing-plans
   的完整计划，再做一次 writing-plans 是重复。

2. **`/opsx:apply` 实施任务时，必须启用 `test-driven-development`**：先写失败测试，再写实现。
   对 Symphony 严格语义的状态机代码尤其关键。

3. **并行派发（推荐，非强制）**：`tasks.md` 中存在 2+ 个独立任务时，**推荐**启用 `dispatching-parallel-agents`。
   Agent 必须先论证"确实无依赖"才能派发——**包括文件级无冲突**（例如两个任务都改 `index.ts` 导出 = 有冲突，
   不能并行）。有疑问则串行。

4. **完成粒度双重审查**：
   - 每完成 `tasks.md` 里**一个 task** → **推荐** `code-reviewer` 评审
   - `/opsx:archive` 一个 proposal **之前** → **必须** `verification-before-completion`（跑真实命令拿证据）
     **+** `code-reviewer`（review 变更整体）
   - "code-reviewer 找问题" 与 "verification 拿证据" 语义不同，二者都做，不能二选一。

5. **debug 纪律**：遇到测试失败、未预期行为、诡异日志时，**必须**启用 `systematic-debugging`。
   禁止直接猜测原因、禁止直接改代码碰运气。

6. **Git Worktree 隔离（带豁免）**：新功能必须在独立 Git Worktree 中开发（启用 `using-git-worktrees`）。
   **豁免场景**（可直接在主分支改）：
   - 纯文档改动：`docs/` / `AGENTS.md` / `PLAN.md` / `README.md`
   - 单文件 typo / 链接修复 / 变更记录追加

### 4.2 Superpowers 技能触发速查表

| 触发场景 | 必须调用 | 档位 |
|---|---|---|
| 启动新功能开发 | `using-git-worktrees` + `brainstorming` | MUST |
| 脑暴未完成即想调用 `/opsx:propose` | `brainstorming` | MUST |
| 实现新功能 / 修 bug | `test-driven-development` | MUST |
| 测试失败 / 异常行为 / 未预期结果 | `systematic-debugging` | MUST |
| 声称 "完成 / 修好 / 通过 / 搞定" 之前 | `verification-before-completion` | MUST |
| 2+ 个独立无依赖、文件级无冲突的任务 | `dispatching-parallel-agents` | SHOULD |
| 完成一个 task | `code-reviewer` | SHOULD |
| `/opsx:archive` 前 | `verification-before-completion` + `code-reviewer` | MUST |
| `/opsx:archive` 后 | `finishing-a-development-branch`（清理 worktree） | MUST |
| 里程碑交付前 | `requesting-code-review` | SHOULD |

### 4.3 OpenSpec 工作流规约

#### Change 粒度

一个 OpenSpec change 对应**一个可独立交付的能力**。参考标尺：

- ✅ "实现 `CNBTracker.fetchCandidateIssues`"（独立能力，可测可交付）
- ✅ "起草 PLAN §5 Agent 协议并迁移到 `openspec/specs/`"（独立规范产出）
- ✅ "M0 Spike A：CodeBuddy CLI 能力验证"（独立调研任务）
- ❌ "实现整个 M1"（过大，至少拆 5+ change）
- ❌ "修 `tracker.ts` 的 typo"（过小，直接 commit，走下面的 NOT 清单）

#### 规范约束（4 条）

- `proposal.md` 生成后**必须**人工检查 "Out of Scope" 章节（避免 scope creep）
- `tasks.md` 生成后**必须**人工检查任务顺序与遗漏
- `specs/` 描述**行为**（GIVEN / WHEN / THEN），**不**描述实现（不写"导入什么模块"、"调用什么函数"）
- 功能完成后**必须**执行 `/opsx:archive`，否则新会话会读到旧规范

#### OpenSpec 其他命令

- `/opsx:verify`：`/opsx:archive` 之前**推荐**跑，检查 specs / tasks 一致性
- `/opsx:sync`：当 `specs/` 被手动改动过（例如 M0 结束时 `PLAN.md` → `openspec/specs/` 的一次性迁移），**必须**跑
- `openspec update`：OpenSpec 版本升级后**必须**跑，刷新 agent 指令与斜杠命令

### 4.4 NOT（无需仪式）

以下改动**不触发** OpenSpec 流程，也不触发 Superpowers MUST 清单，直接 commit 即可：

- `README.md` / `PLAN.md` / `AGENTS.md` 的字段调整、typo、链接修复、变更记录追加
- `scripts/` 下的 bash 小改动
- 直接抄 Symphony SPEC 的章节起草（§6 Run 生命周期 11 阶段、§9 超时矩阵 8 值）
- 目录结构微调、文件重命名
- 依赖版本 bump（非大版本）

但仍受 `.codebuddy/rules/karpathy-guidelines.mdc` 约束（think before coding / simplicity first / surgical changes）。

### 4.5 边界（禁用清单）

- 不把 Superpowers 或 OpenSpec 列入 `PLAN.md` / `openspec/specs/` 的**运行时依赖**章节（它们是 dev-time tool）
- 不在 `typescript/` 源码里 import 任何 Superpowers / OpenSpec 概念
- 不复刻 Superpowers / OpenSpec 为 agentfirst-f1 的子模块（定位冲突 —— 本项目是 Symphony 调度器，
  不是 agent 辅助工具集）
- OpenSpec 遥测默认关闭：`export OPENSPEC_TELEMETRY=0`（写入 shell profile）
