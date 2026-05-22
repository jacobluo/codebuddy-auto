#!/usr/bin/env bash
# baseline.sh — 采集工程基线快照
#
# 用法：
#   bash scripts/baseline.sh [--out <path>]
#                            [--include-build-size <dir>]
#                            [--include-api-hash]
#                            [--no-tests]
#
# 行为：
#   - 无 --out 时输出 JSON 到 stdout
#   - 无 vitest 可用时 tests_* 字段写 null，并设 skipped=true
#   - 非 git 仓库时 git_head=null
#   - --no-tests 或检测到已在 pytest / vitest 环境内时，
#     跳过跑测试环节（tests_* = null, skipped=true），避免递归调用
#
# 环境变量：
#   TESTS_DIR      测试目录（默认 typescript/test）
#   API_SRC_DIR    public_api_hash 的源目录（默认 typescript/src）
#
# 字段清单：
#   git_head / tests_pass / tests_fail / tests_total / skipped /
#   build_size / public_api_hash / timestamp
#
# 退出码：
#   0  成功写出 JSON（即使 skipped=true 也算成功）
#   1  参数错误 / 写 --out 失败
#   2  依赖缺失（jq 不存在）

set -u

OUT=""
BUILD_DIR=""
INCLUDE_API_HASH=0
NO_TESTS=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --out)
            OUT="${2:-}"
            shift 2
            ;;
        --include-build-size)
            BUILD_DIR="${2:-}"
            shift 2
            ;;
        --include-api-hash)
            INCLUDE_API_HASH=1
            shift
            ;;
        --no-tests)
            NO_TESTS=1
            shift
            ;;
        -h|--help)
            grep '^# ' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "baseline.sh: unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

if ! command -v jq >/dev/null 2>&1; then
    echo "baseline.sh: jq not found — required for JSON composition" >&2
    exit 2
fi

# ---- git ----
GIT_HEAD="null"
if command -v git >/dev/null 2>&1; then
    if HEAD=$(git rev-parse HEAD 2>/dev/null); then
        GIT_HEAD="\"$HEAD\""
    fi
fi

TESTS_PASS="null"
TESTS_FAIL="null"
TESTS_TOTAL="null"
SKIPPED="false"

TESTS_DIR="${TESTS_DIR:-typescript/test}"
VITEST_COMMAND=""
if [[ -x "typescript/node_modules/.bin/vitest" ]]; then
    VITEST_COMMAND="./node_modules/.bin/vitest run"
elif command -v pnpm >/dev/null 2>&1; then
    VITEST_COMMAND="pnpm test"
fi

# 递归守卫：--no-tests 显式指定，或当前已在 pytest/vitest 环境内，跳过测试执行。
if [[ "$NO_TESTS" == "1" || -n "${PYTEST_CURRENT_TEST:-}" || -n "${VITEST:-}" ]]; then
    SKIPPED="true"
elif [[ -z "$VITEST_COMMAND" ]]; then
    SKIPPED="true"
elif [[ ! -d "$TESTS_DIR" ]]; then
    SKIPPED="true"
else
    if [[ "$VITEST_COMMAND" == "pnpm test" ]]; then
        RUN_OUT=$(cd typescript && pnpm test -- --run 2>/dev/null | tail -20 || true)
    else
        RUN_OUT=$(cd typescript && ./node_modules/.bin/vitest run 2>/dev/null | tail -20 || true)
    fi

    PASSED=$(echo "$RUN_OUT" | grep -oE 'Tests[[:space:]]+[0-9]+ passed' | grep -oE '[0-9]+' | tail -1 || true)
    TOTAL=$(echo "$RUN_OUT" | grep -oE 'Tests[[:space:]]+[0-9]+ passed \([0-9]+\)' | grep -oE '\([0-9]+\)' | tr -d '()' | tail -1 || true)

    if [[ -n "$PASSED" && -n "$TOTAL" ]]; then
        TESTS_PASS="$PASSED"
        TESTS_TOTAL="$TOTAL"
        TESTS_FAIL="$((TOTAL - PASSED))"
    else
        SKIPPED="true"
        TESTS_PASS="null"
        TESTS_FAIL="null"
        TESTS_TOTAL="null"
    fi
fi

# ---- build_size ----
BUILD_SIZE="null"
if [[ -n "$BUILD_DIR" && -d "$BUILD_DIR" ]]; then
    if du -sb "$BUILD_DIR" >/dev/null 2>&1; then
        BUILD_SIZE=$(du -sb "$BUILD_DIR" | awk '{print $1}')
    else
        KB=$(du -sk "$BUILD_DIR" | awk '{print $1}')
        BUILD_SIZE=$((KB * 1024))
    fi
fi

# ---- public_api_hash ----
API_HASH="null"
if [[ "$INCLUDE_API_HASH" == "1" ]]; then
    API_SRC_DIR="${API_SRC_DIR:-typescript/src}"
    API_SRC=$(find "$API_SRC_DIR" -name '*.ts' 2>/dev/null | sort | xargs grep -hE '^(export |interface |type |class |async function |function )' 2>/dev/null || true)
    if [[ -n "$API_SRC" ]]; then
        H=$(echo "$API_SRC" | shasum -a 1 2>/dev/null | awk '{print $1}')
        if [[ -z "$H" ]]; then
            H=$(echo "$API_SRC" | sha1sum 2>/dev/null | awk '{print $1}')
        fi
        [[ -n "$H" ]] && API_HASH="\"$H\""
    fi
fi

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

JSON=$(jq -n \
    --argjson git_head "$GIT_HEAD" \
    --argjson tests_pass "$TESTS_PASS" \
    --argjson tests_fail "$TESTS_FAIL" \
    --argjson tests_total "$TESTS_TOTAL" \
    --argjson skipped "$SKIPPED" \
    --argjson build_size "$BUILD_SIZE" \
    --argjson public_api_hash "$API_HASH" \
    --arg timestamp "$TS" \
    '{
      git_head: $git_head,
      tests_pass: $tests_pass,
      tests_fail: $tests_fail,
      tests_total: $tests_total,
      skipped: $skipped,
      build_size: $build_size,
      public_api_hash: $public_api_hash,
      timestamp: $timestamp
    }')

if [[ -n "$OUT" ]]; then
    if ! echo "$JSON" > "$OUT"; then
        echo "baseline.sh: failed to write $OUT" >&2
        exit 1
    fi
else
    echo "$JSON"
fi
