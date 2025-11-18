import json
import os
from pathlib import Path
from datetime import datetime

VALID_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

def parse_filename(fname: str):
    """
    Expected patterns:
      1) start_to_end__Dur__Title.ext
         e.g. 2025-11-18_to_2026-01-24__12s__OHara-Woods-Workday.png
      2) start_to_end_Title.ext  (no explicit duration)
      3) just Title.ext          (no dates, no duration)
    Returns dict with optional start, end, durationSeconds, title.
    """
    stem, _ext = os.path.splitext(fname)
    parts = stem.split("__", 2)

    start = end = None
    duration = None
    title_part = None

    # Case 1: date range + duration + title
    if len(parts) == 3:
        daterange, dur_part, title_part = parts
        if "_to_" in daterange:
            s, e = daterange.split("_to_", 1)
            start = _safe_date(s)
            end = _safe_date(e)
        else:
            start = _safe_date(daterange)
        duration = _parse_duration(dur_part)
    # Case 2: maybe date range + title
    elif len(parts) == 2:
        daterange, title_part = parts
        if "_to_" in daterange:
            s, e = daterange.split("_to_", 1)
            start = _safe_date(s)
            end = _safe_date(e)
        else:
            start = _safe_date(daterange)
    else:
        # no "__" at all, treat whole stem as title
        title_part = stem

    title = (title_part or "").replace("-", " ").strip()
    result = {}
    if start:
        # ISO string for JS Date()
        result["start"] = start.isoformat()
    if end:
        # make end end-of-day if only date was given
        end_dt = datetime(end.year, end.month, end.day, 23, 59, 59)
        result["end"] = end_dt.isoformat()
    if duration is not None:
        result["durationSeconds"] = duration
    if title:
        result["title"] = title

    return result

def _safe_date(s: str):
    s = s.strip()
    if not s:
        return None
    try:
        # YYYY-MM-DD
        return datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None

def _parse_duration(s: str):
    """
    '12s' -> 12
    '8'   -> 8
    """
    s = s.strip().lower()
    if not s:
        return None
    if s.endswith("s"):
        s = s[:-1]
    try:
        val = int(s)
        if val <= 0:
            return None
        return val
    except ValueError:
        return None

def build_manifest(src_dir: str, out_path: str):
    """
    Scan src_dir and write a JSON array to out_path.
    URL is the relative path from repo root, e.g.
      '_Yodeck-HTML-Slideshow_Admin/images/<file>'
    """
    src_path = Path(src_dir)
    if not src_path.exists():
        print(f"[gen_images_json] Source does not exist: {src_dir}")
        return False

    rel_dir = src_path.as_posix()  # e.g. "_Yodeck-HTML-Slideshow_Admin/images"

    items = []
    for f in sorted(src_path.iterdir()):
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext not in VALID_EXTS:
            continue

        meta = parse_filename(f.name)
        item = {
            "url": f"{rel_dir}/{f.name}"
        }
        item.update(meta)
        items.append(item)

    # sort primarily by end date (soonest expiry first)
    def sort_key(it):
        end = it.get("end")
        if end:
            try:
                return datetime.fromisoformat(end)
            except Exception:
                pass
        return datetime.max

    items.sort(key=sort_key)

    out_file = Path(out_path)
    old = None
    if out_file.exists():
        try:
            old = json.loads(out_file.read_text(encoding="utf-8"))
        except Exception:
            old = None

    new_json = json.dumps(items, indent=2, ensure_ascii=False)
    if old is not None:
        old_json = json.dumps(old, indent=2, ensure_ascii=False)
        if old_json == new_json:
            print("[gen_images_json] No changes to manifest.")
            return False

    out_file.write_text(new_json, encoding="utf-8")
    print(f"[gen_images_json] Wrote {len(items)} items to {out_path}")
    return True

if __name__ == "__main__":
    # manual test
    build_manifest("_Yodeck-HTML-Slideshow_Admin/images", "images.json")
