# syntax=docker/dockerfile:1
#
# NEXORA admin image: static SPA served by unprivileged nginx under /admin/, proxying /api/ to the
# API service on the same origin. Build from the repository root:
#   docker build -f infrastructure/docker/admin.Dockerfile .

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine

FROM ${NODE_IMAGE} AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# Every workspace manifest is copied so the frozen lockfile matches the workspace exactly.
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/cli/package.json packages/cli/
COPY packages/cli/bin packages/cli/bin
# Optional extra CA for builds behind a TLS-intercepting proxy. Passed as a BuildKit secret so it is
# never written to an image layer:  docker build --secret id=extra_ca,src=/path/to/ca.pem ...
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --filter "@nexora/admin..."

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY apps/admin apps/admin
RUN pnpm --filter @nexora/shared run build && pnpm --filter @nexora/admin run build

FROM ${NGINX_IMAGE} AS runtime
COPY infrastructure/docker/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/docker/admin/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html/admin
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/admin/healthz"]
