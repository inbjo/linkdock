#!/usr/bin/env bash
#
# release.sh — Create a release package (binary + assets)
#
# Usage:
#   ./scripts/release.sh v0.1.0          # tag and package
#   ./scripts/release.sh v0.1.0 --no-tag # package without git tag
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

VERSION="${1:?Usage: release.sh <version> [--no-tag]}"
TAG_TAG=true
if [ "${2:-}" = "--no-tag" ]; then
    TAG_TAG=false
fi

# Strip leading 'v' for the version string
VERSION_NUM="${VERSION#v}"
RELEASE_DIR="$ROOT_DIR/dist-release"
PACKAGE_NAME="linkdock_${VERSION_NUM}_linux_amd64"

echo "=========================================="
echo " Linkdock Release: $VERSION"
echo "=========================================="
echo ""

# --- Step 1: Build frontend + backend ---
echo "[1/4] Building frontend..."
cd "$ROOT_DIR/web"
if [ ! -d node_modules ]; then npm ci; fi
npm run build
cd "$ROOT_DIR"

echo ""
echo "[2/4] Building static musl release binary..."
cargo build --release --locked --target x86_64-unknown-linux-musl
BINARY="target/x86_64-unknown-linux-musl/release/linkdock"

if [ ! -f "$BINARY" ]; then
    echo "ERROR: Binary not found at $BINARY"
    exit 1
fi
"$ROOT_DIR/scripts/verify-static.sh" "$BINARY"

# --- Step 2: Prepare package directory ---
echo ""
echo "[3/4] Packaging..."
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/$PACKAGE_NAME"

cp "$BINARY" "$RELEASE_DIR/$PACKAGE_NAME/linkdock"
cp -r "$ROOT_DIR/deploy" "$RELEASE_DIR/$PACKAGE_NAME/deploy"
cp "$ROOT_DIR/.env.example" "$RELEASE_DIR/$PACKAGE_NAME/.env.example"
cp "$ROOT_DIR/README.md" "$RELEASE_DIR/$PACKAGE_NAME/README.md" 2>/dev/null || true
cp "$ROOT_DIR/LICENSE" "$RELEASE_DIR/$PACKAGE_NAME/" 2>/dev/null || true

cat > "$RELEASE_DIR/$PACKAGE_NAME/INSTALL.sh" << 'INSTALL_EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "Installing Linkdock..."
INSTALL_DIR="${1:-/opt/linkdock}"
sudo mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/data"
sudo cp linkdock "$INSTALL_DIR/bin/"
sudo cp deploy/linkdock.service /etc/systemd/system/ 2>/dev/null || true
sudo chmod +x "$INSTALL_DIR/bin/linkdock"
echo "Installed to $INSTALL_DIR/bin/linkdock"
echo "Edit /etc/systemd/system/linkdock.service to set DOCK_SESSION_SECRET"
echo "Then: sudo systemctl daemon-reload && sudo systemctl enable --now linkdock"
INSTALL_EOF
chmod +x "$RELEASE_DIR/$PACKAGE_NAME/INSTALL.sh"

# Create tarball
cd "$RELEASE_DIR"
tar czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME"
cd "$ROOT_DIR"

# --- Step 3: Checksum ---
echo ""
echo "[4/4] Generating checksum..."
cd "$RELEASE_DIR"
sha256sum "${PACKAGE_NAME}.tar.gz" > "${PACKAGE_NAME}.tar.gz.sha256"
cd "$ROOT_DIR"

# --- Step 4: Git tag ---
if [ "$TAG_TAG" = true ]; then
    echo ""
    echo "Creating git tag $VERSION..."
    git tag -a "$VERSION" -m "Release $VERSION" 2>/dev/null || echo "  Tag already exists or git not available"
fi

echo ""
echo "=========================================="
echo " Release complete!"
echo "=========================================="
echo ""
echo "Package:  $RELEASE_DIR/${PACKAGE_NAME}.tar.gz"
echo "Checksum: $RELEASE_DIR/${PACKAGE_NAME}.tar.gz.sha256"
echo ""
ls -lh "$RELEASE_DIR/"
