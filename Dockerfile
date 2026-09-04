# Build stage
FROM node:22-slim AS frontend
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Rust build stage
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
RUN apt-get update && apt-get install -y libsqlite3-0 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /app/target/release/linkwarden /usr/local/bin/linkwarden
ENV LW_LISTEN=0.0.0.0:3000
ENV LW_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
CMD ["linkwarden"]
