# syntax=docker/dockerfile:1.7

# One image, one port, one volume: the Next.js frontend (public port) proxies /api to the
# NestJS API + sync worker, which listens on loopback inside the container.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.10.0
WORKDIR /app

# ------------------------------------------------------------------------------ build
FROM base AS build
# Toolchain for native modules (better-sqlite3, argon2) when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
ARG APP_VERSION=
RUN pnpm --filter @crossfade/shared build \
  && pnpm --filter @crossfade/api build \
  && pnpm --filter @crossfade/web build
RUN pnpm --filter @crossfade/api deploy --prod --legacy /out/api

# ------------------------------------------------------------------------------ runtime
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG APP_VERSION=
LABEL org.opencontainers.image.title="Crossfade" \
      org.opencontainers.image.description="Self-hosted two-way playlist sync for Spotify, YouTube Music and Apple Music" \
      org.opencontainers.image.source="https://github.com/ahamedzoha/crossfade" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}"
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NO_COLOR=1 \
    APP_VERSION=${APP_VERSION} \
    DATA_DIR=/data \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    API_HOST=127.0.0.1 \
    API_PORT=4000 \
    APP_URL=http://localhost:8080 \
    PUID=1000 \
    PGID=1000

WORKDIR /app
COPY --from=build /out/api ./api
COPY --from=build /app/apps/api/dist ./api/dist
COPY --from=build /app/apps/api/drizzle ./api/drizzle
COPY --from=build /app/apps/web/.next/standalone ./web
COPY --from=build /app/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build /app/apps/web/public ./web/apps/web/public
COPY docker/entrypoint.sh docker/supervisor.mjs ./
RUN chmod +x entrypoint.sh && mkdir -p /data && chown node:node /data

VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
