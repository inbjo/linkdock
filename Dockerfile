# =============================================================================
# Linkdock Dockerfile — multi-stage build
# =============================================================================

# --- Stage 1: Build frontend ---
FROM node:22-slim AS frontend
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: Build backend (with dependency caching) ---
FROM rust:1-bookworm AS backend
WORKDIR /app

RUN apt-get update && apt-get install -y \
    musl-tools \
    binutils \
    file \
    make \
    perl \
    && rm -rf /var/lib/apt/lists/*
RUN rustup target add x86_64-unknown-linux-musl

# Cache dependencies: copy manifest files first, create a dummy src, build deps
COPY Cargo.toml Cargo.lock build.rs ./
COPY migrations/ migrations/
RUN mkdir -p src && \
    echo "fn main() {}" > src/main.rs && \
    echo "pub fn _placeholder() {}" > src/lib.rs && \
    cargo build --release --locked --target x86_64-unknown-linux-musl || true && \
    rm -rf src

# Copy actual source and frontend dist
COPY src/ src/
COPY scripts/verify-static.sh scripts/verify-static.sh
COPY --from=frontend /app/web/dist web/dist/

# Build the real binary
RUN cargo clean -p linkdock --release --target x86_64-unknown-linux-musl && \
    cargo build --release --locked --target x86_64-unknown-linux-musl && \
    scripts/verify-static.sh target/x86_64-unknown-linux-musl/release/linkdock

# --- Stage 3: Runtime (no glibc dependency) ---
FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget

WORKDIR /app
COPY --from=backend /app/target/x86_64-unknown-linux-musl/release/linkdock /usr/local/bin/linkdock

ENV DOCK_LISTEN=0.0.0.0:3000
ENV DOCK_DATA_DIR=/data
ENV DOCK_LOG_FORMAT=json
ENV RUST_LOG=info,linkdock=debug

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/health/live || exit 1

CMD ["linkdock"]
