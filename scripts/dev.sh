#!/usr/bin/env bash
#
# dev.sh — Start development environment (backend + frontend with hot reload)
#
# Usage:
#   ./scripts/dev.sh              # start both backend and frontend
#   ./scripts/dev.sh --backend    # backend only
#   ./scripts/dev.sh --frontend   # frontend only
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

export LW_DATA_DIR="${LW_DATA_DIR:-$ROOT_DIR/data}"
export LW_LISTEN="${LW_LISTEN:-127.0.0.1:3000}"
export LW_COOKIE_SECURE="${LW_COOKIE_SECURE:-false}"
export RUST_LOG="${RUST_LOG:-info,linkwarden=debug}"

mkdir -p "$LW_DATA_DIR"

cleanup() {
    if [ -n "${BACKEND_PID:-}" ]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
    if [ -n "${FRONTEND_PID:-}" ]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

if [ "$MODE" = "both" ] || [ "$MODE" = "backend" ]; then
    echo "Starting backend on $LW_LISTEN ..."
    cargo run &
    BACKEND_PID=$!
fi

if [ "$MODE" = "both" ] || [ "$MODE" = "frontend" ]; then
    echo "Starting frontend dev server on http://localhost:5173 ..."
    cd "$ROOT_DIR/web"
    if [ ! -d node_modules ]; then
        npm install
    fi
    npm run dev &
    FRONTEND_PID=$!
    cd "$ROOT_DIR"
fi

echo ""
echo "=========================================="
echo " Development environment running"
if [ "$MODE" = "both" ] || [ "$MODE" = "frontend" ]; then
    echo " Frontend: http://localhost:5173"
fi
if [ "$MODE" = "both" ] || [ "$MODE" = "backend" ]; then
    echo " Backend:  http://localhost:3000"
fi
echo "=========================================="
echo ""
echo "Press Ctrl+C to stop."

wait
