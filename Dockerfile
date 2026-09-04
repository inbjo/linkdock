# =============================================================================
# Linkwarden Dockerfile — multi-stage build
# =============================================================================

# --- Stage 1: Build frontend ---
FROM node:22-slim AS frontend
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: Build backend (with dependency caching) ---
FROM rust:1-slim AS backend
WORKDIR /app

RUN apt-get update && apt-get install -y \
    libsqlite3-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Cache dependencies: copy manifest files first, create a dummy src, build deps
COPY Cargo.toml Cargo.lock build.rs ./
COPY migrations/ migrations/
RUN mkdir -p src && \
    echo "fn main() {}" > src/main.rs && \
    echo "pub fn _placeholder() {}" > src/lib.rs && \
    cargo build --release || true && \
    rm -rf src

# Copy actual source and frontend dist
COPY src/ src/
COPY --from=frontend /app/web/dist web/dist/

# Build the real binary
RUN cargo build --release

# --- Stage 3: Runtime (minimal image) ---
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=backend /app/target/release/linkwarden /usr/local/bin/linkwarden

ENV LW_LISTEN=0.0.0.0:3000
ENV LW_DATA_DIR=/data
ENV LW_LOG_FORMAT=json
ENV RUST_LOG=info,linkwarden=debug

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/health/live || exit 1

CMD ["linkwarden"]
