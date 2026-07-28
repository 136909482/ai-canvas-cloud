#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
SECRETS_DIR="$SCRIPT_DIR/secrets"
RUNTIME_DIR="$SECRETS_DIR/runtime"
RELEASE_ENV="$SECRETS_DIR/release.env"
BACKUP_DIR="$SCRIPT_DIR/backups"
STATE_FILE="$SECRETS_DIR/release-state.env"

fail() {
  printf '%s\n' 'Deployment stopped. Database migrations are never rolled back automatically.' >&2
  printf '%s\n' 'Use the backup recorded below and apply a forward fix before retrying an incompatible release.' >&2
}
trap fail ERR

if [[ ! -f "$RELEASE_ENV" ]]; then
  printf 'Missing %s. Run setup.sh first.\n' "$RELEASE_ENV" >&2
  exit 1
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

read_env() {
  local key="$1"
  awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "$RELEASE_ENV"
}

set_env() {
  local key="$1"
  local value="$2"
  local temporary="${RELEASE_ENV}.tmp"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$RELEASE_ENV" >"$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$RELEASE_ENV"
}

compose() {
  docker compose --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE" "$@"
}

wait_for_health() {
  local service="$1"
  local port="$2"
  local attempt
  for attempt in $(seq 1 30); do
    if compose exec -T "$service" node -e "fetch('http://127.0.0.1:${port}/health/ready').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"; then
      return 0
    fi
    sleep 2
  done
  printf '%s service did not become ready.\n' "$service" >&2
  return 1
}

require_command docker
require_command awk
require_command grep
docker compose version >/dev/null

if [[ "${EUID}" -ne 0 ]]; then
  printf '%s\n' 'Run this script as root (for example: sudo bash deploy.sh).' >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR" "$BACKUP_DIR"
chmod 700 "$SECRETS_DIR" "$RUNTIME_DIR" "$BACKUP_DIR"

APP_REPOSITORY="$(read_env APP_REPOSITORY)"
if [[ -z "$APP_REPOSITORY" ]]; then
  printf '%s\n' 'APP_REPOSITORY is missing from release.env.' >&2
  exit 1
fi

printf 'Pulling %s:stable ...\n' "$APP_REPOSITORY"
docker pull "${APP_REPOSITORY}:stable"
APP_IMAGE="$(docker image inspect "${APP_REPOSITORY}:stable" --format '{{range .RepoDigests}}{{println .}}{{end}}' | grep -F "${APP_REPOSITORY}@sha256:" | head -n 1)"
if [[ -z "$APP_IMAGE" ]]; then
  printf '%s\n' 'Could not resolve an immutable image digest for stable.' >&2
  exit 1
fi
set_env APP_IMAGE "$APP_IMAGE"

compose up -d postgres redis

POSTGRES_USER="$(read_env POSTGRES_USER)"
POSTGRES_DB="$(read_env POSTGRES_DB)"
BACKUP_FILE="$BACKUP_DIR/ai-canvas-cloud-$(date -u +%Y%m%d-%H%M%S).dump"
printf 'Creating database backup %s ...\n' "$BACKUP_FILE"
compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc >"$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

compose --profile release run --rm release node scripts/check-deployment-config.mjs
compose --profile release run --rm release node scripts/apply-migrations.mjs
compose --profile release run --rm release node scripts/provision-database-roles.mjs
compose --profile release run --rm release node scripts/render-single-host-runtime-env.mjs
compose --profile release run --rm release node scripts/check-admin-role-isolation.mjs
compose up -d --force-recreate public admin

wait_for_health public 8080
wait_for_health admin 8081

cat >"$STATE_FILE" <<EOF
APP_IMAGE=${APP_IMAGE}
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DATABASE_BACKUP=${BACKUP_FILE}
EOF
chmod 600 "$STATE_FILE"
printf '%s\n' 'Deployment completed. Public and Admin services are healthy.'
