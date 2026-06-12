## Why

当前 Dashboard 仍由 `GET /` 返回单个内联 HTML/CSS/JS 页面，前端结构全部堆叠在 `src/logging/http-status-server.ts` 中。随着本项目已完成 M4 的实时 Dashboard 与 SSE 能力，这种单文件实现已经成为 UI 继续演进、复用测试与前后端边界治理的主要瓶颈。

本次变更要把现有状态页升级为 **React + Vite + TypeScript 的 SPA 前端**，在不削弱 `§13` 观测契约的前提下，把 Dashboard 从“可用的内联页面”提升为“可维护、可扩展的 web 前端”。这也为后续 richer filtering、drill-down 与更稳定的前端测试基线提供落点。

## What Changes

- 将当前 `GET /` 的内联 Dashboard 重构为独立构建的 React SPA，并由现有 status server 托管静态资源
- 新增 Dashboard bootstrap API，为前端首屏提供配置概览、初始 snapshot、repo URL 与服务时间等聚合数据
- 保留现有 `POST /api/v1/refresh` 与 SSE 主能力，但将 Dashboard 前端消费的事件/状态边界收口为更稳定的 SPA 契约
- 将当前 Dashboard 的 DOM 拼接与原生事件处理拆分为模块化组件、hooks、API client 与 SSE client
- 引入最小前端工具链（React + Vite + TypeScript），补充开发构建脚本与前端测试入口
- 调整 `GET /` 的交付语义：从“运行时拼接 HTML”切换为“返回 SPA shell + 静态资源”，但仍由同一个 status server 提供访问入口

## Capabilities

### New Capabilities
- `dashboard-web-frontend`: 基于 React + Vite + TypeScript 的模块化 Dashboard SPA，覆盖 header、config strip、metric grid、issue sidebar 与 live events panel
- `dashboard-bootstrap-api`: 为 Dashboard SPA 提供统一首屏初始化数据，避免首屏渲染依赖多次分散请求

### Modified Capabilities
- `sse-event-stream`: 面向 SPA 前端明确全局/issue 级事件流的消费契约、连接状态与 snapshot 回补语义

## Impact

- **代码**：`typescript/src/logging/http-status-server.ts`、新的前端源码目录与静态资源托管逻辑、Dashboard 相关测试文件、`typescript/package.json` 构建脚本
- **API**：新增 `GET /api/v1/dashboard/bootstrap`；`GET /` 改为托管 SPA shell；保留 `GET /api/v1/events`、`GET /api/v1/events?issueId=...`、`POST /api/v1/refresh`
- **依赖**：新增 React / Vite / 前端测试相关最小依赖；继续保持 Node.js 20 + TypeScript 主线，不引入额外后端 Web 框架
- **系统**：status server 从内联页面生成器收敛为“静态前端托管 + API + SSE”服务；前端开发流程新增 build/dev/test 入口
- **PLAN.md 章节**：`§13 Logging / Status / Observability`（Dashboard 展现面与 status API 边界）、`§17 Test Matrix`（前端组件测试与服务端契约测试基线）
