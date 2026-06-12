## Context

当前 Dashboard 由 `typescript/src/logging/http-status-server.ts` 在运行时直接拼接整页 HTML、CSS 和浏览器端 JS。这个实现对 M4 的最小可观测目标足够，但它把页面结构、样式、状态管理、SSE 连接与服务端路由全部耦合在同一个文件中，已经明显超出可维护阈值：

- UI 改动需要同时修改字符串模板、内联样式和原生 DOM 操作
- 前端无法以组件、hooks、模块边界复用或测试
- `GET /` 的交付方式仍是“拼页面”，难以承接后续 richer filtering / drill-down
- 当前 README 仍将 Dashboard 描述为 `GET /` 返回的实时 HTML；本次变更需要把它升级为真正的 web 前端，但不能破坏 `§13` runtime snapshot / SSE 作为观测旁路的契约

约束与相关方：
- 技术栈仍受 AGENTS.md 约束：Node.js 20、pnpm、TypeScript strict、最小依赖原则
- status server 仍需作为统一入口提供 Dashboard、JSON API 与 SSE，避免给用户引入第二套部署面
- 现有 `/api/v1/events` 与 `/api/v1/refresh` 已被文档与测试覆盖，迁移时应优先保持主能力连续
- 用户已确认目标不是“继续打磨单页内联 UI”，而是升级为 **React + Vite + TypeScript 的 SPA 前端**

## Goals / Non-Goals

**Goals:**
- 将 Dashboard 前端从 `http-status-server.ts` 中剥离为独立的 React + Vite + TypeScript SPA
- 保持 status server 作为统一 HTTP 入口，同时负责静态资源托管、bootstrap API、refresh API 与 SSE
- 新增首屏 bootstrap 聚合接口，避免前端首屏依赖多次散请求与隐式模板注入
- 基于当前已确认的最终 UI 稿落地模块化页面结构：header、config strip、metric grid、issue sidebar、live events panel
- 为 Dashboard 建立可维护的前端测试与构建基线，并保持 `§13` 观测契约不反向影响 orchestration 主流程

**Non-Goals:**
- 不把整个仓库改造成多 package workspace / monorepo
- 不引入额外后端 Web 框架或把 status server 改造成独立 BFF 服务
- 不在本次变更中增加多页面路由、用户鉴权、主题系统或历史分析页
- 不改变 scheduler / EventBus / runtime snapshot 的核心职责；本次重点是前端交付形态与面向前端的 API 收口
- 不以“前端重构”为由重写所有现有 JSON / SSE 接口，只在 SPA 首屏与消费边界上增加必要契约

## Decisions

### D1：前端采用 React + Vite + TypeScript，而不是继续原生 DOM 或引入更重框架

**Chosen:** 在 `typescript/` 包内新增独立 Dashboard 前端源码目录，使用 React + Vite + TypeScript 构建。

**Alternatives considered:**
- 保持原生 HTML/CSS/ESM：依赖最少，但会把组件拆分、状态管理与测试全部变成手工约定，继续放大当前维护问题
- Vue + Vite：同样可行，但用户已明确选择 React 方向
- Next.js / Remix 等全栈框架：超出当前 status server 模型，且会引入不必要的 SSR / server runtime 复杂度

**Rationale:**
- React 能直接承接当前已确认的 UI 结构拆分与交互状态管理
- Vite 是最小且成熟的前端构建链，能在不引入重型 monorepo 的前提下提供 dev/build/test 基线
- 仍保持在现有 `typescript/` 包内，避免让仓库管理方式与部署模型同时重构

### D2：保持“单仓单包”，但在 `typescript/` 内建立清晰的前端源码与构建产物边界

**Chosen:** 前端源码与构建配置放在 `typescript/` 下的独立目录中，构建产物输出到服务端可托管的静态目录；后端和前端共用同一个 `package.json`。

**Alternatives considered:**
- 新建第二个 package：边界更清晰，但会把当前仓库直接推向 workspace 管理，超出这次最小升级目标
- 继续把前端放回 `src/logging/`：改造快，但与“更正规的前端结构”目标冲突，后续依然会回到单文件耦合

**Rationale:**
- 这条路在目录治理、构建流程与部署稳定性之间取得最小风险平衡
- 共享同一套 pnpm / TypeScript / vitest 基础设施，降低迁移摩擦

### D3：`GET /` 从“运行时拼 HTML”切换为“返回 SPA shell + 静态资源”，但保留同一个 status server 入口

**Chosen:** status server 继续监听同一端口并负责：
- `GET /` 返回 SPA 入口 HTML
- 托管前端构建产物（JS/CSS/assets）
- 暴露 `/api/v1/dashboard/bootstrap`、`/api/v1/refresh`、`/api/v1/events`

**Alternatives considered:**
- 开发和生产都完全分离为前后端两个 HTTP 服务：开发期灵活，但会改变现有部署心智并引入跨域/代理复杂度
- 继续在后端模板中注入前端数据：能减少一个 bootstrap 请求，但会把 SPA 再次绑定到服务端模板拼接逻辑

**Rationale:**
- 对最终用户与现有 daemon 模式来说，Dashboard 仍是“开一个服务、访问一个地址”
- 让 `http-status-server.ts` 回归 web server 职责，而不是页面生成器
- 生产态部署模型保持稳定，开发态可通过 Vite dev server 代理 API/SSE 获得更好体验

### D4：新增 bootstrap API，而不是让 SPA 首屏依赖模板注入或多次分散请求

**Chosen:** 新增 `GET /api/v1/dashboard/bootstrap`，统一返回：
- config 摘要
- 初始 runtime snapshot
- repo URL / tracker 展示元数据
- serverTime（以及前端计算 uptime 所需的基线）

**Alternatives considered:**
- 继续从 `/api/v1/state` + 内联模板常量拼装：仍会保留前后端隐式耦合，且首屏需要多处拼接
- 让前端首屏并发请求多个 endpoint：实现简单，但前端初始化状态复杂度更高，也不利于测试稳定性

**Rationale:**
- bootstrap 能让 Dashboard 首屏状态与 UI 直接对齐
- 它只新增前端友好的聚合接口，不要求推翻现有 `/api/v1/state` 或 SSE 能力
- 遇到 SSE 初次连接延迟时，首屏仍能稳定渲染完整布局

### D5：保留现有 SSE / EventBus 主能力，但前端消费模型显式化

**Chosen:** 继续复用 `EventBus` 与 `/api/v1/events`，但在 SPA 数据层中把连接状态、snapshot 更新、issue 级事件缓存与 gap 回补处理集中在 hooks / client 层。

**Alternatives considered:**
- 改成 WebSocket：不符合当前单向推送需求，也会新增依赖与服务器复杂度
- 完全重做 SSE payload：改动范围会外溢到 `§13` 已落地能力与现有测试，风险不必要地升高

**Rationale:**
- 现有 SSE 能力已经验证可用，应优先复用
- 本次变更的重点是前端交付与模块化，而非重写实时推送协议
- 通过 bootstrap + 前端数据层收口，已经能满足 SPA 可靠消费的需求

### D6：测试分层为“前端组件/数据层 + status server 契约”，不首发引入重型 E2E

**Chosen:**
- 为前端增加组件测试和数据层测试
- 保留并改造 status server 测试，验证静态资源托管、bootstrap API、SSE/refresh 路径

**Alternatives considered:**
- 只保留服务端测试：无法覆盖新的 React 组件结构与状态派生
- 直接补齐完整浏览器 E2E：价值高，但会显著扩大本次提案范围与工具链复杂度

**Rationale:**
- 组件测试足以覆盖大部分 UI 回归风险
- 服务端契约测试继续保障 `§13` 面的稳定性
- 把测试重心放在最容易因这次改造出错的边界上，成本收益比最高

## Risks / Trade-offs

- [前端依赖增加] -> 仅引入 React、Vite 与最小测试依赖，不新增额外后端框架或 monorepo 管理层
- [`GET /` 交付方式变化可能影响现有测试与文档] -> 同步更新 README、status server 测试与 OpenSpec 规格，确保新入口语义明确
- [前后端目录并存可能导致构建脚本复杂化] -> 统一在 `typescript/package.json` 中定义清晰的 dev/build/test 脚本，避免隐式步骤
- [SSE 在 SPA 中的状态管理更复杂] -> 用单一数据层 hook 收口 EventSource 生命周期、连接状态与 issue 缓存，避免组件层直接操作 EventSource
- [bootstrap 与 `/api/v1/state` 的职责重叠] -> 明确 bootstrap 仅服务 Dashboard 首屏聚合，不替代 `§13` runtime snapshot 的基础契约
- [迁移期间存在 UI 空窗风险] -> 先保留 API/SSE 与后端入口，再替换 `GET /` 的页面交付，确保服务端主能力持续可验证

## Migration Plan

1. 在 `typescript/` 包内建立前端源码目录、Vite 配置与基础脚本，但暂不切换 `GET /`
2. 新增 Dashboard bootstrap API 与静态资源托管能力，保持现有 SSE / refresh 路径可用
3. 实现 React SPA 页面、组件与数据层，并让开发态通过代理接入现有 API/SSE
4. 将 `GET /` 从内联 HTML 切换为 SPA shell，移除旧的内联 Dashboard 模板代码
5. 更新测试、README 与相关文档，验证 build、服务端启动与 Dashboard 基本交互

**Rollback:**
- 若 SPA 交付或静态托管在上线前验证失败，可回滚到旧的 `renderDashboardHtml()` 路径
- 新增的 bootstrap API 与静态资源目录在回滚时可保留为未暴露能力，不影响现有 `/api/v1/events` 与 `/api/v1/refresh`

## Open Questions

- 当前没有阻塞本次提案推进的开放问题；默认按用户已确认的 React + Vite + TypeScript 方案继续
- 若实现阶段发现需要为 `/api/v1/state` 与 bootstrap 进一步做字段复用整理，可在 `/opsx:apply` 中作为实现内的局部决策处理，不回退当前设计主线
