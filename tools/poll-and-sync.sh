#!/bin/bash
set -e

SECTION="Admin"

NAS_SRC="/mnt/yodeck-admin"
REPO_ROOT="/home/vortv/Yodeck-HTML-Slideshow"
REPO_DST="$REPO_ROOT/_Yodeck-HTML-Slideshow_Admin/images"

LOG_TAG="[${SECTION}]"

cd "$REPO_ROOT"

echo "$LOG_TAG git pull --rebase"
git pull --rebase || true

mkdir -p "$REPO_DST"

echo "$LOG_TAG rsync from NAS to repo (including deletions)"
rsync -av --delete --exclude=".DS_Store" "$NAS_SRC/" "$REPO_DST/"

# Stage all changes (adds, modifies, deletes) in this folder
git add -A "_Yodeck-HTML-Slideshow_Admin/images"

# If nothing actually changed, bail out
if git diff --cached --quiet; then
    echo "$LOG_TAG No changes to commit."
    exit 0
fi

echo "$LOG_TAG Committing new state of images"
git config user.name "pi-sync"
git config user.email "pi-sync@local"

git commit -m "sync(Admin): auto-sync at $(date '+%Y-%m-%d %H:%M:%S')"
echo "$LOG_TAG Pushing to GitHub"
git push

echo "$LOG_TAG Done."

