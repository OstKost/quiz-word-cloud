#!/usr/bin/env bash
# Installed root-owned on the server; source archive arrives on stdin.
set -euo pipefail
[[ $# == 1 && $1 =~ ^[a-f0-9]{40}$ ]] || exit 2
exec 9>/var/lock/quiz-deploy.lock
flock -w 600 9
base=/opt/quiz-word-cloud
release=$1
mkdir -p "$base/releases" "$base/backups"
stage=$(mktemp -d "$base/releases/.incoming.XXXXXX")
trap 'rm -rf "$stage"' EXIT
tar --extract --gzip --no-same-owner --no-same-permissions --file=- --directory="$stage"
docker build --pull -t "quiz-word-cloud:$release" "$stage"
previous=$(cat "$base/current" 2>/dev/null || true)
# Back up a consistent SQLite snapshot before replacing a running release.
if [[ -n $previous && -f $base/data/quiz.sqlite ]]; then
  docker compose --project-directory "$base" -f "$base/compose.yml" exec -T app node --input-type=module -e \
    'import {DatabaseSync,backup} from "node:sqlite"; const db=new DatabaseSync("/data/quiz.sqlite"); await backup(db,"/data/pre-deploy.sqlite"); db.close();'
  mv "$base/data/pre-deploy.sqlite" "$base/backups/$(date -u +%Y%m%dT%H%M%SZ)-$previous.sqlite"
fi
cp "$stage/deploy/compose.yml" "$base/compose.yml.next"
cp "$base/compose.yml" "$base/compose.yml.previous" 2>/dev/null || true
mv "$base/compose.yml.next" "$base/compose.yml"
printf 'RELEASE=%s\n' "$release" > "$base/.env"
if ! docker compose --project-directory "$base" -f "$base/compose.yml" up -d --wait --wait-timeout 120; then
  docker compose --project-directory "$base" -f "$base/compose.yml" logs --tail=80
  if [[ -n $previous ]]; then
    cp "$base/compose.yml.previous" "$base/compose.yml"
    printf 'RELEASE=%s\n' "$previous" > "$base/.env"
    docker compose --project-directory "$base" -f "$base/compose.yml" up -d --wait --wait-timeout 120
  fi
  exit 1
fi
printf '%s\n' "$release" > "$base/current"
rm -rf "$base/releases/$release"
mv "$stage" "$base/releases/$release"
echo "Deployed $release"
