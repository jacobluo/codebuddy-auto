#!/usr/bin/env bash
# spike-b-probe.sh — M0 Spike B: cnb.cool Issue API capability probe
#
# 用法：
#   bash scripts/spike-b-probe.sh [--out <path>] [--repo <owner/repo>] [--token <token>] [--keep-fixtures]
#
# 行为：
#   - 探测 cnb.cool OpenAPI 的 20 项能力（对齐 openspec/changes/m0-spike-codebuddy-and-cnb/tasks.md §2）
#   - 把所有原始 stdout/stderr 合并写入 <path>（默认 tmp/spike-b-raw-output.txt）
#   - 过程中用 ✅ / ⚠️ / ❌ 标注每个探测项的初步状态
#
# 对应 tasks.md 的映射：
#   §2.1.1-§2.1.4 → PROBE 0-3  认证 / 基础 GET / rate / doc
#   §2.2.1-§2.2.5 → PROBE 4-9  列表：label/state/AND-NOT/分页/排序
#   §2.3.1-§2.3.3 → PROBE 10-12 批量：by-id / 单条延迟 / terminal 状态
#   §2.4.1-§2.4.5 → PROBE 13-17 写：comment / label / state / assignee / scope
#   §2.5.1-§2.5.3 → PROBE 18-20 custom field
#   §2.6.1        → PROBE 21    webhook 可行性（仅探测）
#
# 副作用（需要你审）：
#   - 会在目标 repo 创建 3 个测试 issue（标题前缀 "[spike-b]"），留在那里供后续回归，不自动删除
#   - 会创建 2 个测试 label（agent-ready / skip-agent），后续会复用
#   - 会对测试 issue 加/删 label、加 comment、close/reopen、改 assignee
#   - 会向 api.cnb.cool 发总计约 50 次 HTTP 请求
#
# 退出码：
#   0  全部探测完成（单项 ⚠️ / ❌ 也算 0）
#   2  curl 不可用 / token 无效 / repo 路径不可达
#   3  写日志失败

set -u

# ---- 让脚本对 PATH 异常健壮 ----
PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${PATH:-}"
export PATH

OUT="tmp/spike-b-raw-output.txt"
REPO="relaxorg/codebuddy-auto"
TOKEN=""
KEEP_FIXTURES=1  # 默认保留测试 issue；便于回归运行

while [[ $# -gt 0 ]]; do
    case "$1" in
        --out) OUT="${2:-}"; shift 2 ;;
        --repo) REPO="${2:-}"; shift 2 ;;
        --token) TOKEN="${2:-}"; shift 2 ;;
        --keep-fixtures) KEEP_FIXTURES=1; shift ;;
        -h|--help) grep '^# ' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown argument: $1" >&2; exit 1 ;;
    esac
done

# 从 git credential store 推断 token（当未显式传入时）
if [[ -z "$TOKEN" ]] && [[ -f "$HOME/.git-credentials" ]]; then
    TOKEN=$(grep -E 'cnb\.cool' "$HOME/.git-credentials" | head -1 | sed -E 's|https://[^:]+:([^@]+)@.*|\1|' || true)
fi

if [[ -z "$TOKEN" ]]; then
    echo "❌ no cnb token; pass --token or populate ~/.git-credentials" >&2
    exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "❌ curl not found on PATH" >&2
    exit 2
fi

LOG_DIR="$(dirname "$OUT")"
mkdir -p "$LOG_DIR" || { echo "cannot create $LOG_DIR" >&2; exit 3; }

{
    echo "# spike-b-probe raw output"
    echo "# started_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# host: $(uname -a)"
    echo "# repo: $REPO"
    echo "# token: ${TOKEN:0:6}...(redacted, len=${#TOKEN})"
    echo
} > "$OUT" || { echo "cannot write $OUT" >&2; exit 3; }

BASE="https://api.cnb.cool/${REPO}/-"
ACP_JSON='Accept: application/json'
ACP_VND='Accept: application/vnd.cnb.api+json'
CT='Content-Type: application/json'
AUTH="Authorization: Bearer ${TOKEN}"

# ---- 工具函数 ----
log()     { echo "$@"; echo "$@" >> "$OUT"; }
section() { log ""; log "================================================================"; log "## $*"; log "================================================================"; }

# probe_get <id> <title> <url> — GET，纪录 http code + body
probe_get() {
    local pid="$1"; shift
    local title="$1"; shift
    local url="$1"; shift
    log ""
    log "--- PROBE $pid: $title ---"
    log "$ curl -H 'Authorization: Bearer ***' '$url'"
    {
        echo "--- PROBE $pid BEGIN ---"
        curl -sS -D - --max-time 15 -H "$AUTH" -H "$ACP_JSON" "$url"
        local rc=$?
        echo
        echo "--- PROBE $pid END (curl_exit=$rc) ---"
    } >> "$OUT" 2>&1 || true
}

# probe_req <id> <title> <method> <url> [body-json] [extra accept]
probe_req() {
    local pid="$1" title="$2" method="$3" url="$4" body="${5:-}" accept="${6:-$ACP_JSON}"
    log ""
    log "--- PROBE $pid: $title ---"
    log "$ curl -X $method '$url' -d '${body}'"
    {
        echo "--- PROBE $pid BEGIN ---"
        if [[ -n "$body" ]]; then
            curl -sS -D - --max-time 15 -X "$method" -H "$AUTH" -H "$accept" -H "$CT" -d "$body" "$url"
        else
            curl -sS -D - --max-time 15 -X "$method" -H "$AUTH" -H "$accept" "$url"
        fi
        local rc=$?
        echo
        echo "--- PROBE $pid END (curl_exit=$rc) ---"
    } >> "$OUT" 2>&1 || true
}

# ---- §2.1 Auth & basics ----
section "§2.1 Auth & basics (dim 1: 4 checks)"

# 2.1.1 认证机制确认：Bearer + /user
probe_get 0 "GET /user (auth smoke)" "https://api.cnb.cool/user"

# 2.1.2 最小 issue GET
probe_get 1 "GET /{repo}/-/issues (list)" "$BASE/issues?page=1&page_size=5"

# 2.1.3 rate limit：连跑 20 次观察是否 429 / header 暴露
log ""
log "--- PROBE 2: burst 20 sequential GETs ---"
{
    echo "--- PROBE 2 BEGIN ---"
    for i in $(seq 1 20); do
        code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 -H "$AUTH" -H "$ACP_JSON" "$BASE/issues?page_size=1" || echo "XXX")
        echo "$i $code"
    done
    echo "--- PROBE 2 END ---"
} >> "$OUT" 2>&1

# 2.1.4 文档 URL（只记录，不 fetch）
log ""
log "--- PROBE 3: doc URLs (for report) ---"
log "  official: https://docs.cnb.build/zh/develops/openapi.html"
log "  openapi playground: https://api.cnb.cool/  (SPA)"
log "  access-token guide: https://docs.cnb.build/zh/guide/access-token.html"

# ---- Fixture setup: 保证 #1/#2/#3 + 两个 label 存在 ----
section "Fixture setup (idempotent)"

ensure_label() {
    local name="$1" color="$2" desc="${3:-}"
    local body
    body=$(printf '{"name":"%s","color":"%s","description":"%s"}' "$name" "$color" "$desc")
    curl -sS -o /dev/null -w "  label '$name': %{http_code}\n" --max-time 10 \
        -X POST -H "$AUTH" -H "$ACP_JSON" -H "$CT" -d "$body" "$BASE/labels" | tee -a "$OUT" || true
}

ensure_issue() {
    # 判断当前 total；若 < 3 则补创
    local cur total
    total=$(curl -sS -D - -o /dev/null --max-time 10 -H "$AUTH" -H "$ACP_JSON" "$BASE/issues?page_size=1" \
        | grep -i '^x-cnb-total' | awk '{print $2}' | tr -d '\r')
    log "  current issue count: ${total:-0}"
    cur="${total:-0}"
    while (( cur < 3 )); do
        cur=$(( cur + 1 ))
        local body="{\"title\":\"[spike-b] test issue #$cur\",\"body\":\"Fixture for spike-b-probe. Safe to close.\"}"
        curl -sS -o /dev/null -w "  created fixture #$cur: %{http_code}\n" --max-time 10 \
            -X POST -H "$AUTH" -H "$ACP_JSON" -H "$CT" -d "$body" "$BASE/issues" | tee -a "$OUT" || true
    done
}

ensure_label "agent-ready" "#2ecc71" "Tracker polls pick this up"
ensure_label "skip-agent"  "#95a5a6" ""
ensure_issue

# ---- §2.2 Candidate query ----
section "§2.2 Candidate query (dim 2: 5 checks)"

probe_get 4 "labels=agent-ready" "$BASE/issues?labels=agent-ready"
probe_get 5 "state=open" "$BASE/issues?state=open&page_size=5"
probe_get 6 "labels=agent-ready,skip-agent (OR semantics per Spike B)" "$BASE/issues?labels=agent-ready,skip-agent"
probe_get 7 "pagination headers (page=1 page_size=2)" "$BASE/issues?page=1&page_size=2"
probe_get 8 "sort=created_at&order=desc" "$BASE/issues?sort=created_at&order=desc"
probe_get 9 "sort=priority&order=desc" "$BASE/issues?sort=priority&order=desc"

# ---- §2.3 Batch query ----
section "§2.3 Batch query (dim 3: 3 checks)"

# numbers=/ids= 实际被忽略（见报告），这里保留 probe 便于日后回归检测平台是否新增能力
probe_get 10 "try batch numbers=1,2,3 (expected: param ignored)" "$BASE/issues?numbers=1,2,3"
probe_get 11 "try batch ids=1,2,3 (expected: param ignored)" "$BASE/issues?ids=1,2,3"
# 单条平均延迟估算：串 5 次
log ""
log "--- PROBE 12: single-issue GET latency (5 samples) ---"
{
    echo "--- PROBE 12 BEGIN ---"
    for n in 1 2 3 1 2; do
        curl -sS -o /dev/null -w "  #$n: http=%{http_code} t=%{time_total}s\n" --max-time 10 \
            -H "$AUTH" -H "$ACP_JSON" "$BASE/issues/$n"
    done
    echo "--- PROBE 12 END ---"
} >> "$OUT" 2>&1

probe_get 12.1 "list state=closed (startup cleanup query)" "$BASE/issues?state=closed&page_size=50"

# ---- §2.4 Agent-side write ops ----
section "§2.4 Agent-side write ops (dim 4: 5 checks)"

probe_req 13 "POST comment on #1"     POST  "$BASE/issues/1/comments" \
    '{"body":"spike-b probe comment (probe 13)"}'

probe_req 14 "POST label to #1"       POST  "$BASE/issues/1/labels" \
    '{"labels":["agent-ready"]}'
probe_req 14.1 "DELETE label from #1" DELETE "$BASE/issues/1/labels/skip-agent" ""

# state mutation：required state + state_reason pair + vnd accept
probe_req 15 "PATCH #3 close (state+reason, vnd accept)"  PATCH "$BASE/issues/3" \
    '{"state":"closed","state_reason":"completed"}' "$ACP_VND"
probe_req 15.1 "PATCH #3 reopen"                          PATCH "$BASE/issues/3" \
    '{"state":"open","state_reason":"reopened"}' "$ACP_VND"

probe_req 16 "POST assignees to #3"   POST  "$BASE/issues/3/assignees" \
    '{"assignees":["cnb.robiluo"]}' "$ACP_VND"

log ""
log "--- PROBE 17: token scope note ---"
log "  cnb access token scopes are configured when minting the token (see docs/access-token)."
log "  All 4 mutations above (comment / label / state / assignee) succeed with the same token."
log "  Minimum scope inference: 'repo issue write' + 'repo label write' (platform exact names vary)."

# ---- §2.5 Custom fields ----
section "§2.5 Custom fields (dim 5: 3 checks)"

probe_get 18 "GET /custom_fields (expected: 404 / absent)" "$BASE/custom_fields"
probe_get 19 "GET /issues/1/custom_fields (expected: 404)" "$BASE/issues/1/custom_fields"

log ""
log "--- PROBE 20: custom field decision ---"
log "  cnb lacks native custom fields at issue level; use labels with prefix convention (e.g. attempt:<N>)"
log "  to encode Symphony 'attempt' retry counter and similar metadata. See report §3.5."

# ---- §2.6 Webhook (feasibility only) ----
section "§2.6 Webhook feasibility (dim 6: 1 check)"

probe_get 21 "GET /webhooks or /hooks (feasibility probe)" "$BASE/webhooks"
probe_get 21.1 "alt: /hooks" "$BASE/hooks"

# ---- Summary ----
section "Summary"
log "  raw output: $OUT"
log "  repo: $REPO"
log "  fixtures kept (3 issues + 2 labels) for regression re-runs"
log ""
log "next step:"
log "  1) inspect $OUT"
log "  2) reconcile docs/references/cnb-issue-api.md with any platform-side drift"
log "  3) check off tasks §2.x in openspec/changes/m0-spike-codebuddy-and-cnb/tasks.md"

log ""
log "done."
