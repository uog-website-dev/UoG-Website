# UoG Digital Platform — frontend workspace image (pnpm + Turborepo).
# One image serves both apps; docker-compose selects the app via
# `pnpm dev --filter <app>`.
FROM node:22.23.3-alpine

RUN npm install -g pnpm@9.15.9

ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_store_dir=/pnpm-store

WORKDIR /workspace

# Dependency layer: manifests first for caching. The lockfile is committed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/public-web/package.json apps/public-web/
COPY apps/admin-web/package.json apps/admin-web/
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000

ENTRYPOINT ["/workspace/docker-entrypoint.sh"]
CMD ["pnpm", "dev"]
