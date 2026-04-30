#!/usr/bin/env bash
# diff-baseline.sh — 对比两份 baseline.json
#
# 用法：
#   bash scripts/diff-baseline.sh <before.json> <after.json>
#
# 退出码：
#   0  无回退（可能 stderr 有警告）
#   1  检测到回退（回退条目见 stderr）
#   2  输入 JSON 非法 / 参数错误
#
# 回退判定：
#   tests_pass 下降  → 回退
#   tests_fail 上升  → 回退
#   public_api_hash 变更（两侧非 null）→ 回退
#   build_size 增长 > 10% → 仅 stderr 警告（默认不强阻塞）
#   tests_total 下降 → 仅 stderr 提示（测试可能被合法删除）

set -u

if [[ $# -ne 2 ]]; then
    echo "usage: diff-baseline.sh <before.json> <after.json>" >&2
    exit 2
fi

BEFORE="$1"
AFTER="$2"

if ! command -v jq >/dev/null 2>&1; then
    echo "diff-baseline.sh: jq not found" >&2
    exit 2
fi

for f in "$BEFORE" "$AFTER"; do
    if [[ ! -f "$f" ]]; then
        echo "diff-baseline.sh: file not found: $f" >&2
        exit 2
    fi
    if ! jq -e . "$f" >/dev/null 2>&1; then
        echo "malformed baseline JSON: $f" >&2
        exit 2
    fi
done

get() {
    jq -r "$2 // \"null\"" "$1"
}

B_SKIPPED=$(get "$BEFORE" .skipped)
A_SKIPPED=$(get "$AFTER" .skipped)

if [[ "$B_SKIPPED" == "true" && "$A_SKIPPED" == "true" ]]; then
    echo "no regression (both skipped)"
    exit 0
fi

REGRESSIONS=()

B_PASS=$(get "$BEFORE" .tests_pass)
A_PASS=$(get "$AFTER" .tests_pass)
B_FAIL=$(get "$BEFORE" .tests_fail)
A_FAIL=$(get "$AFTER" .tests_fail)
B_TOTAL=$(get "$BEFORE" .tests_total)
A_TOTAL=$(get "$AFTER" .tests_total)
B_HASH=$(get "$BEFORE" .public_api_hash)
A_HASH=$(get "$AFTER" .public_api_hash)
B_SIZE=$(get "$BEFORE" .build_size)
A_SIZE=$(get "$AFTER" .build_size)

is_num() { [[ "$1" =~ ^[0-9]+$ ]]; }

# tests_pass 下降
if is_num "$B_PASS" && is_num "$A_PASS" && (( A_PASS < B_PASS )); then
    REGRESSIONS+=("tests_pass regression: $B_PASS → $A_PASS")
fi

# tests_fail 上升
if is_num "$B_FAIL" && is_num "$A_FAIL" && (( A_FAIL > B_FAIL )); then
    REGRESSIONS+=("tests_fail increased: $B_FAIL → $A_FAIL")
fi

# public_api_hash 变更（两侧非 null）
if [[ "$B_HASH" != "null" && "$A_HASH" != "null" && "$B_HASH" != "$A_HASH" ]]; then
    REGRESSIONS+=("public_api_hash changed (breaking not declared): $B_HASH → $A_HASH")
fi

# tests_total 下降 → 提示
if is_num "$B_TOTAL" && is_num "$A_TOTAL" && (( A_TOTAL < B_TOTAL )); then
    echo "notice: tests_total decreased ($B_TOTAL → $A_TOTAL) — tests may have been removed" >&2
fi

# build_size 增长 > 10% → 警告
if is_num "$B_SIZE" && is_num "$A_SIZE" && (( B_SIZE > 0 )); then
    # integer * 100 / base compare with 110
    RATIO=$(( A_SIZE * 100 / B_SIZE ))
    if (( RATIO > 110 )); then
        echo "warning: build_size grew >10% ($B_SIZE → $A_SIZE, ${RATIO}%) — Gatekeeper review recommended" >&2
    fi
fi

if (( ${#REGRESSIONS[@]} > 0 )); then
    echo "regression detected:" >&2
    for r in "${REGRESSIONS[@]}"; do
        echo "  - $r" >&2
    done
    exit 1
fi

echo "no regression"
exit 0
