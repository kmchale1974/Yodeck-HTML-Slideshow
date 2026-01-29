#!/usr/bin/env bash
set -euo pipefail

REPO="/home/vortv/Yodeck-HTML-Slideshow"

# ---- Sources (NAS mounts) ----
SRC_ADMIN="/mnt/yodeck-admin"
SRC_VP="/mnt/yodeck-villagepublic"

# ---- Destinations (repo watch folders) ----
DST_ADMIN="$REPO/_Yodeck-HTML-Slideshow_Admin/images"
DST_VP="$REPO/_Yodeck-HTML-Slideshow_VillagePublic/images"

# Exclusions: don’t pollute watch folders with junk
RSYNC_EXCLUDES=(
  "--exclude=.gitkeep"
  "--exclude=Thumbs.db"
  "--exclude=._*"
  "--exclude=.DS_Store"
  "--exclude=_Naming Conventions.txt"
)

echo "=== Yodeck sync: $(date) ==="
echo "Repo: $REPO"

# Ensure destinations exist
mkdir -p "$DST_ADMIN" "$DST_VP"

sync_one () {
  local src="$1"
  local dst="$2"
  local label="$3"

  if [[ ! -d "$src" ]]; then
    echo "!! Missing source mount for $label: $src"
    return 1
  fi

  echo "--- Sync $label ---"
  rsync -av --delete "${RSYNC_EXCLUDES[@]}" "$src/" "$dst/"
}

cd "$REPO"

# Pull latest first (avoid push rejection)
git fetch origin main >/dev/null 2>&1 || true
git pull --rebase origin main || true

sync_one "$SRC_ADMIN" "$DST_ADMIN" "Admin"
sync_one "$SRC_VP" "$DST_VP" "VillagePublic"

# If nothing changed, exit quietly
if git diff --quiet && git diff --cached --quiet; then
  echo "No changes detected."
  exit 0
fi

# Commit + push (single commit for both folders)
git add -A

if git diff --cached --quiet; then
  echo "No staged changes after add."
  exit 0
fi

git commit -m "chore(sync): update watch folders [skip ci]" || true
git push origin main
echo "Done."
