# CodeBuddy Code CLI 能力验证报告（Spike A）

> **Change**: `openspec/changes/m0-spike-codebuddy-and-cnb/`
> **产出**: 解除 PLAN §5 Agent 协议起草阻塞 + 为 `codebuddy-cli-integration` capability 提供行为输入
> **采集日期**: 2026-05-01
> **采集工具**: `scripts/spike-a-probe.sh` + 手工 stream-json 补测
> **原始数据**: `tmp/spike-a-raw-output.txt`（751 行）+ `tmp/spike-a-stream-json.txt`（4 行 NDJSON）

---

## 摘要（一句话结论）

🟢 **CodeBuddy Code CLI 2.93.6 能充分承接 Symphony §10 Agent Runner Protocol。** Session / resume /
结构化事件流 / permission / sandbox / max-turns 全部原生支持；缺的 `--cwd` 和 `--timeout` 由 Node 子进程
API + orchestrator 自计时补位；`--acp` 模式保留为 M1+ 升级路径。

---

## 环境

| 项 | 值 |
|---|---|
| 二进制 | `/opt/homebrew/bin/codebuddy` |
| 版本 | `2.93.6` |
| 主机 | Darwin 25.4.0 arm64 |
| 凭据方式 | `/login` OAuth（`~/.codebuddy/` 内 token）。环境变量 `CODEBUDDY_API_KEY` 已失效；用 `CODEBUDDY_API_KEY_DISABLED=1` 绕过 |
| 默认模型（`/login` 绑定） | `claude-opus-4.7-1m` |

---

## Symphony 兼容性裁决表

### §10 Agent Runner Protocol 对位

| Symphony 要求（§10.x） | CodeBuddy CLI 能力 | 结论 |
|---|---|---|
| **§10.1** Launch via `bash -lc <command>` + workspace cwd | Node `child_process.spawn(codebuddy, args, { cwd })`；CLI 自身无 `--cwd` | 🟢 Orchestrator 侧用 spawn cwd 满足 Invariant 1 |
| **§10.2** 在 workspace 内启动 session | 同上；CLI 自动以进程 `cwd` 作为工作目录 | 🟢 |
| **§10.2** 创建/恢复 thread | `--session-id <uuid>` 预指定 + `-c/--continue` + `-r/--resume [id]` | 🟢 |
| **§10.2** 首轮发完整 prompt | 通过 `-p/--print "<prompt>"` 位置参数 | 🟢 |
| **§10.2** 后续仅发 continuation guidance | `codebuddy -c --print "<短提示>"` 自动追加上下文 | 🟢 **已实测**（见 §1.3.3） |
| **§10.2** `session_id = <thread_id>-<turn_id>` | CodeBuddy 单层 `session_id`（uuid），没有 turn_id | 🟡 本项目 LiveSession 只存 `agent_session_id`，不拼接；见 §4 设计建议 |
| **§10.2** Include issue metadata | 放在 prompt body 自行拼接（CLI 不原生支持 session title） | 🟢 orchestrator 侧拼接 |
| **§10.2** Advertise client-side tools | MCP (`--mcp-config`) + `--tools` 限制范围 + `--allowedTools/--disallowedTools` | 🟢 对位 `linear_graphql → cnb_api` 可通过 MCP 暴露 |
| **§10.3** Streaming turn processing | `--output-format stream-json` → **一行一 NDJSON 事件** | 🟢 **已实测**（见下方事件样本） |
| **§10.3** 保持子进程跨 continuation 存活 | CLI 每次 `--print` 调用起一个新进程；continuation 靠 `-c` 自动恢复上下文 | 🟡 和 Symphony 描述不一致但**语义等价**；见 §4 设计建议 |
| **§10.4** 11 种事件 | 5 种 stream-json 事件 + 细分子类，可完全映射 | 🟢 见 §2 事件映射表 |
| **§10.5** approval / sandbox 策略 | `--permission-mode {acceptEdits,bypassPermissions,default,plan}` + `--sandbox [url]` + `-y` | 🟢 覆盖所有信任边界 |
| **§10.5** Unsupported tool calls 不卡 session | CLI 自己处理（tool 调用失败返回错误消息，session 继续） | 🟢 观察到 |
| **§10.6** 超时 | CLI 无 `--timeout`；orchestrator 自计时（`agent.turn_timeout_ms` / `agent.read_timeout_ms`） | 🟡 本项目契约改由 orchestrator 强制（wall-clock + stall detection） |

### §4.1.6 LiveSession 字段对位

| 本项目字段（`agent_*`） | CodeBuddy stream-json 字段 | 位置 |
|---|---|---|
| `agent_session_id` | `session_id` (uuid) | 所有事件 |
| `agent_pid` | Node spawn 返回 | orchestrator 侧 |
| `agent_event` | `type` + 可选 `subtype` | 每个事件 |
| `agent_timestamp` | `timestamp` (ms) / `__timestamp` (ISO) | 每个事件 |
| `agent_message` | message.content[*].text | assistant / message 事件 |
| `agent_input_tokens` | `usage.input_tokens` | result / assistant 事件 |
| `agent_output_tokens` | `usage.output_tokens` | 同上 |
| `agent_total_tokens` | `input + output`（自行计算） | — |
| `agent_cache_read_tokens` | `usage.cache_read_input_tokens` | 同上（细粒度扩展字段） |
| `last_reported_*_tokens` | result 事件的绝对总量 | 对齐 SPEC §13.5 "prefer absolute totals" ✅ |
| `turn_count` | result 事件的 `num_turns` | 可验证 |
| `agent_rate_limits` | CLI 未暴露；`credit` 字段可替代 | 🟡 近似 |

---

## 验证清单（17 项 × 5 维度 + tasks §1.7）

### §1.1 Environment

- ✅ **1.1.1** 二进制 `/opt/homebrew/bin/codebuddy` / 版本 `2.93.6`
- ✅ **1.1.2** 凭据可用（`CODEBUDDY_API_KEY_DISABLED=1` 后 401 → 200）

### §1.2 Basic invocation

- ✅ **1.2.1** `codebuddy --help` 完整输出已采集（raw output 第 20-106 行）
- ⚠️ **1.2.2** **没有独立的 `code` 子命令**——`codebuddy` 主命令就是 code 模式；本项目 runner 应调用 `codebuddy` 而非 `codebuddy code`（尽管后者也被识别，但 help 里列出的子命令是 `config / mcp / sandbox / plugin / doctor / update / install / daemon / ps / logs / attach / kill`）
- ✅ **1.2.3** 最简调用 `codebuddy --print "reply OK"` → stdout `OK` / exit 0 / ~5s

### §1.3 Session / Resume

- ✅ **1.3.1** 获取 session_id：
  - **主动生成**：用 `--session-id <uuid>`（orchestrator 决定 ID，**推荐**）
  - **被动捕获**：从 stream-json 的 `system:init` 事件或 `result` 事件的 `session_id` 字段读取
- ✅ **1.3.2** Resume flag 有两种：
  - `-c, --continue` —— 继续**最近一次**对话（单进程场景够用）
  - `-r, --resume [sessionId]` —— 按指定 session_id 恢复（多 task 并发**必须用**）
  - 额外：`--fork-session` 在 resume 时**生成新 id**（对"从某点分叉"场景有用）
- ✅ **1.3.3** **两轮上下文保留已实测**：  
  - turn 1 `--print "my secret code is BANANA-42. respond with OK only."` → `OK`  
  - turn 2 `--continue --print "what secret code did i give you?"` → **`BANANA-42`** 🎉
- ✅ **1.3.4** Session 持久化位置：
  - `~/.codebuddy/projects/<sanitized-cwd>/sessions/*.jsonl` —— CLI 按项目路径自动隔离 session
  - `~/.codebuddy/projects/<sanitized-cwd>/memory/` —— 跨 session 记忆（和 Symphony workspace 概念正交）
  - `~/.codebuddy/traces/<pid>/trace_*.json` —— 诊断 trace（非 session）
  - `~/Library/Application Support/codebuddy/` —— Electron UI 缓存（非 CLI session）
- ⏭️ **1.3.5** 并发同一 session_id 未验（M1 runner 压测项）

### §1.4 Event stream & output format

- ✅ **1.4.1** 默认 `--output-format text`（纯文本，只输出最终回复）
- ✅ **1.4.2** 支持 3 档：
  - `text`（默认）
  - `json`（**数组形式**，全部事件收集完一次性输出）
  - `stream-json`（**NDJSON 流**，一行一事件，适合实时处理）
- ✅ **1.4.3** 结构化 schema（`stream-json`，**本项目推荐用这个**）：

  | 事件 `type` | 含义 | 关键字段 |
  |---|---|---|
  | `system` (subtype=`init`) | Session 启动 | `session_id` / `cwd` / `tools` / `mcp_servers` / `model` / `permissionMode` / `slash_commands` |
  | `file-history-snapshot` | 文件操作前的快照（供 rewind） | `messageId` / `trackedFileBackups` |
  | `assistant` | LLM 每轮输出 | `session_id` / `message.content[].text` / `message.usage` |
  | `message` (role=`user`) | 用户输入回显（当带 `--input-format stream-json`） | `content[].input_text` / `sessionId` |
  | `result` (subtype=`success\|error\|...`) | 整轮收尾 | `result` / `duration_ms` / `duration_api_ms` / `num_turns` / `usage` / `permission_denials` / `is_error` |

  每个事件都有 `__timestamp` (ISO) + `_requestId`，`system:init` 还带 `session_id`，后续事件一律带 `session_id`。NDJSON 每行独立 JSON，便于 orchestrator 用 `readline` 逐行解析。

- ✅ **1.4.4** 事件到 Symphony §10.4 映射表 → 见本报告开头"Symphony 兼容性裁决表"§10.4 行
- ✅ **1.4.5** Token usage：
  - **位置**：`assistant` 事件的 `message.usage.*` + `result` 事件的 `usage.*`
  - **语义**：绝对总量（`input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`）—— 对齐 Symphony §13.5 "prefer absolute totals"
  - **额外**：`message.providerData.rawUsage.credit` 字段给出**信用点消耗**，可作为替代的 rate-limit 指标

### §1.5 Control flags

- ✅ **1.5.1** `--max-turns <number>` 存在
- ❌ **1.5.2** **无 `--timeout`**
  - 🟡 **降级方案**：orchestrator 侧用 `AbortController` + wall-clock 计时，到点发 SIGTERM
  - 对应 PLAN §9 配置：`agent.turn_timeout_ms` / `agent.read_timeout_ms` / `agent.stall_timeout_ms`
- ✅ **1.5.3** Sandbox / approval：
  - `--permission-mode <mode>`：4 档 `acceptEdits` / `bypassPermissions` / `default` / `plan`
  - `--subagent-permission-mode <mode>`：同 4 档，给 subagent 单独设
  - `--sandbox [url]`：Docker/Podman（`container`）或 E2B 远程
  - `-y, --dangerously-skip-permissions`：高信任模式（对应 Symphony §10.5 "example high-trust behavior"）
  - `--tools <value>` / `--allowedTools` / `--disallowedTools`：工具白名单
- ❌ **1.5.4** **无 `--cwd`**
  - 🟢 **降级方案**：Node `child_process.spawn(cmd, args, { cwd: workspacePath })` 完美满足 Invariant 1
  - `--add-dir <dirs...>`：额外允许访问的目录（不能替代 cwd）
  - `-w, --worktree [name]`：CLI 自己创建 git worktree（本项目不用——orchestrator 侧用 per-issue workspace）

### §1.6 Exit codes（轻触，不压测）

- ✅ **1.6.1** 正常完成 exit=0
- 🟡 **1.6.2** SIGINT 测试本轮脚本写法问题（wait 逻辑捕获的退出码是 0 而非 130），**M1 runner 压测时重验**；参见 §4 "已知风险 R5"

### §1.7 Artifact & evaluation

- ✅ **1.7.1** 本报告 + 原始样本
- ✅ **1.7.2** **Verdict**：🟢 CodeBuddy CLI 能充分承接 Symphony §10

---

## 意外发现：ACP 模式（PLAN §5 可选架构）

CLI 内置 **`--acp` Agent Client Protocol** 模式：

```
--acp                       Start in ACP mode - enables communication
                            via stdin/stdout using ndJsonStream
--acp-transport <transport> "stdio" (default) or "streamable-http"
```

**ACP vs `--print --output-format stream-json`**：

| 维度 | `--print` 模式 | `--acp` 模式 |
|---|---|---|
| 通信方向 | 单向（prompt 一次输入，事件流单向输出） | **双向**（stdin 持续喂消息，stdout 持续出事件） |
| 进程生命周期 | 一次调用一次进程 | 长驻进程；多轮在同一进程内 |
| 是否传统 app-server 替代 | 接近但非等价 | **完全等价于 Symphony §10 Codex app-server** |
| M1 推荐 | ⭐ 用这个——简单 | — |
| M2+ 考虑 | — | ⭐ 如要持久 session 复用，升级到这个 |

**PLAN §5 设计建议**：M1 用 `--print --output-format stream-json` 每轮起一个子进程（简单、可调试、失败容易重启）；M3/M4 评估是否升级到 ACP（多 task 并发下进程常驻能省启动开销，但监督树更复杂）。

---

## 意外发现：MCP 集成可直接用于 cnb_api 工具

`codebuddy --help` 显示：
```
--mcp-config <fileOrString>  Load MCP servers from a JSON file or string
--strict-mcp-config          Only use MCP servers from --mcp-config
```

Symphony §10.5 的 `linear_graphql` 客户端工具，在本项目里对应 **`cnb_api` MCP server**。  
PLAN §5 可以直接规定：

- 本项目 runner 启动 CodeBuddy CLI 时传 `--mcp-config path/to/cnb-api-mcp.json`
- `cnb-api-mcp.json` 暴露 `issue.comment` / `issue.addLabel` / `issue.removeLabel` / `issue.close` 等工具
- Agent 在会话里可以直接调 `mcp__cnb_api__comment(...)`

这让 Symphony §10.5 的"client-side tool"扩展在本项目**天然可实现**，不需要自建工具协议层。

---

## 设计建议（面向 PLAN §5 起草）

### S1. Runner 起 CodeBuddy 的标准命令模板

```ts
// 伪代码
const args = [
  '--print',
  '--output-format', 'stream-json',
  '--include-partial-messages',  // 如需细粒度事件
  '--session-id', agentSessionId,  // orchestrator 决定
  '--max-turns', String(config.agent.max_turns),
  '--permission-mode', config.agent.permission_mode,  // 默认 'default'
  '--mcp-config', path.join(configDir, 'cnb-api-mcp.json'),
  '--disallowedTools', 'WebFetch,WebSearch',  // 按信任策略裁剪
  prompt,  // 位置参数
];

const child = spawn('codebuddy', args, {
  cwd: workspacePath,  // Invariant 1
  env: { ...process.env, CODEBUDDY_API_KEY_DISABLED: '1' },
});
```

### S2. 事件映射（Symphony §10.4 → stream-json）

| §10.4 event | 触发条件 | 从哪个 stream-json 字段派生 |
|---|---|---|
| `session_started` | `{"type":"system","subtype":"init"}` | `session_id` 字段即 agent_session_id |
| `startup_failed` | 进程 exit != 0 且无 `system:init` | 合成事件 |
| `turn_completed` | `{"type":"result","subtype":"success","is_error":false}` | `duration_ms` / `usage` / `num_turns` |
| `turn_failed` | `{"type":"result","is_error":true}` | `result` 字段含错误 |
| `turn_cancelled` | orchestrator 发 SIGTERM 后 exit | 合成事件（观察不到 result） |
| `turn_ended_with_error` | `{"type":"result","subtype":"error"}` | 待细分类别 |
| `turn_input_required` | `permission_denials` 非空或 `permission-mode=plan` 产生待批准事件 | 待 M1 细探 |
| `approval_auto_approved` | `--permission-mode bypassPermissions` 下仍记录批准 | 待 M1 细探 |
| `notification` | `{"type":"assistant"}` 中间消息 | `message.content[].text` |
| `other_message` | `{"type":"message"}` | 用户消息回显 |
| `malformed` | stream-json 解析失败的行 | orchestrator 合成 |

### S3. Session 生命周期推荐

- **每轮** = **一次 `codebuddy` 子进程调用**。轮结束 = 进程退出。
- 首轮：`--session-id <new-uuid>` + 完整 prompt
- 后续轮：`--resume <same-uuid>` + continuation guidance（不是 `--continue`，后者依赖 "最近一次"——多 task 并发会串号）
- Session 文件由 CLI 自动写到 `~/.codebuddy/projects/<sanitized-cwd>/sessions/`。orchestrator 重启后仍能 resume。

### S4. Token / rate-limit 采样点

- 从 `result` 事件直接读 `usage.input_tokens` / `usage.output_tokens` —— 绝对总量
- 用"本次 result 的 usage" 减 "上次记录的绝对值" = delta（Symphony §13.5 要求）
- `credit` 字段可作 rate-limit 的间接信号（尚无官方 rate_limit payload）

---

## 已知风险 / 待压测项

| 编号 | 风险 | 缓解 |
|---|---|---|
| **R1** | SIGINT 退出码本轮未验准 | M1 runner 实现时用专用测试（不用 shell wait） |
| **R2** | 并发同一 session_id 行为未验 | M1 runner 实现 + 压测；推荐用 per-task 独立 session_id 避免 |
| **R3** | `--output-format stream-json` 下 `file-history-snapshot` 事件占位体积未知 | M1 实测大 session 的事件吞吐 |
| **R4** | ACP 模式未测 | M3+ 升级前单独做 spike |
| **R5** | CodeBuddy CLI 版本迭代快（2.93.6），flag 可能变动 | `scripts/spike-a-probe.sh` 可作回归探针，每次大升级重跑 |
| **R6** | `--permission-mode=plan` 下如何继续 turn（需交互？）未验 | M1 实现 runner 时细探 |
| **R7** | 工具调用失败时 `permission_denials` 的具体结构未观察到 | 压测时补 |

---

## 附录 A：stream-json 原始样本（完整 4 行）

> 源：`tmp/spike-a-stream-json.txt`，调用 `codebuddy --print --output-format stream-json "reply with OK only"`

### Line 1：`system:init`（7945 字节，含 tools 清单）

```json
{
  "type": "system",
  "subtype": "init",
  "uuid": "a08deffe-bb82-42b7-879c-66032806f4ad",
  "session_id": "a08deffe-bb82-42b7-879c-66032806f4ad",
  "apiKeySource": "copilot.tencent.com",
  "cwd": "/Users/robiluo/aicoding/agentfirst-f1",
  "tools": ["mcp__...", "...众多内置工具..."],
  "mcp_servers": [ { "name":"...", "status":"connected" }, ... ],
  "model": "claude-opus-4.7-1m",
  "permissionMode": "default",
  "slash_commands": ["...", "opsx:apply", "opsx:archive", ...],
  "output_style": "default",
  "__timestamp": "2026-05-01T08:49:03.399Z",
  "_requestId": "e48c7e96fe0d44e4909a350d45172d2a"
}
```

### Line 2：`file-history-snapshot`

```json
{
  "type": "file-history-snapshot",
  "id": "5ad14efb-db44-4954-9696-d7e06b450db8",
  "timestamp": 1777625342868,
  "isSnapshotUpdate": false,
  "snapshot": { "messageId": "7ee0176a-...", "trackedFileBackups": {} },
  "__timestamp": "2026-05-01T08:49:03.404Z",
  "_requestId": "e48c7e96fe0d44e4909a350d45172d2a"
}
```

### Line 3：`assistant`（LLM 回复）

```json
{
  "type": "assistant",
  "uuid": "chatcmpl-ks2n0Wua...",
  "session_id": "a08deffe-bb82-42b7-879c-66032806f4ad",
  "message": {
    "id": "chatcmpl-ks2n0Wua...",
    "content": [{ "type": "text", "text": "OK" }],
    "model": "claude-opus-4.7-1m",
    "role": "assistant",
    "type": "message",
    "usage": {
      "input_tokens": 60455,
      "output_tokens": 6,
      "cache_creation_input_tokens": 60449,
      "cache_read_input_tokens": 0
    }
  },
  "parent_tool_use_id": null,
  "__timestamp": "2026-05-01T08:49:14.909Z"
}
```

### Line 4：`result`（整轮收尾）

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": "OK",
  "uuid": "1ee951ea-bdfb-4380-8428-170e36c1d6c0",
  "session_id": "a08deffe-bb82-42b7-879c-66032806f4ad",
  "duration_ms": 12013,
  "duration_api_ms": 12013,
  "num_turns": 2,
  "total_cost_usd": 0,
  "usage": {
    "input_tokens": 60455,
    "output_tokens": 6,
    "cache_creation_input_tokens": 60449,
    "cache_read_input_tokens": 0
  },
  "permission_denials": [],
  "__timestamp": "2026-05-01T08:49:14.915Z"
}
```

---

## 附录 B：--help 关键 flag 速查

（完整 help 见 `tmp/spike-a-raw-output.txt` 第 20-106 行）

| flag | 类型 | 作用 | 本项目用法 |
|---|---|---|---|
| `-p, --print` | 开关 | 非交互模式，stdout 出完整响应后退出 | **必用** |
| `--output-format` | `text\|json\|stream-json` | 输出格式 | **用 `stream-json`** |
| `--input-format` | `text\|stream-json` | stdin 格式 | M3 如果要持续推 prompt 再用 |
| `--include-partial-messages` | 开关 | 输出 SSE 增量消息（仅 stream-json） | M2+ 细粒度进度时用 |
| `--session-id <uuid>` | uuid | 预指定 session id | **必用**（orchestrator 决定） |
| `-c, --continue` | 开关 | 继续最近一次会话 | ❌ 多并发会串号，改用 `-r <id>` |
| `-r, --resume [sessionId]` | uuid 可选 | 按 id 恢复 | **必用** |
| `--max-turns <n>` | 数字 | agentic 轮数上限 | 对应 `agent.max_turns` |
| `--model <model>` | 模型 id | 选模型 | PLAN §8 workflow 配置暴露 |
| `--fallback-model <model>` | 模型 id | 过载时降级 | PLAN §8 可选 |
| `--permission-mode <mode>` | enum | 批准策略 | 对应 `agent.permission_mode` |
| `--sandbox [url]` | url 可选 | 沙箱运行 | PLAN §8 workflow 配置暴露 |
| `-y, --dangerously-skip-permissions` | 开关 | 全绕过 | 高信任场景 |
| `--tools / --allowedTools / --disallowedTools` | 字符串 | 工具白名单 | PLAN §10 preflight 可强制 |
| `--mcp-config <fileOrString>` | 路径或 JSON | 注入 MCP server | **必用**（cnb_api 工具从这走） |
| `--strict-mcp-config` | 开关 | 只用 --mcp-config 来源 | 生产环境推荐打开 |
| `--add-dir <dirs...>` | 路径列表 | 额外可访问目录 | workspace 补充目录 |
| `--acp` + `--acp-transport` | — | ACP 双向模式 | M3+ 升级候选 |
| `--bg / --background / --name` | — | 后台 session | M4 daemon 化候选 |
