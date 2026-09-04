# Build stage — frontend
FROM node:22-slim AS frontend
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Build stage — backend
FROM rust:1-slim AS backend
WORKDIR /app
RUN apt-get update && apt-get install -y libsqlite3-dev pkg-config && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock build.rs ./
COPY migrations/ migrations/
COPY src/ src/
COPY --from=frontend /app/web/dist web/dist
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libsqlite3-0 ca-certificates wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /app/target/release/linkwarden /usr/local/bin/linkwarden
ENV LW_LISTEN=0.0.0.0:3000
ENV LW_DATA_DIR=/data
ENV LW_LOG_FORMAT=json
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/health/live || exit 1
CMD ["linkwarden"]
