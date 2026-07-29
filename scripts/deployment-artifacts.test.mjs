import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync("Dockerfile", "utf8");
const dockerignore = readFileSync(".dockerignore", "utf8");
const compose = readFileSync("infra/deploy/staging/docker-compose.yml", "utf8");
const template = readFileSync(
  "infra/deploy/staging/staging.env.example",
  "utf8",
);
const nginx = readFileSync("infra/deploy/staging/web.nginx.conf", "utf8");
const productionCompose = readFileSync(
  "infra/deploy/production/docker-compose.yml",
  "utf8",
);
const productionTemplate = readFileSync(
  "infra/deploy/production/production.env.example",
  "utf8",
);
const singleHostCompose = readFileSync(
  "infra/deploy/single-host/docker-compose.yml",
  "utf8",
);
const singleHostTemplate = readFileSync(
  "infra/deploy/single-host/release.env.example",
  "utf8",
);
const singleHostSetup = readFileSync(
  "infra/deploy/single-host/setup.sh",
  "utf8",
);
const singleHostDeploy = readFileSync(
  "infra/deploy/single-host/deploy.sh",
  "utf8",
);
const singleHostStatus = readFileSync(
  "infra/deploy/single-host/status.sh",
  "utf8",
);
const singleHostWorkflow = readFileSync(
  ".github/workflows/single-host-image.yml",
  "utf8",
);
const adminNginx = readFileSync(
  "infra/deploy/production/admin.nginx.conf",
  "utf8",
);
const prometheus = readFileSync("infra/deploy/staging/prometheus.yml", "utf8");
const alerts = readFileSync("infra/deploy/staging/alerts.yml", "utf8");
const applyMigrations = readFileSync("scripts/apply-migrations.mjs", "utf8");
const releaseManifest = JSON.parse(
  readFileSync("server/db/migrations/release-manifest.json", "utf8"),
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = readFileSync("package-lock.json", "utf8");

test("server generation runtime paths remain removed", () => {
  assert.equal(existsSync("apps/worker"), false);
  assert.equal(existsSync("server/modules/tasks"), false);
  assert.equal(existsSync("server/modules/providers"), false);
  assert.equal(packageJson.scripts["dev:worker"], undefined);
  assert.doesNotMatch(
    packageLock,
    /apps\/worker|node_modules\/bullmq|"bullmq"/,
  );
});

test("deployment artifacts keep runtime targets non-root and migration explicit", () => {
  assert.match(dockerfile, /FROM node:24\.13\.0-alpine3\.22 AS api/);
  assert.match(
    dockerfile,
    /ARG NPM_CONFIG_REGISTRY=https:\/\/registry\.npmjs\.org/,
  );
  assert.doesNotMatch(dockerfile, / AS worker/);
  assert.match(
    dockerfile,
    /FROM nginxinc\/nginx-unprivileged:1\.29\.1-alpine AS web/,
  );
  assert.match(dockerfile, /FROM node:24\.13\.0-alpine3\.22 AS admin-api/);
  assert.match(
    dockerfile,
    /FROM nginxinc\/nginx-unprivileged:1\.29\.1-alpine AS admin-web/,
  );
  assert.match(dockerfile, /FROM workspace AS release/);
  assert.match(
    dockerfile,
    /FROM node:24\.13\.0-alpine3\.22 AS single-host-app/,
  );
  assert.equal(
    (
      dockerfile.match(
        /COPY --from=production-dependencies --chown=node:node \/app\/server\/node_modules \.\/server\/node_modules/g,
      ) ?? []
    ).length,
    5,
  );
  assert.match(
    dockerfile,
    /RUN node -e "import\('\.\/server\/dist\/modules\/admin\/postgresAdminService\.js'\)"/,
  );
  assert.equal((dockerfile.match(/USER node/g) ?? []).length, 6);
  assert.equal(
    packageJson.dependencies?.["@rolldown/binding-win32-x64-msvc"],
    undefined,
  );
  assert.match(dockerignore, /infra\/deploy\/staging\/staging\.env/);
  assert.match(dockerignore, /infra\/deploy\/production\/production\.env/);
  assert.match(dockerignore, /infra\/deploy\/single-host\/secrets/);
  assert.match(compose, /profiles: \["release"\]/);
  assert.match(compose, /staging-postgres-data/);
  assert.match(compose, /staging-redis-data/);
  assert.match(compose, /staging-object-storage-data/);
  assert.doesNotMatch(compose, /npm run db:migrate|apply-migrations\.mjs.*api/);
});

test("staging environment template contains placeholders and no local defaults", () => {
  assert.match(template, /replace-with-staging-random-secret/);
  assert.doesNotMatch(
    template,
    /WORKER_DATABASE_URL|PROVIDER_CREDENTIAL_KEYS|OFFICIAL_PROVIDER_CREDENTIAL_KEYS/,
  );
  assert.doesNotMatch(compose, /\n  worker:/);
  assert.doesNotMatch(
    template,
    /minioadmin|localhost:|127\.0\.0\.1|DEV_SEED_ADMIN=/,
  );
});

test("staging web and object storage boundaries allow controlled HTTPS providers", () => {
  assert.match(nginx, /Content-Security-Policy/);
  assert.match(nginx, /frame-ancestors 'none'/);
  assert.match(nginx, /connect-src 'self' https:/);
  assert.doesNotMatch(nginx, /unsafe-eval/);
  assert.match(nginx, /client_max_body_size 8m/);
  assert.match(nginx, /expires 1y/);
  assert.match(compose, /mc cors set/);
  assert.match(compose, /ExposeHeaders.*ETag/);
  assert.match(compose, /mc anonymous set none/);
  assert.match(
    template,
    /S3_PUBLIC_ENDPOINT=https:\/\/staging-storage\.replace-with-real-domain/,
  );
  assert.match(
    template,
    /S3_PUBLIC_ORIGIN=https:\/\/staging-storage\.replace-with-real-domain/,
  );
});

test("production deployment stays lightweight and loopback-only", () => {
  assert.doesNotMatch(
    productionCompose,
    /\n  (postgres|redis|object-storage|minio|prometheus):/,
  );
  assert.match(productionCompose, /127\.0\.0\.1:\$\{WEB_PORT:-8080\}:8080/);
  assert.match(
    productionCompose,
    /127\.0\.0\.1:\$\{ADMIN_WEB_PORT:-8081\}:8080/,
  );
  assert.match(productionCompose, /API_IMAGE/);
  assert.match(productionCompose, /ADMIN_API_IMAGE/);
  assert.match(productionCompose, /RELEASE_IMAGE/);
  assert.match(productionCompose, /database-roles:/);
  assert.match(productionCompose, /admin-bootstrap:/);
  assert.match(productionCompose, /mem_limit: 448m/);
  assert.match(adminNginx, /proxy_pass http:\/\/admin-api:8788/);
  assert.match(productionTemplate, /S3_FORCE_PATH_STYLE=false/);
  assert.match(
    productionTemplate,
    /S3_PUBLIC_ORIGIN=https:\/\/ai-canvas-cloud-production-assets\.oss-cn-hangzhou\.aliyuncs\.com/,
  );
  assert.doesNotMatch(
    productionTemplate,
    /\n(POSTGRES_PASSWORD|REDIS_PASSWORD)=/,
  );
});

test("single-host production uses one image, two application containers, and private state", () => {
  assert.match(singleHostCompose, /postgres:17\.6-alpine3\.22/);
  assert.match(singleHostCompose, /redis:8\.2\.1-alpine3\.22/);
  assert.match(singleHostCompose, /ai-canvas-cloud-single-host-postgres/);
  assert.match(singleHostCompose, /ai-canvas-cloud-single-host-redis/);
  assert.doesNotMatch(singleHostCompose, /- ["']?(5432|6379):/);
  assert.match(
    singleHostCompose,
    /image: \$\{APP_IMAGE:\?run deploy\.sh first\}/,
  );
  assert.match(singleHostCompose, /127\.0\.0\.1:8080:8080/);
  assert.match(singleHostCompose, /127\.0\.0\.1:8081:8081/);
  assert.match(singleHostCompose, /\n  public:/);
  assert.match(singleHostCompose, /\n  admin:/);
  assert.doesNotMatch(singleHostCompose, /\n  (web|admin-web):/);
  assert.match(singleHostCompose, /secrets\/runtime\/public\.env/);
  assert.match(singleHostCompose, /secrets\/runtime\/admin\.env/);
  assert.match(singleHostCompose, /--maxmemory 64mb/);
  assert.match(singleHostCompose, /--maxmemory-policy noeviction/);
  assert.match(singleHostCompose, /profiles: \["release"\]/);
  assert.match(singleHostCompose, /health\/live/);
  assert.match(singleHostTemplate, /APP_REPOSITORY=/);
  assert.doesNotMatch(singleHostSetup, /docker login/);
  assert.match(singleHostSetup, /PUBLIC_DOMAIN=.*read_required/);
  assert.match(singleHostSetup, /ADMIN_DOMAIN=.*read_required/);
  assert.doesNotMatch(
    singleHostSetup,
    /OSS endpoint|S3_ENDPOINT=.*read_required/,
  );
  assert.match(singleHostSetup, /OBJECT_STORAGE_ENVIRONMENT_FALLBACK=false/);
  assert.match(
    singleHostSetup,
    /ADMIN_BETTER_AUTH_SECRET="\$\(random_hex 32\)"/,
  );
  assert.match(singleHostSetup, /bootstrap-admin\.mjs/);
  assert.match(singleHostDeploy, /APP_REPOSITORY.*stable/);
  assert.match(
    singleHostDeploy,
    /compose up -d --wait --wait-timeout 180 postgres redis/,
  );
  assert.ok(
    singleHostDeploy.indexOf("--wait --wait-timeout 180 postgres redis") <
      singleHostDeploy.indexOf("pg_dump"),
  );
  assert.match(singleHostDeploy, /apply-migrations\.mjs/);
  assert.match(singleHostDeploy, /check-admin-role-isolation\.mjs/);
  assert.match(singleHostStatus, /single-host status/);
  assert.match(singleHostWorkflow, /target: single-host-app/);
  assert.match(singleHostWorkflow, /:stable/);
  assert.match(singleHostWorkflow, /linux\/amd64/);
});

test("staging monitoring scrapes API and keeps alerts low-cardinality", () => {
  assert.match(compose, /prom\/prometheus:v3\.5\.0/);
  assert.match(compose, /staging-prometheus-data/);
  assert.match(prometheus, /targets: \[api:8787\]/);
  assert.doesNotMatch(prometheus, /job_name: worker|worker:8790/);
  assert.match(alerts, /AiCanvasDependencyDown/);
  assert.doesNotMatch(
    alerts,
    /AiCanvasTaskBacklogHigh|AiCanvasProviderFailures|AiCanvasWorkerFailures/,
  );
  assert.doesNotMatch(
    alerts,
    /workspace_id|user_id|project_id|task_id|request_id|email|url=/i,
  );
});

test("staging recovery keeps encrypted backups and restore resources isolated", () => {
  assert.match(dockerfile, /FROM node:24\.13\.0-alpine3\.22 AS operations/);
  assert.match(dockerfile, /USER node[\s\S]*VOLUME \["\/backups"\]/);
  assert.match(compose, /backup-scheduler:/);
  assert.match(compose, /restore-postgres:/);
  assert.match(compose, /restore-redis:/);
  assert.match(compose, /restore-object-storage:/);
  assert.match(compose, /profiles: \["restore"\]/);
  assert.match(compose, /staging-restore-postgres-data/);
  assert.match(compose, /staging-restore-redis-data/);
  assert.match(compose, /staging-restore-object-data/);
  assert.match(prometheus, /targets: \[pushgateway:9091\]/);
  assert.match(alerts, /AiCanvasBackupMissing/);
  assert.match(alerts, /93600/);
  assert.match(template, /BACKUP_ENCRYPTION_KEY=replace-with-/);
  assert.match(template, /RESTORE_RESET_CONFIRMED=true/);
  assert.doesNotMatch(template, /BACKUP_ENCRYPTION_KEY=[A-Za-z0-9+/]{43}=/);
});

test("migration release metadata is enforced by the one-shot migration command", () => {
  assert.deepEqual(releaseManifest.releaseOrder, [
    "expand",
    "migrate",
    "contract",
  ]);
  assert.equal(
    releaseManifest.migrations.some(
      (migration) => migration.version === "0020",
    ),
    true,
  );
  assert.match(applyMigrations, /SET LOCAL lock_timeout/);
  assert.match(applyMigrations, /SET LOCAL statement_timeout/);
  assert.match(applyMigrations, /validateSchemaReleaseManifest/);
});
