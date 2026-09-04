#!/usr/bin/env bash
#
# build.sh — Build Linkwarden (frontend + backend)
#
# Usage:
#   ./scripts/build.sh              # debug build
#   ./scripts/build.sh --release    # release build (optimized, embeds frontend)
#   ./scripts/build.sh --skip-frontend  # skip frontend build
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

RELEASE=false
SKIP_FRONTEND=false

for arg in "$@"; do
    case "$arg" in
        --release) RELEASE=true ;;
        --skip-frontend) SKIP_FRONTEND=true ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

echo "=========================================="
echo " Linkwarden Build"
echo " Mode: $([ "$RELEASE" = true ] && echo 'release' || echo 'debug')"
echo " Frontend: $([ "$SKIP_FRONTEND" = true ] && echo 'skip' || echo 'build')"
echo "=========================================="

# --- Step 1: Build frontend ---
if [ "$SKIP_FRONTEND" = false ]; then
    echo ""
    echo "[1/2] Building frontend..."
    cd "$ROOT_DIR/web"

    if [ ! -d node_modules ]; then
        echo "  Installing dependencies..."
        npm ci
    fi

    npm run build
    echo "  Frontend built -> web/dist/"
    cd "$ROOT_DIR"
else
    echo ""
    echo "[1/2] Skipping frontend build"
fi

# --- Step 2: Build backend ---
echo ""
if [ "$RELEASE" = true ]; then
    echo "[2/2] Building backend (release)..."
    cargo build --release
    BINARY="target/release/linkwarden"
else
    echo "[2/2] Building backend (debug)..."
    cargo build
    BINARY="target/debug/linkwarden"
fi

echo ""
echo "=========================================="
echo " Build complete!"
echo " Binary: $BINARY"
echo "=========================================="
echo ""
echo "To run:"
echo "  LW_DATA_DIR=./data LW_LISTEN=0.0.0.0:3000 $BINARY"
