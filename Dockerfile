# syntax=docker/dockerfile:1.7

FROM node:24.13.0-alpine3.22 AS workspace
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/project-graph/package.json packages/project-graph/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY server/package.json server/package.json
RUN npm ci

FROM minio/mc:RELEASE.2025-04-16T18-13-26Z AS minio-client

FROM workspace AS build
COPY . .
RUN npm run build

FROM workspace AS production-dependencies
RUN npm ci --omit=dev

FROM node:24.13.0-alpine3.22 AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/server/package.json server/package.json
COPY --from=build --chown=node:node /app/server/dist server/dist
USER node
EXPOSE 8787
CMD ["node", "apps/api/dist/index.js"]

FROM node:24.13.0-alpine3.22 AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/server/package.json server/package.json
COPY --from=build --chown=node:node /app/server/dist server/dist
COPY --from=build --chown=node:node /app/server/db/migrations server/db/migrations
COPY --from=build --chown=node:node /app/scripts/apply-migrations.mjs scripts/apply-migrations.mjs
COPY --from=build --chown=node:node /app/scripts/check-schema-release.mjs scripts/check-schema-release.mjs
COPY --from=build --chown=node:node /app/scripts/check-deployment-config.mjs scripts/check-deployment-config.mjs
USER node
CMD ["node", "scripts/apply-migrations.mjs"]

FROM node:24.13.0-alpine3.22 AS operations
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache postgresql17-client
COPY --from=minio-client /usr/bin/mc /usr/local/bin/mc
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/server/package.json server/package.json
COPY --from=build --chown=node:node /app/server/dist server/dist
COPY --from=build --chown=node:node /app/server/db/migrations server/db/migrations
COPY --from=build --chown=node:node /app/scripts scripts
RUN mkdir -p /backups && chown node:node /backups
USER node
VOLUME ["/backups"]
CMD ["node", "scripts/create-staging-backup.mjs"]

FROM nginxinc/nginx-unprivileged:1.29.1-alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/deploy/staging/web.nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 8080
