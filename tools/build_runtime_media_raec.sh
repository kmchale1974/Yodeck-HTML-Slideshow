#!/usr/bin/env bash
set -euo pipefail

ADMIN_DIR="_Yodeck-HTML-Slideshow_RAEC/images"
RUNTIME_DIR="_Yodeck-HTML-Slideshow_RAEC_Runtime/images"

mkdir -p "$RUNTIME_DIR"

needs_update() {
  local src="$1"
  local dst="$2"
  [[ ! -f "$dst" ]] && return 0
  [[ "$src" -nt "$dst" ]] && return 0
  return 1
}

echo "Source:  $ADMIN_DIR"
echo "Runtime: $RUNTIME_DIR"

# 1) Remove runtime files deleted from source
while IFS= read -r -d '' rt; do
  local_base="$(basename "$rt")"
  [[ "$local_base" == ".gitkeep" ]] && continue

  if [[ ! -f "$ADMIN_DIR/$local_base" ]]; then
    bn="${local_base%.*}"
    if [[ "$local_base" == *.mp4 ]]; then
      shopt -s nullglob
      matches=( "$ADMIN_DIR/$bn".mp4 "$ADMIN_DIR/$bn".mov "$ADMIN_DIR/$bn".webm "$ADMIN_DIR/$bn".m4v )
      shopt -u nullglob
      if (( ${#matches[@]} == 0 )); then rm -f "$rt"; fi
    else
      rm -f "$rt"
    fi
  fi
done < <(find "$RUNTIME_DIR" -maxdepth 1 -type f -print0)

# 2) Copy images (missing/outdated only)
while IFS= read -r -d '' src; do
  base="$(basename "$src")"
  dst="$RUNTIME_DIR/$base"
  if needs_update "$src" "$dst"; then cp -f "$src" "$dst"; fi
done < <(find "$ADMIN_DIR" -maxdepth 1 -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.gif" -o -iname "*.webp" \) -print0)

# 3) Transcode videos -> silent Pi-safe MP4 (missing/outdated only)
while IFS= read -r -d '' src; do
  base="$(basename "$src")"
  src_lower="${base,,}"

  if [[ "$src_lower" == *.mp4 ]]; then
    out_name="$base"
  else
    out_name="${base%.*}.mp4"
  fi

  dst="$RUNTIME_DIR/$out_name"

  if [[ "$src_lower" != *.mp4 ]]; then
    old="$RUNTIME_DIR/$base"
    [[ -f "$old" ]] && rm -f "$old"
  fi

  if needs_update "$src" "$dst"; then
    tmp="$(mktemp --suffix=.mp4)"
    ffmpeg -y -hide_banner -loglevel error       -i "$src"       -an       -c:v libx264       -pix_fmt yuv420p       -profile:v main -level 4.0       -preset veryfast -crf 22       -maxrate 10M -bufsize 20M       -movflags +faststart       "$tmp"
    mv -f "$tmp" "$dst"
  fi
done < <(find "$ADMIN_DIR" -maxdepth 1 -type f \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.webm" -o -iname "*.m4v" \) -print0)

echo "Runtime media build complete (RAEC)."
