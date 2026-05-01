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

## 4. 开发流程：Superpowers Skill 使用规约

开发过程中使用 Claude Code superpowers 插件协助。Superpowers 是**插件级外部依赖**，**不是本项目的运行时依赖**；
使用者无需手动安装，agent 会在关键节点主动 `use_skill` 加载。

### MUST（强制）

- **起草 `PLAN.md` 任何新章节之前** → `brainstorming`
  - 理由：§4 Tracker / §5 Agent 协议这类难章节最容易拍脑袋定接口
- **任何 spike / 探索性验证动手之前** → `brainstorming`
  - 理由：spike 最容易漏维度，先列验证清单再跑命令
- **`typescript/src/` 下任何模块实现之前** → `writing-plans`
  - 理由：调度器是状态机项目，无计划直接写等于预定返工
- **任何模块被声明"完成 / 交付 / 修复"之前** → `verification-before-completion`
  - 理由：调度器极易"看着能跑、实际错的"

### SHOULD（推荐）

- **实现 continuation / Run 生命周期状态机核心** → `test-driven-development`
  - Symphony 语义严格，TDD 是最快的实现路径
- **debug 并发 / 死锁 / 事件流顺序问题** → `systematic-debugging`
- **里程碑交付前** → `requesting-code-review`

### NOT（无需仪式）

- `README.md` / `PLAN.md` 的字段调整、typo、链接修复
- `scripts/` 下的 bash 小改动
- 直接抄 Symphony 的章节起草（§6 Run 生命周期 11 阶段、§9 超时矩阵 8 值）
- 目录结构微调、变更记录追加

### 边界

- 不把 superpowers 列入 `PLAN.md` 的依赖章节
- 不在 `typescript/` 源码里 import 任何 superpowers 概念
- 不复刻 superpowers 为 agentfirst-f1 的子模块（定位冲突 —— 本项目是调度器，不是 agent 辅助工具集）
