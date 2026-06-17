#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/kaoyan-chat"
BACKUP_DIR="$APP_DIR/backups"
REMOTE="${RCLONE_REMOTE:-gdrive:kaoyan-chat-backup/backups}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-14}"
KEEP_REMOTE_DAYS="${KEEP_REMOTE_DAYS:-90}"

timestamp="$(date -u +%Y%m%d-%H%M%S)"
work_dir="$BACKUP_DIR/work-$timestamp"
archive="$BACKUP_DIR/kaoyan-chat-$timestamp.tar.gz"
latest_db="$BACKUP_DIR/kaoyan-chat-latest.sqlite"

mkdir -p "$BACKUP_DIR" "$work_dir"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

sqlite3 "$APP_DIR/data/kaoyan-chat.sqlite" ".backup '$work_dir/kaoyan-chat.sqlite'"

mkdir -p "$work_dir/app"
rsync -a \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'node_modules' \
  --exclude 'backups' \
  --exclude 'data/kaoyan-chat.sqlite' \
  --exclude 'data/kaoyan-chat.sqlite-*' \
  "$APP_DIR/" "$work_dir/app/"

cp "$work_dir/kaoyan-chat.sqlite" "$work_dir/app/data/kaoyan-chat.sqlite"
cp "$work_dir/kaoyan-chat.sqlite" "$latest_db"

tar -C "$work_dir" -czf "$archive" app
sha256sum "$archive" > "$archive.sha256"

rclone mkdir "$REMOTE"
rclone copy "$archive" "$REMOTE" --fast-list --transfers 4 --checkers 8
rclone copy "$archive.sha256" "$REMOTE" --fast-list --transfers 4 --checkers 8

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'kaoyan-chat-*.tar.gz' -o -name 'kaoyan-chat-*.tar.gz.sha256' \) -mtime +"$KEEP_LOCAL_DAYS" -delete
rclone delete "$REMOTE" --min-age "${KEEP_REMOTE_DAYS}d" --include 'kaoyan-chat-*.tar.gz' --include 'kaoyan-chat-*.tar.gz.sha256' --fast-list || true
rclone rmdirs "$REMOTE" --leave-root || true

echo "backup_ok archive=$archive remote=$REMOTE"
