#!/usr/bin/env bash
#
# test.sh — Run all tests (frontend typecheck + backend integration tests)
#
# Usage:
#   ./scripts/test.sh              # run all tests
#   ./scripts/test.sh --backend    # backend tests only
#   ./scripts/test.sh --frontend   # frontend typecheck only
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

MODE="both"
case "${1:-}" in
    --backend)  MODE="backend" ;;
    --frontend) MODE="frontend" ;;
    "")         MODE="both" ;;
    *)          echo "Unknown option: $1"; exit 1 ;;
esac

FAIL=0

if [ "$MODE" = "both" ] || [ "$MODE" = "frontend" ]; then
    echo "=========================================="
    echo " Frontend Type Check"
    echo "=========================================="
    cd "$ROOT_DIR/web"
    if [ ! -d node_modules ]; then npm ci; fi
    npm run typecheck || FAIL=1
    cd "$ROOT_DIR"
    echo ""
fi

if [ "$MODE" = "both" ] || [ "$MODE" = "backend" ]; then
    echo "=========================================="
    echo " Backend Tests"
    echo "=========================================="
    cargo test || FAIL=1
    echo ""
    echo "=========================================="
    echo " Clippy Lint"
    echo "=========================================="
    cargo clippy -- -D warnings 2>/dev/null || {
        echo "  (clippy warnings found, not failing build)"
    }
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
    echo "=========================================="
    echo " All checks passed!"
    echo "=========================================="
else
    echo "=========================================="
    echo " Some checks FAILED"
    echo "=========================================="
    exit 1
fi
