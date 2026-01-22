#!/usr/bin/env bash
set -euo pipefail

ADMIN_DIR="_Yodeck-HTML-Slideshow_Admin/images"
RUNTIME_DIR="_Yodeck-HTML-Slideshow_Runtime/images"

mkdir -p "$RUNTIME_DIR"

echo "Admin:   $ADMIN_DIR"
echo "Runtime: $RUNTIME_DIR"

# --------------------------------------------
# Helpers
# --------------------------------------------
lower() { echo "${1,,}"; }

is_video() {
  local f; f="$(lower "$1")"
  [[ "$f" == *.mp4 || "$f" == *.mov || "$f" == *.webm || "$f" == *.m4v ]]
}

is_image() {
  local f; f="$(lower "$1")"
  [[ "$f" == *.png || "$f" == *.jpg || "$f" == *.jpeg || "$f" == *.gif || "$f" == *.webp ]]
}

# Return 0 if dst is missing OR src is newer than dst
needs_update() {
  local src="$1"
  local dst="$2"
  [[ ! -f "$dst" ]] && return 0
  [[ "$src" -nt "$dst" ]] && return 0
  return 1
}

# --------------------------------------------
# Build a list of expected runtime filenames
# (images keep same filename; videos become .mp4)
# --------------------------------------------
declare -A EXPECTED=()

while IFS= read -r -d '' src; do
  base="$(basename "$src")"
  base_lower="$(lower "$base")"

  if is_image "$base"; then
    EXPECTED["$base"]=1
  elif is_video "$base"; then
    if [[ "$base_lower" == *.mp4 ]]; then
      EXPECTED["$base"]=1
    else
      EXPECTED["${base%.*}.mp4"]=1
    fi
  fi
done < <(find "$ADMIN_DIR" -maxdepth 1 -type f -print0)

# --------------------------------------------
# 1) Prune runtime files not expected anymore
# --------------------------------------------
echo "Pruning runtime files not expected anymore…"
while IFS= read -r -d '' rt; do
  rbase="$(basename "$rt")"
  [[ "$rbase" == ".gitkeep" ]] && continue

  if [[ -z "${EXPECTED[$rbase]+x}" ]]; then
    echo "  - removing stale runtime: $rbase"
    rm -f "$rt"
  fi
done < <(find "$RUNTIME_DIR" -maxdepth 1 -type f -print0)

# --------------------------------------------
# 2) Copy images (missing/outdated only)
# --------------------------------------------
echo "Syncing images (missing/outdated only)…"
while IFS= read -r -d '' src; do
  base="$(basename "$src")"
  dst="$RUNTIME_DIR/$base"

  if needs_update "$src" "$dst"; then
    echo "  + copy image: $base"
    cp -f "$src" "$dst"
  fi
done < <(find "$ADMIN_DIR" -maxdepth 1 -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.gif" -o -iname "*.webp" \) -print0)

# --------------------------------------------
# 3) Transcode videos -> Pi-safe mp4 (missing/outdated only)
# --------------------------------------------
echo "Syncing videos (missing/outdated only)…"
while IFS= read -r -d '' src; do
  base="$(basename "$src")"
  base_lower="$(lower "$base")"

  if [[ "$base_lower" == *.mp4 ]]; then
    out_name="$base"
  else
    out_name="${base%.*}.mp4"
  fi

  dst="$RUNTIME_DIR/$out_name"

  if needs_update "$src" "$dst"; then
    echo "  + transcode video: $base -> $out_name"
    tmp="$(mktemp --suffix=.mp4)"

    # Notes:
    # -an = remove audio
    # -tune fastdecode / -bf 0 / -refs 1 = easier for Pi/Chromium
    # -g 60 = keyframe every ~2s at 30fps (predictable seeking)
    # -r 30 = constant fps helps avoid weird timing/fade hiccups
    ffmpeg -y -hide_banner -loglevel error \
      -i "$src" \
      -an \
      -vf "fps=30,format=yuv420p" \
      -c:v libx264 \
      -profile:v main -level 4.0 \
      -preset veryfast -crf 22 \
      -tune fastdecode \
      -bf 0 -refs 1 \
      -g 60 -keyint_min 60 -sc_threshold 0 \
      -maxrate 8M -bufsize 16M \
      -movflags +faststart \
      "$tmp"

    mv -f "$tmp" "$dst"
  fi
done < <(find "$ADMIN_DIR" -maxdepth 1 -type f \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.webm" -o -iname "*.m4v" \) -print0)

echo "Runtime media build complete."
