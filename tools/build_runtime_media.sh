#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="_Yodeck-HTML-Slideshow_Admin/images"
OUT_DIR="_Yodeck-HTML-Slideshow_Runtime/images"

mkdir -p "$OUT_DIR"

# Clean runtime every time so removed files disappear automatically
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

shopt -s nullglob

for f in "$SRC_DIR"/*; do
  base="$(basename "$f")"
  ext="${base##*.}"
  ext_lc="$(echo "$ext" | tr '[:upper:]' '[:lower:]')"

  # Images: copy as-is
  if [[ "$ext_lc" =~ ^(png|jpg|jpeg|gif|webp)$ ]]; then
    cp -f "$f" "$OUT_DIR/$base"
    continue
  fi

  # Videos: re-encode to Pi-safe
  if [[ "$ext_lc" =~ ^(mp4|mov|webm|m4v)$ ]]; then
    ffmpeg -y -hide_banner -loglevel error \
      -i "$f" \
      -vf "scale=1280:-2" \
      -c:v libx264 -pix_fmt yuv420p \
      -profile:v main -level 4.0 \
      -preset veryfast -crf 22 \
      -maxrate 5M -bufsize 10M \
      -c:a aac -b:a 128k \
      -movflags +faststart \
      "$OUT_DIR/$base"
    continue
  fi

done

echo "Runtime media built in $OUT_DIR"
