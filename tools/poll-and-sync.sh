#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------
# Multi-folder NAS → Repo sync
# Repo: kmchale1974/Yodeck-HTML-Slideshow
# Runs on signage-sync Pi via systemd timer/service
# ------------------------------------------------------------

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG_FILE="${REPO_DIR}/tools/sync-folders.conf"

LOCK_FILE="/tmp/yodeck-sync.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another sync is already running; exiting."
  exit 0
fi

cd "$REPO_DIR"

if [[ ! -f "$CFG_FILE" ]]; then
  echo "Missing config: $CFG_FILE"
  exit 1
fi

echo "== Yodeck multi-sync =="
echo "Repo: $REPO_DIR"
echo "Config: $CFG_FILE"
echo

# Pull first to avoid non-fast-forward push failures
echo "-- git pull --rebase"
git fetch origin main
git pull --rebase origin main

CHANGED=0

# Excludes (tweak as needed)
RSYNC_EXCLUDES=(
  "--exclude=.gitkeep"
  "--exclude=Thumbs.db"
  "--exclude=Desktop.ini"
  "--exclude=._*"
  "--exclude=.DS_Store"
  "--exclude=_Naming Conventions.txt"
)

# Config format:
# key|/mnt/yodeck-xxx|_Yodeck-HTML-Slideshow_Key/images
while IFS='|' read -r KEY SRC_MNT DEST_REL; do
  # skip blanks/comments
  [[ -z "${KEY// }" ]] && continue
  [[ "${KEY:0:1}" == "#" ]] && continue

  SRC="${SRC_MNT%/}/"
  DEST="${REPO_DIR}/${DEST_REL%/}/"

  echo "== Sync: ${KEY}"
  echo "   from: $SRC"
  echo "     to: $DEST"

  if [[ ! -d "$SRC_MNT" ]]; then
    echo "   !! missing mount dir: $SRC_MNT (skipping)"
    echo
    continue
  fi

  mkdir -p "$DEST"

  # If mount exists but is empty due to mount failure, you may want to skip.
  # This check helps avoid deleting repo files if the mount is accidentally empty.
  if [[ -z "$(ls -A "$SRC_MNT" 2>/dev/null || true)" ]]; then
    echo "   !! mount appears empty: $SRC_MNT (skipping to avoid deletes)"
    echo
    continue
  fi

  # rsync → repo watch folder
  if rsync -av --delete --size-only "${RSYNC_EXCLUDES[@]}" "$SRC" "$DEST"; then
    :
  fi

  # Detect changes
  if ! git diff --quiet -- "$DEST_REL"; then
    CHANGED=1
  fi

  echo
done < "$CFG_FILE"

if [[ "$CHANGED" -eq 0 ]]; then
  echo "-- No changes detected. Done."
  exit 0
fi

echo "-- Commit & push changes"
git add -A

if git diff --cached --quiet; then
  echo "Nothing staged after add (unexpected). Done."
  exit 0
fi

git config user.name "signage-sync"
git config user.email "signage-sync@users.noreply.github.com"
git commit -m "chore(sync): update watch folders [skip ci]"

# Rebase again just in case another actor pushed while we worked
git pull --rebase origin main
git push origin main

echo "-- Done."
