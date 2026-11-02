# syntax=docker/dockerfile:1
#
# NEXORA public site runtime: server-renders published content from the API's public Delivery
# endpoints with the active theme. It holds no credentials and has no database access.
# Build from the repository root:  docker build -f infrastructure/docker/site.Dockerfile .

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo
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
COPY packages/plugin-runtime/package.json packages/plugin-runtime/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY plugins/reading-time/package.json plugins/reading-time/
COPY plugins/related-posts/package.json plugins/related-posts/
COPY plugins/publish-notifications/package.json plugins/publish-notifications/
COPY packages/cli/bin packages/cli/bin
# Optional extra CA for builds behind a TLS-intercepting proxy. Passed as a BuildKit secret so it is
# never written to an image layer:  docker build --secret id=extra_ca,src=/path/to/ca.pem ...
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --filter "@nexora/site-runtime..."

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/theme-sdk packages/theme-sdk
COPY packages/theme-starter packages/theme-starter
COPY apps/site-runtime apps/site-runtime
RUN pnpm --filter "@nexora/site-runtime..." run build \
 && pnpm --filter @nexora/site-runtime deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    SITE_HOST=0.0.0.0 \
    SITE_PORT=4321
WORKDIR /app
# Application files stay root-owned and read-only for the unprivileged runtime user.
COPY --from=build /out ./
USER node
EXPOSE 4321
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4321/_health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
