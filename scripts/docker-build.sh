#!/usr/bin/env bash
#
# docker-build.sh — Build and optionally run the Linkdock Docker image
#
# Usage:
#   ./scripts/docker-build.sh                    # build image only
#   ./scripts/docker-build.sh --run              # build and run on port 3000
#   ./scripts/docker-build.sh --run -p 8080:3000 # build and run on custom port
#   ./scripts/docker-build.sh --tag v0.1.0       # custom tag
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

IMAGE_NAME="linkdock"
IMAGE_TAG="latest"
RUN=false
RUN_PORTS="-p 3000:3000"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --run) RUN=true; shift ;;
        --tag) IMAGE_TAG="$2"; shift 2 ;;
        -p) RUN_PORTS="-p $2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

FULL_IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"

echo "=========================================="
echo " Linkdock Docker Build"
echo " Image: $FULL_IMAGE"
echo "=========================================="
echo ""

# --- Build ---
echo "[1/2] Building Docker image..."
docker build -t "$FULL_IMAGE" "$ROOT_DIR"

echo ""
echo "[2/2] Image built successfully."
echo ""
docker images "$FULL_IMAGE" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

# --- Run ---
if [ "$RUN" = true ]; then
    echo ""
    echo "=========================================="
    echo " Starting container..."
    echo "=========================================="

    # Generate a random session secret if not set
    SECRET="${DOCK_SESSION_SECRET:-$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)}"

    docker run -d \
        --name linkdock \
        $RUN_PORTS \
        -e DOCK_SESSION_SECRET="$SECRET" \
        -e DOCK_LISTEN=0.0.0.0:3000 \
        -e DOCK_DATA_DIR=/data \
        -e DOCK_LOG_FORMAT=json \
        -v linkdock-data:/data \
        --restart unless-stopped \
        "$FULL_IMAGE"

    echo ""
    echo "Container 'linkdock' started."
    echo "  Health: http://localhost:3000/health/live"
    echo "  App:    http://localhost:3000"
    echo "  Logs:   docker logs -f linkdock"
    echo "  Stop:   docker stop linkdock && docker rm linkdock"
fi
