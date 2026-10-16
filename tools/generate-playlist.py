#!/usr/bin/env python3
import json
import re
from datetime import datetime
from pathlib import Path

NAS_DIR = Path("/mnt/yodeck-admin")
OUTPUT = Path(__file__).resolve().parent.parent / "playlist.json"

DEFAULT_PRIORITY = 500
DEFAULT_DURATION = 10
DEFAULT_TRANSITION = {
    "mode": "slide",
    "direction": "right",
    "duration_ms": 1000
}

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".m4v"}

NAME_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})_to_"
    r"(\d{4}-\d{2}-\d{2}(?:T\d{2}-\d{2})?|FOREVER)_(.+)$",
    re.IGNORECASE
)

PRIORITY_RE = re.compile(r"__P(\d+)__", re.IGNORECASE)
DURATION_RE = re.compile(r"__(\d+)s__", re.IGNORECASE)
TRANSITION_RE = re.compile(
    r"__(fade|cut|slide|wipe)(?:-(left|right|up|down))?__",
    re.IGNORECASE
)

def build_playlist():
    items = []

    for path in NAS_DIR.iterdir():
        if not path.is_file():
            continue

        ext = path.suffix.lower()

        if ext not in IMAGE_EXTS | VIDEO_EXTS:
            continue

        match = NAME_RE.match(path.stem)

        if not match:
            print(f"Skipping invalid filename: {path.name}")
            continue

        start, end, title = match.groups()

        try:
            datetime.strptime(start, "%Y-%m-%d")
            if end.upper() != "FOREVER":
                if "T" in end.upper():
                    datetime.strptime(end.upper(), "%Y-%m-%dT%H-%M")
                else:
                    datetime.strptime(end, "%Y-%m-%d")
        except ValueError:
            print(f"Skipping invalid date: {path.name}")
            continue

        priority_match = PRIORITY_RE.search(title)
        duration_match = DURATION_RE.search(title)
        transition_match = TRANSITION_RE.search(title)

        priority = (
            int(priority_match.group(1))
            if priority_match else DEFAULT_PRIORITY
        )

        media_type = "video" if ext in VIDEO_EXTS else "image"

        duration = (
            None if media_type == "video"
            else int(duration_match.group(1))
            if duration_match else DEFAULT_DURATION
        )

        transition = None

        if transition_match:
            transition = {
                "mode": transition_match.group(1).lower()
            }

            if transition_match.group(2):
                transition["direction"] = transition_match.group(2).lower()
        stat = path.stat()

        items.append({
            "filename": path.name,
            "type": media_type,
            "priority": priority,
            "duration": duration,
            "transition": transition,
            "start": start,
            "end": (
                None if end.upper() == "FOREVER"
                else end[:11] + end[11:].replace("-", ":")
                if "T" in end.upper()
                else end
            ),
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(
                stat.st_mtime
            ).isoformat(timespec="seconds")
        })

    previous_order = {}

    if OUTPUT.exists():
        existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
        previous_order = {
            item["filename"]: index
            for index, item in enumerate(existing.get("items", []))
        }

    items.sort(key=lambda item: (
        item["priority"],
        item["end"] or "9999-12-31",
        previous_order.get(item["filename"], float("inf")),
        item["filename"].lower()
    ))
    playlist = {
        "generated": datetime.now().astimezone().isoformat(),
        "default_priority": DEFAULT_PRIORITY,
        "default_duration": DEFAULT_DURATION,
        "default_transition": DEFAULT_TRANSITION,
        "items": items
    }

    if OUTPUT.exists():
        existing = json.loads(OUTPUT.read_text(encoding="utf-8"))

        if (
            existing.get("default_priority") == DEFAULT_PRIORITY
            and existing.get("default_duration") == DEFAULT_DURATION
            and existing.get("default_transition") == DEFAULT_TRANSITION
            and existing.get("items") == items
        ):
            print("No media changes detected. Playlist unchanged.")
            return

    OUTPUT.write_text(
        json.dumps(playlist, indent=2),
        encoding="utf-8"
    )

    print(f"Generated test playlist with {len(items)} items.")


if __name__ == "__main__":
    build_playlist()
