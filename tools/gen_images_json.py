#!/usr/bin/env python3
import os
import sys
import json
import re
from datetime import datetime

# Allowed extensions: images + video
ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".mp4", ".mov", ".webm", ".ogg"}

# Patterns we support:
# 1) 2025-12-01_to_2025-12-30__12s__Title.png
# 2) 2025-12-01_to_2025-12-30_Title.png
# 3) __8s__Title.jpg  (no date window)
NAME_RE_WITH_DUR = re.compile(
    r"""
    ^(?P<start>\d{4}-\d{2}-\d{2})
    _to_
    (?P<end>\d{4}-\d{2}-\d{2})
    __?(?P<dur>\d+)[sS]?__?
    _?(?P<title>.+)
    \.(?P<ext>[^.]+)$
    """,
    re.X,
)

NAME_RE_NO_DUR = re.compile(
    r"""
    ^(?P<start>\d{4}-\d{2}-\d{2})
    _to_
    (?P<end>\d{4}-\d{2}-\d{2})
    _(?P<title>.+)
    \.(?P<ext>[^.]+)$
    """,
    re.X,
)

NAME_RE_DUR_PREFIX = re.compile(
    r"""
    ^__(?P<dur>\d+)[sS]?__
    (?P<title>.+)
    \.(?P<ext>[^.]+)$
    """,
    re.X,
)


def parse_filename(name):
    """
    Parse a filename into metadata:
    - start, end (optional)
    - durationSeconds (optional)
    - title
    """
    base, ext = os.path.splitext(name)
    ext_lower = ext.lower()

    # Default metadata
    meta = {
        "title": base,
        "start": None,
        "end": None,
        "durationSeconds": None,
    }

    m = NAME_RE_WITH_DUR.match(name)
    if m:
        meta["title"] = m.group("title").replace("_", " ").strip()
        meta["start"] = m.group("start")
        meta["end"] = m.group("end")
        meta["durationSeconds"] = int(m.group("dur"))
        return meta

    m = NAME_RE_NO_DUR.match(name)
    if m:
        meta["title"] = m.group("title").replace("_", " ").strip()
        meta["start"] = m.group("start")
        meta["end"] = m.group("end")
        # No duration encoded; we'll fall back later
        return meta

    m = NAME_RE_DUR_PREFIX.match(name)
    if m:
        meta["title"] = m.group("title").replace("_", " ").strip()
        meta["durationSeconds"] = int(m.group("dur"))
        return meta

    # Fallback: just use the base name as title
    meta["title"] = base.replace("_", " ").strip()
    return meta


def build_manifest(images_dir, out_json):
    """
    Scan images_dir and write a flat images.json at out_json.

    URLs are written as "<section>/images/filename.ext"
    where <section> is the parent folder name of images_dir, e.g.
    "_Yodeck-HTML-Slideshow_Admin".
    """
    images_dir = os.path.normpath(images_dir)
    section = os.path.basename(os.path.dirname(images_dir))  # e.g. _Yodeck-HTML-Slideshow_Admin

    items = []

    for fname in sorted(os.listdir(images_dir)):
        full = os.path.join(images_dir, fname)
        if not os.path.isfile(full):
            continue

        _, ext = os.path.splitext(fname)
        if ext.lower() not in ALLOWED_EXTS:
            continue

        meta = parse_filename(fname)

        # Build URL relative to repo root
        url = f"{section}/images/{fname}"
        url = url.replace(os.sep, "/")

        item = {
            "url": url,
            "title": meta["title"],
        }

        # Start/end as ISO strings if present
        if meta["start"]:
            # Normalized to "YYYY-MM-DDT00:00:00"
            item["start"] = meta["start"] + "T00:00:00"
        if meta["end"]:
            item["end"] = meta["end"] + "T00:00:00"

        if meta["durationSeconds"] is not None:
            item["durationSeconds"] = meta["durationSeconds"]

        items.append(item)

    # Optional: sort by end date (soonest-expiring first), then start, then title
    def sort_key(it):
        def parse_date(s):
            if not s:
                return datetime.max
            try:
                return datetime.fromisoformat(s)
            except Exception:
                return datetime.max

        end = parse_date(it.get("end"))
        start = parse_date(it.get("start"))
        title = (it.get("title") or "").lower()
        return (end, start, title)

    items_sorted = sorted(items, key=sort_key)

    # Write JSON
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(items_sorted, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(items_sorted)} items to {out_json}")
    return True


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: gen_images_json.py <images_dir> <out_json>", file=sys.stderr)
        sys.exit(1)

    images_dir = sys.argv[1]
    out_json = sys.argv[2]
    changed = build_manifest(images_dir, out_json)
    sys.exit(0 if changed else 0)
