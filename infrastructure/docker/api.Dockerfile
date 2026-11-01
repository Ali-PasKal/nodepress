# syntax=docker/dockerfile:1
#
# NEXORA API image. Targets:
#   runtime   (default) production API server, production dependencies only, runs as non-root
#   migrator  one-shot job that applies Prisma migrations (includes the Prisma CLI)
#
# Build from the repository root:  docker build -f infrastructure/docker/api.Dockerfile .

ARG NODE_IMAGE=node:22-alpine

# ---- dependencies + build -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo

# Manifests first so the dependency layer is cached until a lockfile or manifest changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# Every workspace manifest is copied so the frozen lockfile matches the workspace exactly.
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/site-runtime/package.json apps/site-runtime/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/theme-sdk/package.json packages/theme-sdk/
COPY packages/theme-starter/package.json packages/theme-starter/
COPY packages/cli/package.json packages/cli/
COPY packages/cli/bin packages/cli/bin
# Optional extra CA for builds behind a TLS-intercepting proxy. Passed as a BuildKit secret so it is
# never written to an image layer:  docker build --secret id=extra_ca,src=/path/to/ca.pem ...
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --filter "@nexora/api..."

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
# The API validates theme settings against the installed themes' manifests (plain data, no rendering).
COPY packages/theme-sdk packages/theme-sdk
COPY packages/theme-starter packages/theme-starter
COPY apps/api apps/api
RUN pnpm --filter "@nexora/api^..." run build \
 && pnpm --filter @nexora/api run build \
 && pnpm --filter @nexora/api deploy --prod --legacy /out

# ---- migrator --------------------------------------------------------------------------------
FROM build AS migrator
WORKDIR /repo/apps/api
USER node
CMD ["/repo/apps/api/node_modules/.bin/prisma", "migrate", "deploy"]

# ---- runtime ---------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Application files stay root-owned and read-only for the unprivileged runtime user.
COPY --from=build /out ./
# Writable location for local media storage (MEDIA_LOCAL_DIR=/data/uploads); mount a volume here.
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
