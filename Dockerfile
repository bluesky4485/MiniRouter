# ── Stage 1: Build ────────────────────────────────────────────────────
FROM node:22-bookworm AS builder

WORKDIR /app

RUN sed -i \
      -e "s|http://deb.debian.org/debian|http://mirrors.cloud.tencent.com/debian|g" \
      -e "s|http://deb.debian.org/debian-security|http://mirrors.cloud.tencent.com/debian-security|g" \
      /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com && \
    npm ci --build-from-source=better-sqlite3

COPY tsconfig.json ./
COPY tsup.config.ts ./
COPY src/ ./src/

RUN npm run build -- --no-dts
RUN npm prune --omit=dev && npm cache clean --force

# ── Stage 2: Production ──────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./

COPY --from=builder /app/dist/serve.js ./dist/serve.mjs
COPY --from=builder /app/node_modules ./node_modules
COPY admin/ ./admin/
COPY models/ ./models/

RUN mkdir -p /data/.minirouter

ENV HOME=/data
ENV NODE_ENV=production
ENV BLOCKRUN_PROXY_PORT=8402

EXPOSE 8402

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8402/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/serve.mjs"]
