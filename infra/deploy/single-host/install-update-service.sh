#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_DIR="$SCRIPT_DIR/secrets/update"
SERVICE_UNIT="/etc/systemd/system/ai-canvas-cloud-update.service"
PATH_UNIT="/etc/systemd/system/ai-canvas-cloud-update.path"

if [[ "${EUID}" -ne 0 ]]; then
  printf '%s\n' 'Run this script as root.' >&2
  exit 1
fi
if [[ "$SCRIPT_DIR" =~ [[:space:]] ]]; then
  printf '%s\n' 'The deployment directory must not contain whitespace.' >&2
  exit 1
fi
command -v systemctl >/dev/null 2>&1 || {
  printf '%s\n' 'systemd is required for managed updates.' >&2
  exit 1
}
command -v flock >/dev/null 2>&1 || {
  printf '%s\n' 'flock is required for managed updates.' >&2
  exit 1
}

install -d -m 0770 -o root -g 1000 "$UPDATE_DIR"

cat >"$SERVICE_UNIT" <<EOF
[Unit]
Description=AI Canvas Cloud managed update
Requires=docker.service
After=docker.service network-online.target
ConditionPathExists=$SCRIPT_DIR/secrets/release.env

[Service]
Type=oneshot
WorkingDirectory=$SCRIPT_DIR
ExecStart=/bin/bash $SCRIPT_DIR/update-worker.sh
UMask=0077
TimeoutStartSec=infinity
PrivateTmp=true
ProtectHome=read-only
EOF

cat >"$PATH_UNIT" <<EOF
[Unit]
Description=Watch for AI Canvas Cloud update requests
After=docker.service

[Path]
PathExists=$UPDATE_DIR/request
Unit=ai-canvas-cloud-update.service

[Install]
WantedBy=multi-user.target
EOF

chmod 0644 "$SERVICE_UNIT" "$PATH_UNIT"
systemctl daemon-reload
systemctl enable --now ai-canvas-cloud-update.path >/dev/null
