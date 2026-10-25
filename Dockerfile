# ============================================================
# ربي فارمسي — Ruba Pharmacy Platform
# صورة إنتاج متعددة المراحل (multi-stage production image)
# Build:  docker build -t ruba-pharmacy .
# Run:    docker compose up -d
# ============================================================

# ---------- 1) التبعيات ----------
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

# ---------- 2) البناء ----------
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bunx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:/app/db/build.db
RUN bunx next build \
  && cp -r .next/static .next/standalone/.next/ \
  && cp -r public .next/standalone/

# ---------- 3) التشغيل ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S ruba && adduser -S ruba -G ruba

COPY --from=builder --chown=ruba:ruba /app/.next/standalone ./
COPY --from=builder --chown=ruba:ruba /app/prisma ./prisma
RUN mkdir -p /app/db && chown ruba:ruba /app/db

USER ruba
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/api >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
