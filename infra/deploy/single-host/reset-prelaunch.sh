#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
SECRETS_DIR="$SCRIPT_DIR/secrets"
RELEASE_ENV="$SECRETS_DIR/release.env"
BACKUP_DIR="$SCRIPT_DIR/backups"
POSTGRES_VOLUME="ai-canvas-cloud-single-host-postgres"
COMPOSE_PROJECT="ai-canvas-cloud-single-host"
VOLUME_REMOVED=false
BACKUP_FILE=""

compose() {
  docker compose --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE" "$@"
}

read_env() {
  local key="$1"
  awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "$RELEASE_ENV"
}

fail() {
  local status=$?
  if [[ "$VOLUME_REMOVED" == false && -f "$RELEASE_ENV" ]]; then
    printf '%s\n' 'Reset stopped before the PostgreSQL volume was removed. Restoring the existing services ...' >&2
    compose up -d >/dev/null 2>&1 || true
  else
    printf '%s\n' 'Reset stopped after the old PostgreSQL volume was removed.' >&2
    printf 'Restore the verified backup before retrying: %s\n' "${BACKUP_FILE:-not-created}" >&2
  fi
  exit "$status"
}
trap fail ERR

if [[ "${1:-}" != "--confirm-empty-database" || "$#" -ne 1 ]]; then
  printf '%s\n' 'This command permanently replaces the single-host PostgreSQL database with an empty current baseline.' >&2
  printf '%s\n' 'Use only before formal operations, after accepting that all accounts, projects, Admin settings, and database metadata will be discarded.' >&2
  printf 'Usage: sudo bash %s --confirm-empty-database\n' "$(basename "$0")" >&2
  exit 2
fi

if [[ "$EUID" -ne 0 ]]; then
  printf 'Run as root: sudo bash %s --confirm-empty-database\n' "$(basename "$0")" >&2
  exit 1
fi

for command in docker awk date; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  }
done
docker compose version >/dev/null

for path in "$COMPOSE_FILE" "$RELEASE_ENV" "$SCRIPT_DIR/deploy.sh" "$SCRIPT_DIR/status.sh"; do
  if [[ ! -f "$path" ]]; then
    printf 'Missing required deployment file: %s\n' "$path" >&2
    exit 1
  fi
done

POSTGRES_USER="$(read_env POSTGRES_USER)"
POSTGRES_DB="$(read_env POSTGRES_DB)"
if [[ -z "$POSTGRES_USER" || -z "$POSTGRES_DB" ]]; then
  printf '%s\n' 'POSTGRES_USER and POSTGRES_DB must exist in secrets/release.env.' >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$SECRETS_DIR" "$BACKUP_DIR"

printf '%s\n' 'Stopping the public and Admin applications ...'
compose stop public admin
printf '%s\n' 'Starting PostgreSQL and Redis for the final pre-reset backup ...'
compose up -d --wait --wait-timeout 180 postgres redis

BACKUP_FILE="$BACKUP_DIR/pre-current-baseline-$(date -u +%Y%m%d-%H%M%S).dump"
printf 'Creating final backup: %s\n' "$BACKUP_FILE"
compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc >"$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
if [[ ! -s "$BACKUP_FILE" ]]; then
  printf '%s\n' 'The final PostgreSQL backup is empty; refusing to remove the database volume.' >&2
  false
fi
if ! compose exec -T postgres pg_restore --list <"$BACKUP_FILE" >/dev/null; then
  printf '%s\n' 'The final PostgreSQL backup cannot be parsed; refusing to remove the database volume.' >&2
  false
fi

VOLUME_NAME="$(docker volume inspect "$POSTGRES_VOLUME" --format '{{.Name}}')"
VOLUME_PROJECT="$(docker volume inspect "$POSTGRES_VOLUME" --format '{{index .Labels "com.docker.compose.project"}}')"
VOLUME_KEY="$(docker volume inspect "$POSTGRES_VOLUME" --format '{{index .Labels "com.docker.compose.volume"}}')"
if [[ "$VOLUME_NAME" != "$POSTGRES_VOLUME" || "$VOLUME_PROJECT" != "$COMPOSE_PROJECT" || "$VOLUME_KEY" != "postgres-data" ]]; then
  printf '%s\n' 'The PostgreSQL volume identity does not match this single-host deployment; refusing to delete it.' >&2
  false
fi

printf '%s\n' 'Stopping the complete single-host deployment ...'
compose down
if [[ -n "$(docker ps -aq --filter "volume=$POSTGRES_VOLUME")" ]]; then
  printf '%s\n' 'A container still mounts the PostgreSQL volume; refusing to delete it.' >&2
  false
fi

printf 'Removing verified PostgreSQL volume: %s\n' "$POSTGRES_VOLUME"
docker volume rm "$POSTGRES_VOLUME"
VOLUME_REMOVED=true

printf '%s\n' 'Deploying the current image onto a fresh database baseline ...'
bash "$SCRIPT_DIR/deploy.sh"

printf '%s\n' 'Create the first super_admin account for the rebuilt database.'
compose --profile release run --rm release node scripts/bootstrap-admin.mjs

bash "$SCRIPT_DIR/status.sh"
printf '%s\n' 'Prelaunch database reset completed.'
printf 'Recovery backup: %s\n' "$BACKUP_FILE"
printf '%s\n' 'Reconfigure object storage, managed SMTP, and site settings in Admin. Redis, OSS objects, secrets, and previous backups were not deleted.'
