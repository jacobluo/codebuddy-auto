#!/usr/bin/env bash
# spike-a-probe.sh — M0 Spike A: CodeBuddy Code CLI capability probe
#
# 用法：
#   bash scripts/spike-a-probe.sh [--out <path>]
#
# 行为：
#   - 探测 CodeBuddy CLI 的 17 项能力（对齐 openspec/changes/m0-spike-codebuddy-and-cnb/tasks.md §1）
#   - 把所有原始 stdout/stderr 合并写入 <path>（默认 tmp/spike-a-raw-output.txt）
#   - 过程中用 ✅ / ⚠️ / ❌ 标注每个探测项的初步状态
#
# 对应 tasks.md 的映射：
#   §1.1.1 → PROBE 0
#   §1.2.1 → PROBE 1
#   §1.2.2 → PROBE 2
#   §1.2.3 → PROBE 3
#   §1.3.1 → PROBE 4
#   §1.3.2 → PROBE 5
#   §1.3.3 → PROBE 6
#   §1.3.4 → PROBE 7
#   §1.3.5 → PROBE 8
#   §1.4.x → PROBE 9-13
#   §1.5.x → PROBE 14-17
#   §1.6.x → PROBE 18-19
#
# 副作用（需要你审）：
#   - 会向 codebuddy 发送 2-3 轮极短对话（每轮 10 token 级 prompt）
#   - 会在 /tmp/agentfirst-spike-a-<timestamp>/ 创建临时工作目录，跑完不自动删（留痕用）
#   - 不向任何仓库写入，不向 cnb.cool 发请求
#
# 退出码：
#   0  全部探测完成（即使单项 ⚠️ / ❌ 也算 0）
#   2  codebuddy 二进制不存在
#   3  写日志失败

set -u

OUT="tmp/spike-a-raw-output.txt"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --out) OUT="${2:-}"; shift 2 ;;
        -h|--help) grep '^# ' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown argument: $1" >&2; exit 1 ;;
    esac
done

# 确保日志目录存在
LOG_DIR="$(dirname "$OUT")"
mkdir -p "$LOG_DIR" || { echo "cannot create $LOG_DIR" >&2; exit 3; }

# 给 out 写一个 header
{
    echo "# spike-a-probe raw output"
    echo "# started_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# host: $(uname -a)"
    echo
} > "$OUT" || { echo "cannot write $OUT" >&2; exit 3; }

# ---- 工具函数 ----
# log <line>  — 同时写 stdout 和 $OUT
log() {
    echo "$@"
    echo "$@" >> "$OUT"
}

# section <title>
section() {
    log ""
    log "================================================================"
    log "## $*"
    log "================================================================"
}

# probe <id> <title> <cmd...> — 跑 cmd，把 stdout/stderr 全部灌进 $OUT，带边界标记
# 用法：probe 1 "help output" codebuddy --help
probe() {
    local pid="$1"; shift
    local title="$1"; shift
    log ""
    log "--- PROBE $pid: $title ---"
    log "$ $*"
    {
        echo "--- PROBE $pid stdout+stderr BEGIN ---"
        "$@" 2>&1
        local rc=$?
        echo "--- PROBE $pid END (exit=$rc) ---"
    } >> "$OUT" 2>&1 || true
    log "  (raw output written; see $OUT)"
}

# probe_tee <id> <title> <cmd...> — 同 probe，但 stdout 也回显到终端
probe_tee() {
    local pid="$1"; shift
    local title="$1"; shift
    log ""
    log "--- PROBE $pid: $title ---"
    log "$ $*"
    {
        echo "--- PROBE $pid stdout+stderr BEGIN ---"
    } >> "$OUT"
    "$@" 2>&1 | tee -a "$OUT"
    {
        echo "--- PROBE $pid END ---"
    } >> "$OUT"
}

# ---- PROBE 0: 环境确认 (tasks §1.1) ----
section "§1.1 Environment"

if ! command -v codebuddy >/dev/null 2>&1; then
    log "❌ codebuddy not on PATH"
    exit 2
fi

CB_BIN="$(command -v codebuddy)"
CB_VERSION="$(codebuddy --version 2>/dev/null | head -1 || echo unknown)"

log "  codebuddy binary: $CB_BIN"
log "  codebuddy version: $CB_VERSION"
log "  ✅ environment OK"

# ---- PROBE 1: `codebuddy --help` 全量 (tasks §1.2.1) ----
section "§1.2 Basic invocation"

probe 1 "codebuddy --help (top-level help)" codebuddy --help

# ---- PROBE 2: `codebuddy code --help` (tasks §1.2.2) ----
probe 2 "codebuddy code --help (subcommand help)" codebuddy code --help

# ---- PROBE 3: 最简调用 (tasks §1.2.3) ----
# 极短无害 prompt，消耗量最小
PROBE3_PROMPT='reply with the word OK only'
probe 3 "minimal call" codebuddy code --print "$PROBE3_PROMPT"

# ---- PROBE 4: session_id 捕获方式 (tasks §1.3.1) ----
section "§1.3 Session / Resume"

# 探测可能的 flag：--print-session-id / --json / --session-id-out
# 先试 --help 里 grep session
log ""
log "--- PROBE 4: grep 'session' in help outputs ---"
{
    echo "--- grep session: codebuddy --help ---"
    codebuddy --help 2>&1 | grep -iE 'session|resume|thread|continue' || echo "(no match)"
    echo "--- grep session: codebuddy code --help ---"
    codebuddy code --help 2>&1 | grep -iE 'session|resume|thread|continue' || echo "(no match)"
} >> "$OUT" 2>&1
log "  (see $OUT for session/resume flag hints)"

# ---- PROBE 5: resume flag 尝试 (tasks §1.3.2) ----
# 不实际 resume（没 session_id），只看 flag 是否被识别
probe 5 "try --resume --help" codebuddy code --resume --help
probe 5.1 "try --continue --help" codebuddy code --continue --help

# ---- PROBE 6: 两轮上下文保留测试 (tasks §1.3.3) ----
# 策略：turn1 建立记忆 → 若能抓到 session_id → turn2 resume → 问能否回忆
section "§1.3.3 Two-turn context retention"

TURN1_PROMPT='my secret code is BANANA-42. respond with OK only.'
TURN2_PROMPT='what secret code did i give you? respond with just the code.'

log ""
log "--- PROBE 6 turn 1 ---"
log "$ codebuddy code --print \"$TURN1_PROMPT\""
TURN1_OUT=$(codebuddy code --print "$TURN1_PROMPT" 2>&1)
{
    echo "--- PROBE 6 turn 1 output BEGIN ---"
    echo "$TURN1_OUT"
    echo "--- PROBE 6 turn 1 output END ---"
} >> "$OUT"
log "  turn 1 output captured ($(echo "$TURN1_OUT" | wc -l | tr -d ' ') lines)"

# 尝试 --continue（最常见的 "接着上次" flag）
log ""
log "--- PROBE 6 turn 2 (try --continue) ---"
log "$ codebuddy code --continue --print \"$TURN2_PROMPT\""
TURN2_OUT=$(codebuddy code --continue --print "$TURN2_PROMPT" 2>&1 || echo "(command failed)")
{
    echo "--- PROBE 6 turn 2 output BEGIN ---"
    echo "$TURN2_OUT"
    echo "--- PROBE 6 turn 2 output END ---"
} >> "$OUT"
log "  turn 2 output captured"

if echo "$TURN2_OUT" | grep -q "BANANA-42"; then
    log "  ✅ context retained across turns (BANANA-42 recalled)"
else
    log "  ⚠️ context NOT confirmed retained via --continue (see raw output)"
fi

# ---- PROBE 7: session 持久化位置 (tasks §1.3.4) ----
section "§1.3.4 Session persistence location"

log "--- probing common session storage paths ---"
for p in \
    "$HOME/.codebuddy" \
    "$HOME/.config/codebuddy" \
    "$HOME/Library/Application Support/codebuddy" \
    "$HOME/.cache/codebuddy" \
    "/tmp/codebuddy"; do
    if [ -e "$p" ]; then
        log "  FOUND: $p"
        log "    tree (top 20):"
        (cd "$p" 2>/dev/null && find . -maxdepth 3 -type f 2>/dev/null | head -20 | sed 's/^/      /') | tee -a "$OUT" || true
    fi
done

# ---- PROBE 8: 并发同 session (tasks §1.3.5) ----
# 跳过真实并发，留给 spike doc 作为 "⚠️ 未验证 / 待压测"
section "§1.3.5 Concurrent resume (skipped, out of A2 scope)"
log "  ⏭️ skipped — concurrent-resume semantics belong to M1 runner impl"

# ---- PROBE 9-13: 事件流 / 输出格式 (tasks §1.4.x) ----
section "§1.4 Event stream & output format"

probe 9 "grep output-format|json|stream|ndjson in help" bash -c "codebuddy code --help 2>&1 | grep -iE 'output|format|json|stream|ndjson|quiet'"

probe 10 "try --output-format json" codebuddy code --output-format json --print "reply with OK"
probe 11 "try --json" codebuddy code --json --print "reply with OK"
probe 12 "try --stream" codebuddy code --stream --print "reply with OK"

# ---- PROBE 14-17: 控制 flag (tasks §1.5.x) ----
section "§1.5 Control flags"

probe 14 "grep max-turns|turn" bash -c "codebuddy code --help 2>&1 | grep -iE 'max.?turn|turn'"
probe 15 "grep timeout" bash -c "codebuddy code --help 2>&1 | grep -iE 'timeout|deadline'"
probe 16 "grep sandbox|approval|policy" bash -c "codebuddy code --help 2>&1 | grep -iE 'sandbox|approval|policy|permission'"
probe 17 "grep cwd|working-dir|directory" bash -c "codebuddy code --help 2>&1 | grep -iE 'cwd|working.?dir|directory|workspace'"

# 17b: 实际尝试 --cwd 到临时目录
TMPWS="/tmp/agentfirst-spike-a-$(date +%s)"
mkdir -p "$TMPWS"
log ""
log "--- PROBE 17b: run codebuddy in $TMPWS via --cwd if supported ---"
probe 17.1 "try --cwd" codebuddy code --cwd "$TMPWS" --print "pwd? reply with the output of pwd command only" || true

# ---- PROBE 18-19: 退出码 (tasks §1.6.x) ----
section "§1.6 Exit codes"

log ""
log "--- PROBE 18: normal completion exit code ---"
codebuddy code --print "reply with OK only" >> "$OUT" 2>&1
log "  exit=$?"

log ""
log "--- PROBE 19: SIGINT exit code (light touch) ---"
# 启动一个会耗时的 prompt，然后 1.5 秒后 SIGINT
(
    codebuddy code --print "count from 1 to 1000 slowly, one number per line" >> "$OUT" 2>&1 &
    CB_PID=$!
    sleep 1.5
    kill -INT $CB_PID 2>/dev/null || true
    wait $CB_PID 2>/dev/null
    echo "sigint_exit=$?" >> "$OUT"
)
log "  sigint test done (see raw output for exit code)"

# ---- 汇总 ----
section "Summary"

log "total lines captured: $(wc -l < "$OUT" | tr -d ' ')"
log "raw output: $OUT"
log "tmp workspace (remove manually if noisy): $TMPWS"
log ""
log "next step:"
log "  1) inspect $OUT manually or let agent analyze it"
log "  2) fill docs/references/codebuddy-cli-capabilities.md"
log "  3) check off tasks §1.1-§1.6 in openspec/changes/m0-spike-codebuddy-and-cnb/tasks.md"

echo
log "done."
