#!/usr/bin/env python3
import os
import sys
import json
import re
from datetime import datetime

# Allowed extensions: images + video
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".m4v"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
ALLOWED_EXTS = IMAGE_EXTS | VIDEO_EXTS

# ---- Date/Time token parsing ----
#
# Supports:
#   2026-01-22
#   2026-01-22T09-30
#   2026-01-22T0930
#   2026-01-22T09_30
#
DT_TOKEN_RE = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})(?:T(?P<h>\d{2})(?:[-_]?)(?P<m>\d{2}))?$"
)

def normalize_dt_token(token: str):
    """
    Return ISO string "YYYY-MM-DDTHH:MM:SS" or None if token is falsy.
    If only date provided => HH:MM:SS = 00:00:00
    """
    if not token:
        return None

    m = DT_TOKEN_RE.match(token)
    if not m:
        return None

    date_part = m.group("date")
    h = m.group("h")
    mnt = m.group("m")

    if h is None or mnt is None:
        # date only
        return f"{date_part}T00:00:00"

    return f"{date_part}T{h}:{mnt}:00"


# Patterns we support:

# 1) 2026-01-01_to_2026-01-24__12s__Title.png
# 1b) 2026-01-01T09-30_to_2026-01-24T14-00__12s__Title.png
NAME_RE_WITH_DUR = re.compile(
    r"""
    ^
    (?P<start>[^_]+)
    _to_
    (?P<end>[^_]+)
    __?(?P<dur>\d+)[sS]?__?
    _?(?P<title>.+)
    \.(?P<ext>[^.]+)
    $
    """,
    re.X,
)

# 2) 2026-01-01_to_2026-01-24_Title.png
# 2b) 2026-01-01T09-30_to_2026-01-24T14-00_Title.png
NAME_RE_NO_DUR = re.compile(
    r"""
    ^
    (?P<start>[^_]+)
    _to_
    (?P<end>[^_]+)
    _(?P<title>.+)
    \.(?P<ext>[^.]+)
    $
    """,
    re.X,
)

# 3) __8s__Title.jpg (no date window)
NAME_RE_DUR_PREFIX = re.compile(
    r"""
    ^
    __(?P<dur>\d+)[sS]?__
    (?P<title>.+)
    \.(?P<ext>[^.]+)
    $
    """,
    re.X,
)


def parse_filename(fname: str):
    """
    Parse a filename into metadata:
      - start (ISO) optional
      - end (ISO) optional
      - durationSeconds optional
      - title (string)
    """
    base, ext = os.path.splitext(fname)

    meta = {
        "title": base.replace("_", " ").strip(),
        "start": None,
        "end": None,
        "durationSeconds": None,
    }

    m = NAME_RE_WITH_DUR.match(fname)
    if m:
        start_iso = normalize_dt_token(m.group("start"))
        end_iso = normalize_dt_token(m.group("end"))
        title = m.group("title").replace("_", " ").strip()

        # Only accept parsed datetimes; otherwise treat as unscheduled title
        if start_iso and end_iso:
            meta["start"] = start_iso
            meta["end"] = end_iso

        meta["title"] = title
        meta["durationSeconds"] = int(m.group("dur"))
        return meta

    m = NAME_RE_NO_DUR.match(fname)
    if m:
        start_iso = normalize_dt_token(m.group("start"))
        end_iso = normalize_dt_token(m.group("end"))
        title = m.group("title").replace("_", " ").strip()

        if start_iso and end_iso:
            meta["start"] = start_iso
            meta["end"] = end_iso

        meta["title"] = title
        return meta

    m = NAME_RE_DUR_PREFIX.match(fname)
    if m:
        meta["title"] = m.group("title").replace("_", " ").strip()
        meta["durationSeconds"] = int(m.group("dur"))
        return meta

    return meta


def build_manifest(images_dir: str, out_json: str):
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
        ext = ext.lower()
        if ext not in ALLOWED_EXTS:
            continue

        meta = parse_filename(fname)

        url = f"{section}/images/{fname}".replace(os.sep, "/")

        item = {
            "url": url,
            "title": meta["title"],
        }

        if meta["start"]:
            item["start"] = meta["start"]
        if meta["end"]:
            item["end"] = meta["end"]
        if meta["durationSeconds"] is not None:
            item["durationSeconds"] = meta["durationSeconds"]

        items.append(item)

    # Sort: no end first, then soonest end, then start, then title
    def sort_key(it):
        def parse_iso(s):
            if not s:
                return datetime.max
            try:
                return datetime.fromisoformat(s)
            except Exception:
                return datetime.max

        end = parse_iso(it.get("end"))
        start = parse_iso(it.get("start"))
        title = (it.get("title") or "").lower()
        return (end, start, title)

    items_sorted = sorted(items, key=sort_key)

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
    build_manifest(images_dir, out_json)
    sys.exit(0)
