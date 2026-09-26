# Capacity: the image the own-cloud pipeline builds and both the rolling web
# swap and Coolify's health probe run. Node + pnpm port of upstream's
# deploy/docker/Dockerfile.catalog: same build-only placeholders, same
# migrate-then-serve entrypoint, plus curl (Coolify probes with curl or busybox
# wget inside the container; node:*-slim ships neither) and the in-process
# gateway that serves /api/ws next to the Next.js server.
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@10.34.5
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN ORBIT_PASSWORD_AUTH=true ORBIT_PREVIEW_BUILD=1 NEXT_TELEMETRY_DISABLED=1 \
    BETTER_AUTH_SECRET=build-only-not-a-runtime-credential \
    DATABASE_URL=postgres://build:build@127.0.0.1:1/orbit_build REDIS_URL=redis://127.0.0.1:1 \
    pnpm --filter @orbit/web exec next build
RUN node .capacity/prepare-standalone.mjs

# Keep the build stage's distro and libc: prepare-standalone ships its argon2 binding.
FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone/ ./
USER node
EXPOSE 3000
CMD ["sh", "-c", "node apps/web/migrate.mjs && node apps/web/admin-account.mjs && exec node apps/web/gateway.mjs"]
