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

# Verify the Admin NAS is mounted before any deletion-capable sync.
# Never treat an empty local mount directory as an empty NAS folder.
if ! mountpoint -q /mnt/yodeck-admin; then
  echo "ERROR: Admin NAS is not mounted. Aborting synchronization."
  exit 1
fi

if [[ ! -d /mnt/yodeck-admin ]] || \
   [[ -z "$(ls -A /mnt/yodeck-admin 2>/dev/null)" ]]; then
  echo "ERROR: Admin NAS folder is unavailable or empty. Aborting."
  exit 1
fi

echo "-- Admin NAS mount verified"
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
  "--filter=protect *.mp4"
  "--exclude=*.mp4"
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
  if rsync -av --delete --checksum "${RSYNC_EXCLUDES[@]}" "$SRC" "$DEST"; then
    :
  fi

  # Detect changes
  if ! git diff --quiet -- "$DEST_REL"; then
    CHANGED=1
  fi

  echo
done < "$CFG_FILE"

# Synchronize runtime images directly from the Admin NAS folder.
# Videos remain on the NAS and are never uploaded to GitHub.
echo "-- Sync Admin runtime images"

RUNTIME_DIR="$REPO_DIR/_Yodeck-HTML-Slideshow_Runtime/images"

if mountpoint -q /mnt/yodeck-admin && \
   [[ -n "$(ls -A /mnt/yodeck-admin 2>/dev/null)" ]]; then

  mkdir -p "$RUNTIME_DIR"

  rsync -av --delete --checksum \
    --filter='protect .gitkeep' \
    --exclude='.gitkeep' \
    --exclude='*.mp4' \
    --exclude='*.mov' \
    --exclude='*.webm' \
    --exclude='*.m4v' \
    --exclude='*.txt' \
    /mnt/yodeck-admin/ "$RUNTIME_DIR/"

  if ! git diff --quiet -- _Yodeck-HTML-Slideshow_Runtime/images; then
    CHANGED=1
    echo "-- Runtime image changes detected"
  fi
else
  echo "ERROR: Admin NAS mount unavailable or empty"
  exit 1
fi

# Generate playlist from NAS media metadata.
# This detects video changes even though videos are excluded from GitHub.
echo "-- Generate playlist"
python3 "$REPO_DIR/tools/generate-playlist.py"

if ! git diff --quiet -- playlist.json; then
  CHANGED=1
  echo "-- Playlist changes detected"
fi

echo "-- Commit & push changes"

# Stage only the media and playlist managed by this script.
git add -A -- \
  _Yodeck-HTML-Slideshow_Admin/images \
  _Yodeck-HTML-Slideshow_Runtime/images \
  playlist.json

# Detect all staged additions, modifications, and deletions.
echo "-- Changes detected; preparing commit"
git diff --cached --stat

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
