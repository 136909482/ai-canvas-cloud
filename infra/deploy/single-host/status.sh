#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
RELEASE_ENV="$SCRIPT_DIR/secrets/release.env"
STATE_FILE="$SCRIPT_DIR/secrets/release-state.env"

if [[ ! -f "$RELEASE_ENV" ]]; then
  printf '%s\n' 'No single-host installation was found. Run setup.sh first.' >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  printf '%s\n' 'Run this script as root (for example: sudo bash status.sh).' >&2
  exit 1
fi

compose() {
  docker compose --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE" "$@"
}

printf '%s\n' 'AI Canvas Cloud single-host status'
compose ps
if [[ -f "$STATE_FILE" ]]; then
  printf '%s\n' ''
  printf '%s\n' 'Latest release:'
  grep -E '^(APP_IMAGE|DEPLOYED_AT|DATABASE_BACKUP)=' "$STATE_FILE" || true
fi

for target in 'public 8080' 'admin 8081'; do
  set -- $target
  if compose exec -T "$1" node -e "fetch('http://127.0.0.1:$2/health/live').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    printf '%s service: running\n' "$1"
  else
    printf '%s service: stopped\n' "$1"
    continue
  fi
  if compose exec -T "$1" node -e "fetch('http://127.0.0.1:$2/health/ready').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    printf '%s dependencies: ready\n' "$1"
  else
    printf '%s dependencies: not ready (configure or check OSS)\n' "$1"
  fi
done
