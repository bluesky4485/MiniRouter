# ── Stage 1: Build ────────────────────────────────────────────────────
FROM node:22-bookworm AS builder

# Build args — set USE_CHINA_MIRROR=true for mainland China builds
ARG USE_CHINA_MIRROR=false
ARG NPM_REGISTRY=https://registry.npmjs.org

WORKDIR /app

RUN if [ "$USE_CHINA_MIRROR" = "true" ]; then \
      sed -i \
        -e "s|http://deb.debian.org/debian|http://mirrors.cloud.tencent.com/debian|g" \
        -e "s|http://deb.debian.org/debian-security|http://mirrors.cloud.tencent.com/debian-security|g" \
        /etc/apt/sources.list.d/debian.sources; \
    fi && \
    apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" && \
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

# Tuning defaults baked into the image (no secrets).
# Runtime -e vars override these; a volume-mounted .env overrides everything.
COPY .env.tuning ./app/.env.tuning

RUN mkdir -p /data/.minirouter

ENV HOME=/data
ENV NODE_ENV=production
ENV MINIROUTER_PORT=8402

EXPOSE 8402

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8402/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/serve.mjs"]
