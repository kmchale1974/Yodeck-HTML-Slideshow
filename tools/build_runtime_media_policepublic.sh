#!/usr/bin/env bash
set -euo pipefail

ADMIN_DIR="_Yodeck-HTML-Slideshow_VillagePublic/images"
RUNTIME_DIR="_Yodeck-HTML-Slideshow_VillagePublic_Runtime/images"

mkdir -p "$RUNTIME_DIR"

needs_update() {
  local src="$1"
  local dst="$2"
  [[ ! -f "$dst" ]] && return 0
  [[ "$src" -nt "$dst" ]] && return 0
  return 1
}

echo "Admin:   $ADMIN_DIR"
echo "Runtime: $RUNTIME_DIR"

# ------------------------------------------------------------
# 1) Remove runtime files deleted from Admin
# ------------------------------------------------------------
echo "Pruning runtime files that were deleted from Admin…"
while IFS= read -r -d '' rt; do
  local_base="$(basename "$rt")"
  [[ "$local_base" == ".gitkeep" ]] && continue

  if [[ ! -f "$ADMIN_DIR/$local_base" ]]; then
    bn="${local_base%.*}"

    # If runtime is .mp4, admin might have .mov/.webm/.m4v producing this .mp4
    if [[ "$local_base" == *.mp4 ]]; then
      shopt -s nullglob
      matches=( "$ADMIN_DIR/$bn".mp4 "$ADMIN_DIR/$bn".mov "$ADMIN_DIR/$bn".webm "$ADMIN_DIR/$bn".m4v )
      shopt -u nullglob

      if (( ${#matches[@]} == 0 )); then
        echo "  - removing: $local_base"
        rm -f "$rt"
      fi
    else
      echo "  - removing: $local_base"
      rm -f "$rt"
    fi
  fi
done < <(find "$RUNTIME_DIR" -maxdepth 1 -type f -print0)

# ------------------------------------------------------------
# 2) Copy images (missing/outdated only)
# ------------------------------------------------------------
echo "Syncing images (missing/outdated only)…"
while IFS= read -r -d '' src; do
  base="$(basename "$src")"
  dst="$RUNTIME_DIR/$base"
  if needs_update "$src" "$dst"; then
    echo "  + copy image: $base"
    cp -f "$src" "$dst"
  fi
done < <(find "$ADMIN_DIR" -maxdepth 1 -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.gif" -o -iname "*.webp" \) -print0)

# ------------------------------------------------------------
# 3) Transcode videos (missing/outdated only) -> silent Pi-safe MP4
# ------------------------------------------------------------
echo "Syncing videos (missing/outdated only)…"
while IFS= read -r -d '' src; do
  base="$(basename "$src")"
  src_lower="${base,,}"

  if [[ "$src_lower" == *.mp4 ]]; then
    out_name="$base"
  else
    out_name="${base%.*}.mp4"
  fi

  dst="$RUNTIME_DIR/$out_name"

  # If source is non-mp4 and an old runtime of the original extension exists, remove it
  if [[ "$src_lower" != *.mp4 ]]; then
    old="$RUNTIME_DIR/$base"
    [[ -f "$old" ]] && rm -f "$old"
  fi

  if needs_update "$src" "$dst"; then
    echo "  + transcode video: $base -> $out_name"
    tmp="$(mktemp --suffix=.mp4)"

    ffmpeg -y -hide_banner -loglevel error \
      -i "$src" \
      -an \
      -c:v libx264 \
      -pix_fmt yuv420p \
      -profile:v main -level 4.0 \
      -preset veryfast -crf 22 \
      -maxrate 10M -bufsize 20M \
      -movflags +faststart \
      "$tmp"

    mv -f "$tmp" "$dst"
  fi
done < <(find "$ADMIN_DIR" -maxdepth 1 -type f \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.webm" -o -iname "*.m4v" \) -print0)

echo "Runtime media build complete (VillagePublic)."
