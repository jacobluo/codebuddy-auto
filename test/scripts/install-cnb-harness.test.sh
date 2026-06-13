#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/install-cnb-harness"
SOURCE_TEMPLATE="$ROOT_DIR/templates/cnb/ISSUE_TEMPLATE/agent-ready.yml"
TMP_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

TARGET_REPO="$TMP_DIR/business-repo"
TARGET_TEMPLATE="$TARGET_REPO/.cnb/ISSUE_TEMPLATE/agent-ready.yml"

mkdir -p "$TARGET_REPO"

bash "$SCRIPT" "$TARGET_REPO"

if ! cmp -s "$SOURCE_TEMPLATE" "$TARGET_TEMPLATE"; then
    echo "installed template does not match canonical template" >&2
    exit 1
fi

printf 'custom template\n' > "$TARGET_TEMPLATE"

if bash "$SCRIPT" "$TARGET_REPO" >/tmp/install-cnb-harness.out 2>/tmp/install-cnb-harness.err; then
    echo "installer should fail when target template exists without --overwrite" >&2
    exit 1
fi

if [[ "$(cat "$TARGET_TEMPLATE")" != "custom template" ]]; then
    echo "installer overwrote existing template without --overwrite" >&2
    exit 1
fi

bash "$SCRIPT" --overwrite "$TARGET_REPO"

if ! cmp -s "$SOURCE_TEMPLATE" "$TARGET_TEMPLATE"; then
    echo "overwrite did not restore canonical template" >&2
    exit 1
fi
