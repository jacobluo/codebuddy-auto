# cnb.cool Issue API 能力验证报告（Spike B）

> **Change**: `openspec/changes/m0-spike-codebuddy-and-cnb/`
> **产出**: 解除 PLAN §4 Tracker 契约起草阻塞 + 为 `cnb-tracker-backend` capability 提供行为输入
> **采集日期**: 2026-05-01
> **采集工具**: `scripts/spike-b-probe.sh`（可回归运行）
> **原始数据**: `tmp/spike-b-raw-output.txt`（506 行，21 个 HTTP 响应头 + 响应体）
> **测试仓库**: `relaxorg/agentfirst-f1`（本项目自身）；测试 fixture（3 个 issue + 2 个 label）留在仓库供后续回归复用

---

## 摘要（一句话结论）

🟡 **cnb.cool Issue API 能承接 Symphony §11 Tracker Integration 契约的核心语义**（按 label 过滤 /
comment / label / state / assignee 全部原生支持），但**有三处降级**：
（1）**无批量按 id 查询**，tick 内按 N issue 必发 N 次 GET；
（2）**labels 过滤是 OR 语义**，"含 agent-ready 且不含 skip-agent"必须 orchestrator 侧客户端过滤；
（3）**无 custom fields** + **无公开 rate-limit header**，Symphony §11 的 `attempt` 等元数据需用 label 前缀约定承载。
`cnb_api` agent-side MCP 工具天然可落地（经 Spike A 确认 CodeBuddy CLI 支持 `--mcp-config`）。

---

## 环境

| 项 | 值 |
|---|---|
| API Base URL | `https://api.cnb.cool` |
| 认证 | `Authorization: Bearer <access-token>` |
| Token 来源 | cnb.cool → 个人设置 → 访问令牌（或本地 `~/.git-credentials` 中 `https://cnb:<token>@cnb.cool` 同一串） |
| Content-Type | `application/json` |
| Accept（读） | `application/json` |
| Accept（部分写，如 `PATCH /issues/:n`） | **`application/vnd.cnb.api+json`**（否则返回 406） |
| 服务器 | `nginx/1.28.2` / HTTP/2 |
| 官方文档 | https://docs.cnb.build/zh/develops/openapi.html |
| OpenAPI Playground | https://api.cnb.cool/ （SPA，需浏览器渲染） |
| Access Token 指南 | https://docs.cnb.build/zh/guide/access-token.html |

---

## Symphony 兼容性裁决表

### §11 Tracker Integration 三项 REQUIRED operation

| Symphony §11 要求 | cnb.cool 能力 | 结论 |
|---|---|---|
| **#1** `fetchCandidateIssues(labels, states)` — 返回带 label 且在 active state 的 issue | `GET /{repo}/-/issues?labels=agent-ready&state=open` | 🟢 原生支持（但注意 labels 是 OR，单 label 过滤安全；多 label 需客户端二次过滤） |
| **#2** `fetchIssuesByStates(states)` — 返回所有 terminal state 的 issue（启动时 cleanup） | `GET /{repo}/-/issues?state=closed` | 🟢 支持；`state` 取值仅 `open` / `closed`（`all` 返回 400） |
| **#3** `fetchIssueStatesByIds(ids[])` — 批量刷新 active run 对应 issue 的最新 state | ❌ **不支持按 id 批量过滤** | 🟡 参数 `numbers=` / `ids=` 被服务器忽略；fallback 为 N 次并发 `GET /issues/:number`，延迟约 80-180ms/次（详见 §3.1 实现大纲） |

### §4.1.1 Issue 字段对位

| Symphony Issue 字段 | cnb.cool 字段 | 备注 |
|---|---|---|
| `id` | `number`（字符串，如 `"1"`） | **注意**：cnb 用 `number` 作为 issue 内顺序号，且是 string |
| `identifier` | 拼接 `#<number>`（如 `"#1"`） | orchestrator 侧合成 |
| `title` | `title` | 直接 |
| `description` | `body` | 直接 |
| `state` | `state`（`open` / `closed`） | 二值；**细化靠 `state_reason`**（如 `completed` / `reopened`） |
| `priority` | `priority`（`""` / `P0` / `P1` / `P2` …） | 空串表示未设 |
| `labels` | `labels[].name` | 带 `id` / `color` / `description` / `creator` / `applied_by` |
| `assignees` | `assignees[].username` | 多人 |
| `author` | `author.username` | 单人 |
| `created_at` / `updated_at` | 同名 ISO 8601 | UTC `Z` 结尾 |
| `last_acted_at` / `started_at` / `ended_at` | cnb 特有 | 可选，空串表示未发生 |
| `comment_count` | `comment_count` | 整数 |
| `blocked_by` | ❌ cnb 无原生依赖；按 **label 前缀约定** `blocked-by:#N` 模拟（见 §3.6） | 符合 `cnb-tracker-backend/spec.md` "Blocker relationship" Requirement |

### §10.5 client-side tool `cnb_api`（替代 Symphony `linear_graphql`）

Spike A 已确认 CodeBuddy CLI 支持 `--mcp-config`。本 Spike 确认 cnb 提供全部必要的 agent-side 写端点：

| 工具名（拟） | 后端端点 | 状态 |
|---|---|---|
| `cnb_api.comment(issue, body)` | `POST /issues/:n/comments` | 🟢 201 |
| `cnb_api.addLabels(issue, labels[])` | `POST /issues/:n/labels` | 🟢 200 |
| `cnb_api.removeLabel(issue, name)` | `DELETE /issues/:n/labels/:name` | 🟢 200 |
| `cnb_api.setState(issue, state, reason)` | `PATCH /issues/:n` + `Accept: application/vnd.cnb.api+json` | 🟢 200（**state/state_reason 必须成对**） |
| `cnb_api.setAssignees(issue, usernames[])` | `POST /issues/:n/assignees` + vnd accept | 🟢 201 |
| `cnb_api.setPriority(issue, priority)` | `PATCH /issues/:n` + vnd accept + `{"priority":"P1"}` | 🟢 200 |
| `cnb_api.setTitle(issue, title)` | `PATCH /issues/:n` + vnd accept + `{"title":"..."}` | 🟢 200 |

---

## 验证清单（20 项 × 6 维度 + tasks §2.7）

### §2.1 Auth & basics

- ✅ **2.1.1** 认证：`Authorization: Bearer <token>`。Token 从 cnb 个人设置 "访问令牌" 生成；也复用于 git HTTPS（用户名固定 `cnb`，密码 = token）
- ✅ **2.1.2** 最小调用：`GET /user` → 200；`GET /relaxorg/agentfirst-f1/-/issues?page=1&page_size=5` → 200 `[]`
- 🟡 **2.1.3** Rate limit：**未暴露 `X-RateLimit-*` header**。串行 20 次 `/issues` 无限流痕迹（全部 200，平均 85ms）。具体阈值需线上观察或联系 cnb 支持
- ✅ **2.1.4** 文档：https://docs.cnb.build/zh/develops/openapi.html （入门） + https://api.cnb.cool/ （交互式）

### §2.2 Candidate query

- ✅ **2.2.1** label 过滤：`?labels=agent-ready` → 只返回带该 label 的 issue；分页 header `x-cnb-total` 准确
- ✅ **2.2.2** state 过滤：`?state=open` 或 `?state=closed`；**`state=all` 返回 400**（需分两次请求或不带参数）
- ❌ **2.2.3** **多 label 是 OR，不是 AND；没有 NOT 语法**。实测 `?labels=agent-ready,skip-agent` 返回并集（任一命中）。否定过滤（`not_labels=`）参数被忽略。**必须 orchestrator 侧二次过滤**
- ✅ **2.2.4** 分页：`?page=1&page_size=N`；响应头 `x-cnb-page` / `x-cnb-page-size` / `x-cnb-total`；`page_size=500` 接受无报错（上限未测，建议保守 ≤100）
- ✅ **2.2.5** 排序：`?sort=<field>&order=asc|desc`；验证 `created_at` / `priority` 两个字段；其他字段未逐一验

### §2.3 Batch query

- ❌ **2.3.1** **按 id 批量查询不支持**：`?numbers=1,2,3` 和 `?ids=1,2,3` 参数都被静默忽略（服务端返回全量）。**这是 `design.md` R3 确诊**（batch-by-id 缺失 → N-factor 延迟）
- 🟡 **2.3.2** 单条 GET `/issues/:number` 平均 80-180ms（本地到 cnb.cool，海外线路）。N 个 issue 的 tick 成本 ≈ N × 100ms（串行）或 max(100ms, N/M × 100ms)（M 并发）。M1 建议并发 5 起步
- ✅ **2.3.3** Terminal cleanup：`GET /issues?state=closed&page_size=50` 单次覆盖所有关闭 issue（满足 Symphony §8.5 启动恢复需求）

### §2.4 Agent-side write ops

- ✅ **2.4.1** Comment：`POST /issues/:n/comments`，body `{"body":"..."}` → 201；响应含 `id` / `author` / `created_at`
- ✅ **2.4.2** Label 增删：
  - 加：`POST /issues/:n/labels` + `{"labels":["a","b"]}` → 200（返回当前全量 label）
  - 删：`DELETE /issues/:n/labels/<name>` → 200（返回剩余 label）
  - **前置**：label 必须先通过 `POST /{repo}/-/labels` 创建；**创建 issue 时带 `labels` 字段会被忽略**（不会自动挂上）
- ✅ **2.4.3** State：`PATCH /issues/:n` + `Accept: application/vnd.cnb.api+json` + `{"state":"closed","state_reason":"completed"}` → 200。**`state` 和 `state_reason` 必须成对出现**，否则返回 400 errcode 2000054。Reopen 用 `{"state":"open","state_reason":"reopened"}`
- ✅ **2.4.4** Assignee：`POST /issues/:n/assignees` + vnd accept + `{"assignees":["<username>"]}` → 201
- 🟡 **2.4.5** **Token scope**：cnb 访问令牌支持"使用范围"+"授权范围"两层。实测当前 token 成功完成所有 4 种 mutation；**建议 PLAN §10 Preflight 在启动时调一次 `GET /user` + 最小测试写，确保 scope 充足**。具体 scope 枚举值需在 cnb 个人设置"添加访问令牌"页面查看（文档未公开）

### §2.5 Custom fields

- ❌ **2.5.1** `GET /{repo}/-/custom_fields` → 404：**cnb 无 issue 级 custom fields**
- ❌ **2.5.2** `GET /issues/:n/custom_fields` → 404：同上
- ✅ **2.5.3** **推荐方案**：用 **label 前缀约定**承载 Symphony 的 `attempt` / `blocked-by` / 其他元数据。例如：
  - `attempt:3`（重试次数）
  - `blocked-by:#102`（阻塞关系；符合 `cnb-tracker-backend/spec.md` 已定义的 Requirement）
  - `agent-status:running` / `agent-status:needs-review`（状态标签，可视化友好）
  - orchestrator 负责在每次 poll 前后同步这些 label（add/remove），agent 通过 `cnb_api.addLabels/removeLabel` 写

### §2.6 Webhook（可行性）

- ❓ **2.6.1** `GET /{repo}/-/webhooks` 和 `/hooks` 都返回 404（可能是路径不对或需 admin scope）。官方文档 `/zh/develops/openapi-event.html` 提到"仓库动态"webhook 存在。**M4 评估再做深度 spike**；本阶段结论：存在但路径/权限未知 → Unknown

### §2.7 Artifact & evaluation

- ✅ **2.7.1** 本报告 + 原始样本 `tmp/spike-b-raw-output.txt` + 可回归脚本 `scripts/spike-b-probe.sh`
- ✅ **2.7.2** **Verdict**：🟡 **cnb API 能承接 Symphony §11，但有 3 处已量化的降级**（batch-by-id 缺失 / labels OR-only / custom fields 缺失）。详见本报告 §3

---

## 3. 设计建议（面向 PLAN §4 起草）

### 3.1 Tracker 接口的 cnb 实现大纲

```ts
// src/tracker/cnb.ts 伪代码
class CnbTracker implements Tracker {
  constructor(
    private readonly apiBase: string,   // "https://api.cnb.cool"
    private readonly repo: string,      // "relaxorg/agentfirst-f1"
    private readonly token: string,     // Bearer
    private readonly candidateLabel: string = 'agent-ready',
    private readonly excludeLabel: string = 'skip-agent',
  ) {}

  async fetchCandidateIssues(): Promise<Issue[]> {
    // Symphony §11 REQUIRED #1
    const raw = await this.get(`/issues?labels=${this.candidateLabel}&state=open&page_size=100`);
    // 客户端二次过滤：排除 skip-agent（因为 API 无 NOT 语义）
    return raw
      .filter(i => !i.labels.some(l => l.name === this.excludeLabel))
      .map(normalizeIssue);
  }

  async fetchIssuesByStates(states: ('closed' | 'open')[]): Promise<Issue[]> {
    // Symphony §11 REQUIRED #2 — 启动时 active-run cleanup
    const results = await Promise.all(
      states.map(s => this.get(`/issues?state=${s}&page_size=100`))
    );
    return results.flat().map(normalizeIssue);
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Map<string, IssueState>> {
    // Symphony §11 REQUIRED #3 — 每 tick 刷新 active run
    // ⚠️ cnb 无 batch-by-id；回退到并发单查
    if (ids.length === 0) return new Map();
    const concurrency = 5;  // 初始值，M3 根据 rate-limit 反馈调
    return mapLimit(ids, concurrency, async id => {
      try {
        const i = await this.get(`/issues/${id}`);
        return [id, { state: i.state, state_reason: i.state_reason, labels: i.labels.map(l => l.name) }];
      } catch (e) {
        if (e.status === 404) return null;  // 被删除
        throw e;
      }
    }).then(entries => new Map(entries.filter(Boolean)));
  }
}
```

### 3.2 Accept 头的双轨

- **读接口 / 创建类 POST**：`Accept: application/json`
- **`PATCH /issues/:n`（以及其他 mutation）**：`Accept: application/vnd.cnb.api+json`
- Runner 侧 HTTP 客户端建议封装成两个 helper，避免散落

### 3.3 状态映射表（对应 spec 要求）

| Symphony 语义状态 | cnb `state` | cnb `state_reason` |
|---|---|---|
| Todo / Open | `open` | `open` |
| InProgress | `open` | `open`（额外靠 label `agent-status:running` 区分） |
| Done / Closed（正常完成） | `closed` | `completed` |
| Cancelled | `closed` | `not_planned`（待查 cnb 取值） |
| Duplicate | `closed` | `duplicate`（待查） |
| Reopened | `open` | `reopened` |

⚠️ `state_reason` 的完整枚举 cnb 文档未全量列出；M1 实现时增加一个 probe 步骤，调 `PATCH` 故意写错值看 400 消息中的合法值，或者直接穷举常见 GitHub/GitLab 命名去探。

### 3.4 `cnb_api` MCP server 设计

紧跟 Spike A §"意外发现：MCP 集成" 的结论，规划如下 MCP tool（用 Node MCP SDK 或简单 stdio wrapper 实现）：

```jsonc
// runner/mcp-config/cnb-api-mcp.json 骨架
{
  "mcpServers": {
    "cnb_api": {
      "command": "node",
      "args": ["dist/mcp/cnb-api-server.js"],
      "env": {
        "CNB_TOKEN": "...",
        "CNB_REPO": "relaxorg/agentfirst-f1"
      }
    }
  }
}
```

暴露的工具（按上文 "§10.5 client-side tool" 表的 7 项）。Agent 在会话里直接调 `mcp__cnb_api__comment({issue, body})` 等。

### 3.5 元数据 label 约定（取代 custom fields）

| 用途 | 约定 | 例子 |
|---|---|---|
| 候选过滤 | `agent-ready` | 固定单 label |
| 排除 | `skip-agent` | 固定单 label；orchestrator 客户端过滤 |
| 重试计数 | `attempt:<N>` | `attempt:3` |
| 阻塞关系 | `blocked-by:#<number>` | `blocked-by:#102` |
| 调度器私有状态 | `agent-status:<phase>` | `agent-status:running` / `agent-status:needs-review` |

所有 `<prefix>:<value>` 形式的 label 由 orchestrator / agent 自动 add / remove；用户手动添加的 label 不加冒号前缀，orchestrator 侧按 `name.includes(':')` 判定是否"受管理"。

### 3.6 Blocker 支持（对应 `spec.md` Requirement "Blocker relationship via blocked-by:#N label convention"）

cnb 无原生 issue 依赖关系。Spec 已要求按 `blocked-by:#N` label 约定模拟，**本 spike 确认了可行性**：

1. 读候选时：parse 每个 issue 的 labels，正则 `^blocked-by:#(\d+)$` 抽出 blocker id 列表
2. orchestrator 在 dispatch 前用 `fetchIssueStatesByIds(blockerIds)` 检查是否都进入 terminal（`state=closed`）
3. 未解除的 blocker 导致该 issue 本 tick 不被 dispatch（Symphony §8.2）

### 3.7 Preflight（PLAN §10）针对 cnb 的 MUST 项

启动时必须调的探针：

1. `GET /user` — 认证正确性 + token 未过期
2. `GET /{repo}/-/issues?page_size=1` — repo 路径正确 + 读权限
3. `POST /{repo}/-/issues/X/comments` 到一个 sentinel issue（可选） — 写权限充足
4. 记录一次 `x-cnb-total`（本次 tick 候选池大小）用于后续 log

---

## 4. 已知风险 / 待压测项

| 编号 | 风险 | 缓解 |
|---|---|---|
| **R1** | batch-by-id 缺失，N issue 需 N 请求 | M1 用 Promise.allSettled 5 并发；M2 加 LRU 缓存（last-known state + updated_at heuristics）；M3 回归评估 |
| **R2** | `labels=` 是 OR 语义，无 AND/NOT | orchestrator 侧二次过滤；写单测覆盖 3 种组合（仅 agent-ready / 含 skip-agent / 两者都含） |
| **R3** | 无公开 rate-limit header / 阈值 | M1 runner 遇 429 回退（指数退避 + Retry-After 若有）；观测 10+ 次请求无异常后才调大并发；若生产遇限流，联系 cnb 平台 |
| **R4** | `state_reason` 枚举不明 | M1 探测 + 文档补齐；异常值当前是 400 errcode 2000054 的"成对出现"，而非"值非法" |
| **R5** | 访问令牌 scope 枚举不公开 | Preflight 用最小写操作 ping 一次；README 给出"推荐 scope 勾选"截图指引（文档补充） |
| **R6** | labels 必须先于 issue 创建 | Tracker 启动时 `POST /labels` 确保 `agent-ready` / `skip-agent` / 等约定 label 存在（幂等：409 视同存在） |
| **R7** | Webhook 路径 / 权限不明 | M4 再 spike；M1-M3 一律 poll |
| **R8** | 海外线路延迟 80-180ms/单请求 | 对 orchestrator 内网部署敏感；部署侧文档建议就近机房 |

---

## 5. 意外发现

### F1. `Accept` 头的双轨行为（非预期严格）

部分 mutation 端点（`PATCH /issues/:n`、`POST /issues/:n/assignees`）在 `Accept: application/json` 下返回 406，必须改用 `application/vnd.cnb.api+json`。但读 / 同级端点（`POST /issues/:n/comments` / `POST /issues/:n/labels`）用 `application/json` 就行。没有明显规律（不是全部 PATCH 都要求 vnd），封装层建议 **写 helper 默认带两个 Accept，逗号拼接**：

```http
Accept: application/json, application/vnd.cnb.api+json
```

未实测（本 spike 每个端点只验证了单一 Accept），但 HTTP 语义上服务端应当取其支持的第一个。**M1 Runner 实现时先试逗号拼接写法**，若某端点仍 406 则回退到 per-endpoint 分轨。

### F2. label 创建是"全库级"而非 issue 级

`POST /{repo}/-/labels` 创建的 label 立即对整个仓库生效（返回的 `id` 是库级唯一）。不需要为每个 issue 重建。这让 Tracker 初始化"确保 `agent-ready` 存在"变成一次性操作。

### F3. `number` 字段是字符串

cnb 把 `number` 返回为字符串（`"1"`，不是 `1`）。**TypeScript zod schema 必须 `z.string()` 而不是 `z.number()`**；转 integer 靠 orchestrator 解析。这个坑要在 §3 State Schema 中明确标注。

### F4. 创建 issue 时 `labels` / `assignees` 字段静默失败

`POST /issues` 时 body 里带 `labels: [...]` 或 `assignees: [...]`，服务器返回 201 但 **`labels` / `assignees` 字段不生效**（空数组）。必须用单独的 `POST /issues/:n/labels` 和 `POST /issues/:n/assignees` 端点补挂。Agent 侧 `cnb_api.createIssue` 工具（如果未来要做）必须内部做两跳。

---

## 附录 A：关键 curl 样本

### A.1 认证 smoke

```bash
$ curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    https://api.cnb.cool/user
# → HTTP/2 200
{
  "id": "1926469127541071872",
  "username": "cnb.robiluo",
  "nickname": "robiluo",
  "type": 0,
  "verified": 1,
  "created_at": "2025-05-25T02:43:27Z",
  "email": "dongshuiluo@gmail.com",
  ...
}
```

### A.2 候选 issue 查询（对应 Symphony §11 #1）

```bash
$ curl -sS -D - -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    "https://api.cnb.cool/relaxorg/agentfirst-f1/-/issues?labels=agent-ready&state=open"
# →
HTTP/2 200
x-cnb-page: 1
x-cnb-page-size: 10
x-cnb-total: 2

[
  {
    "number": "3",
    "state": "open",
    "state_reason": "open",
    "title": "[spike-b] test issue #3 (renamed)",
    "author": { "username": "cnb.robiluo", ... },
    "assignees": [ { "username": "cnb.robiluo", ... } ],
    "labels": [
      { "id": "...", "name": "agent-ready", "color": "#2ecc71", ... },
      { "id": "...", "name": "skip-agent", "color": "#95a5a6", ... }
    ],
    "comment_count": 0,
    "priority": "",
    "created_at": "2026-05-01T09:03:49Z",
    "updated_at": "2026-05-01T09:04:22Z",
    ...
  },
  {
    "number": "1",
    "title": "[spike-b] test issue #1",
    "labels": [ { "name": "agent-ready", ... } ],
    ...
  }
]
```

### A.3 单 issue 获取（对应 Symphony §11 #3 fallback）

```bash
$ curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    https://api.cnb.cool/relaxorg/agentfirst-f1/-/issues/1
# →
{
  "number": "1",
  "state": "open",
  "state_reason": "open",
  "title": "[spike-b] test issue #1",
  "invisible": false,
  "author": { "username": "cnb.robiluo", "is_npc": false, ... },
  "assignees": [],
  "comment_count": 1,
  "priority": "",
  "created_at": "2026-05-01T09:03:10Z",
  "updated_at": "2026-05-01T09:03:36Z",
  "started_at": "",
  "ended_at": "",
  "last_acted_at": "2026-05-01T09:03:36Z",
  "body": "Created by spike-b-probe.sh ...",
  "labels": [
    {
      "id": "2050139057733218304",
      "name": "agent-ready",
      "description": "Tracker polls pick this up",
      "color": "#2ecc71",
      "creator": { "username": "cnb.robiluo", ... },
      "applied_by": { "username": "cnb.robiluo", ... }
    }
  ]
}
```

### A.4 Mutation：comment / label / state / assignee

```bash
# Comment
$ curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -d '{"body":"spike-b: probe comment"}' \
    https://api.cnb.cool/relaxorg/agentfirst-f1/-/issues/1/comments
# → 201 { "id":"...", "body":"...", "author":{...}, "created_at":"..." }

# Add labels
$ curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/json" -H "Content-Type: application/json" \
    -d '{"labels":["agent-ready","skip-agent"]}' \
    https://api.cnb.cool/relaxorg/agentfirst-f1/-/issues/3/labels
# → 200 [ {name:"agent-ready",...}, {name:"skip-agent",...} ]

# Remove a label
$ curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    https://api.cnb.cool/relaxorg/agentfirst-f1/-/issues/1/labels/skip-agent
# → 200 [ ...remaining labels... ]

# Close (vnd accept + state+reason pair)
$ curl -sS -X PATCH -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.cnb.api+json" -H "Content-Type: application/json" \
    -d '{"state":"closed","state_reason":"completed"}' \
    https://api.cnb.cool/relaxorg/agentfirst-f1/-/issues/3
# → 200 { ... state:"closed", state_reason:"completed" ... }

# Assignee
$ curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.cnb.api+json" -H "Content-Type: application/json" \
    -d '{"assignees":["cnb.robiluo"]}' \
    https://api.cnb.cool/relaxorg/agentfirst-f1/-/issues/3/assignees
# → 201 { ...issue with assignees populated... }
```

### A.5 反例：`state=all` 被拒

```bash
$ curl -sS -H "Authorization: Bearer $TOKEN" \
    "https://api.cnb.cool/relaxorg/agentfirst-f1/-/issues?state=all"
# → HTTP/2 400
{"errcode":400,"errmsg":"bad request"}
```

### A.6 反例：batch by id 参数被忽略

```bash
# 即使 repo 有 3 个 issue，numbers=1,2,3 参数也完全被忽略（返回全量 3 条）
$ curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    "https://api.cnb.cool/relaxorg/agentfirst-f1/-/issues?numbers=1,2,3" \
  | jq length
# → 3（而非按 id 过滤的结果）
```

---

## 附录 B：端点速查表

| 能力 | Method | 路径（base = `https://api.cnb.cool/{owner}/{repo}/-`） | Accept | 备注 |
|---|---|---|---|---|
| 列 issue | GET | `/issues?labels=&state=open&page=&page_size=&sort=&order=&updated_after=` | json | `x-cnb-total` header |
| 读单 issue | GET | `/issues/:number` | json | |
| 创建 issue | POST | `/issues` | json | body `{title,body}`；labels/assignees 忽略 |
| 改 issue | PATCH | `/issues/:number` | **vnd** | title/body/state+state_reason/priority |
| 列 comment | GET | `/issues/:n/comments` | json | |
| 加 comment | POST | `/issues/:n/comments` | json | body `{body}` |
| 加 label | POST | `/issues/:n/labels` | json | body `{labels:[name...]}` |
| 删 label | DELETE | `/issues/:n/labels/:name` | json | |
| 改 assignee | POST | `/issues/:n/assignees` | **vnd** | body `{assignees:[username...]}` |
| 列库级 label | GET | `/labels` | json | |
| 创库级 label | POST | `/labels` | json | body `{name,color,description}` |
| 用户信息 | GET | `https://api.cnb.cool/user` | json | 不在 repo 前缀下 |

---

## 变更记录

| 版本 | 日期 | 摘要 |
|---|---|---|
| v0.1 | 2026-05-01 | Spike B 首版落地：20 checks + 裁决表 + 7 条设计建议 + 8 条已知风险 |
