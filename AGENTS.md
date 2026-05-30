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
| Agent SDK | **`@tencent-ai/agent-sdk`** | in-process agent 执行（local worker）；CLI subprocess 保留为 SSH fallback |
| 子进程 | **原生 `child_process.spawn` + `readline`** | SSH worker fallback；不引 execa |
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

**OpenSpec 管规划，Superpowers 管编码纪律**。新功能以 OpenSpec change 为单位推进；Superpowers 在 propose / apply / archive 等关键节点提供强制或推荐的开发纪律。

- **OpenSpec**：提供 `/opsx:propose` / `/opsx:apply` / `/opsx:archive` 三段工作流
- **Superpowers**：提供 `brainstorming` / `test-driven-development` / `verification-before-completion` 等 skill

### 主流程纪律

1. **新功能一律先 propose**
   调用 `/opsx:propose` 前，必须先调用 `brainstorming`。
   `brainstorming` 完成即可直接 `/opsx:propose`，`/opsx:propose` 产出文档（不要额外再跑 `writing-plans`）。

2. **`/opsx:apply` 中的行为性任务必须 TDD**
   引入或改变运行时行为的实施项必须启用 `test-driven-development`：先写失败测试，再写实现。
   豁免仅限"无行为变化"的纯文档 / 纯配置 / 纯类型声明移动；一旦涉及函数体、控制流、I/O、业务规则、状态迁移即不可豁免。

3. **并行派发只针对无依赖的顶层任务**
   `tasks.md` 有 5+ 个顶层 task 时推荐 `dispatching-parallel-agents`。派发前必须确认任务间无依赖、文件级无冲突（两任务改同一核心文件则不可并行）；有疑问串行。

4. **审查分两层**
   - 每完成一个顶层task：推荐使用 `code-reviewer`，此阶段不要求 `verification-before-completion`
   - `/opsx:archive` 一个 proposal 前：必须运行 `verification-before-completion`，并使用 `code-reviewer` 做整体审查

   二者不可互相替代：`verification-before-completion` 负责跑真实命令拿证据，`code-reviewer` 负责发现代码、设计和一致性问题。

5. **debug 必须先系统化定位**
   测试失败、未预期行为、诡异日志任一出现，必须启用 `systematic-debugging`；禁止猜测原因或直接改代码碰运气。

6. **新运行时行为必须使用 Git Worktree 隔离**
   新运行时行为的改动，必须启用 `using-git-worktrees`，在独立 Git Worktree 中开发。以下情况可直接在主分支处理：
   - 纯文档改动（注：`prompts/*.md` 除外，它定义 Agent 运行时行为）
   - 单文件 typo / 链接修复 / 非行为性配置（不新增运行时依赖）
   - 脚本小 bug fix（不新增脚本、不改主流程语义）

7. **完成宣告才触发最终 verification**
   只有宣告整个顶层 task / proposal / PR 完成前需要 `verification-before-completion`；中间进度汇报（如"第 1 步做完，进入第 2 步"）不触发。

### 技能触发速查表

档位说明：

- **MUST**：硬性要求，不做视作流程违规
- **SHOULD**：推荐，有合理理由可跳过，需在 PR / commit 说明
- **MUST NOT**：明确禁止

| 触发场景 | 调用 skill / 动作 | 档位 |
|---|---|---|
| 启动引入新运行时行为的新功能开发，且不属于主流程第 6 条的豁免场景 | `using-git-worktrees` + `brainstorming` | MUST |
| 准备调用 `/opsx:propose`，但尚未完成脑暴 | `brainstorming` | MUST |
| `brainstorming` 完成后准备 propose | 直接 `/opsx:propose`，跳过 `writing-plans` | MUST NOT 调 `writing-plans` |
| `/opsx:apply` 中实现运行时行为 / 修 bug | `test-driven-development` | MUST |
| 测试失败、异常行为、诡异日志，任一出现 | `systematic-debugging` | MUST |
| 宣告整个顶层 task / proposal / PR 完成前（不含中间进度汇报） | `verification-before-completion` | MUST |
| `tasks.md` 有 5+ 个顶层 task，且已确认无依赖、文件无冲突 | `dispatching-parallel-agents` | SHOULD |
| 完成一个 `tasks.md` 顶层 task | `code-reviewer` | SHOULD |
| `/opsx:archive` 前 | `verification-before-completion` + `code-reviewer` | MUST |
| `/opsx:archive` 后 | `finishing-a-development-branch`，清理 worktree | MUST |
| 里程碑交付前（user 主动要求） | `requesting-code-review` | SHOULD |