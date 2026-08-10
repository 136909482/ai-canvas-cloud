#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_DIR="$SCRIPT_DIR/secrets/update"
REQUEST_FILE="$UPDATE_DIR/request"
STATUS_FILE="$UPDATE_DIR/status.env"
LOCK_FILE="$UPDATE_DIR/worker.lock"

write_status() {
  local state="$1"
  local request_id="$2"
  local started_at="$3"
  local finished_at="$4"
  local message="$5"
  local temporary="${STATUS_FILE}.tmp"
  cat >"$temporary" <<EOF
STATE=$state
REQUEST_ID=$request_id
STARTED_AT=$started_at
FINISHED_AT=$finished_at
MESSAGE=$message
EOF
  chown root:1000 "$temporary"
  chmod 0640 "$temporary"
  mv "$temporary" "$STATUS_FILE"
}

if [[ "${EUID}" -ne 0 ]]; then
  printf '%s\n' 'The update worker must run as root.' >&2
  exit 1
fi

install -d -m 0770 -o root -g 1000 "$UPDATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

[[ -f "$REQUEST_FILE" ]] || exit 0
REQUEST_ID="$(tr -d '\r\n' <"$REQUEST_FILE")"
if [[ ! "$REQUEST_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  rm -f "$REQUEST_FILE"
  write_status failed "" "" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "Invalid update request"
  exit 1
fi

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
write_status running "$REQUEST_ID" "$STARTED_AT" "" "Update running"
rm -f "$REQUEST_FILE"

if bash "$SCRIPT_DIR/deploy.sh"; then
  write_status succeeded "$REQUEST_ID" "$STARTED_AT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "Update completed"
else
  exit_code=$?
  write_status failed "$REQUEST_ID" "$STARTED_AT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "Update failed"
  exit "$exit_code"
fi
