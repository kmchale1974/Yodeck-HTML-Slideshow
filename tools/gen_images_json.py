import re, os, json
from datetime import datetime

VALID_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
DEFAULT_DURATION = 8

# Filename pattern:
#   <start>_to_<end>__<duration>s__o<order>__<title>.<ext>
# All parts except title+ext are optional.
PATTERN = re.compile(
    r"^(?:(?P<start>\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2})?)_to_(?P<end>\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2})?)__)?"
    r"(?:(?P<dur>\d+)s__)?"
    r"(?:(?:o(?P<order>\d+)__)?)"
    r"(?P<title>.+?)\.(?P<ext>png|jpg|jpeg|webp|gif)$",
    re.IGNORECASE
)

def parse_dt(token: str | None) -> datetime | None:
    """Parse 'YYYY-MM-DD' or 'YYYY-MM-DD_HH-MM' to a naive datetime."""
    if not token:
        return None
    try:
        if "_" in token:
            return datetime.strptime(token, "%Y-%m-%d_%H-%M")
        return datetime.strptime(token, "%Y-%m-%d")
    except ValueError:
        return None

def human_title(name: str) -> str:
    """Make a nice title from the filename part."""
    t = os.path.splitext(name)[0].replace("_", " ").replace("-", " ")
    return " ".join(t.split())

def build_manifest(images_dir: str, out_path: str) -> bool:
    """
    Scan images_dir, build a sorted manifest, and write to out_path.
    Returns True if the file changed.
    """
    # Ensure folder exists; treat missing as empty rather than crashing.
    if not os.path.isdir(images_dir):
        os.makedirs(images_dir, exist_ok=True)

    files: list[str] = []
    for root, _, fnames in os.walk(images_dir):
        for fn in fnames:
            _, ext = os.path.splitext(fn)
            if ext.lower() in VALID_EXT:
                rel = os.path.relpath(os.path.join(root, fn), start=os.getcwd()).replace("\\", "/")
                files.append(rel)

    now = datetime.now()  # naive local time on the runner
    rows = []

    for rel in sorted(files):
        name = os.path.basename(rel)
        m = PATTERN.match(name)

        start_dt = end_dt = None
        duration = DEFAULT_DURATION
        order_val = None
        title = human_title(os.path.splitext(name)[0])

        if m:
            start_dt = parse_dt(m.group("start"))
            end_dt = parse_dt(m.group("end"))
            if m.group("dur"):
                duration = int(m.group("dur"))
            if m.group("order"):
                order_val = int(m.group("order"))
            title = human_title(m.group("title"))

        # Skip expired slides
        if end_dt and end_dt < now:
            continue

        # Map repo path to manifest url (keep 'images/' prefix for client)
        if rel.startswith(images_dir + "/"):
            url = rel.replace(images_dir + "/", "images/")
        else:
            url = rel

        item = {
            "url": url,
            "title": title,
            "durationSeconds": duration,
        }
        if start_dt:
            item["start"] = start_dt.strftime("%Y-%m-%dT%H:%M:%S")
        if end_dt:
            item["end"] = end_dt.strftime("%Y-%m-%dT%H:%M:%S")
        if order_val is not None:
            item["order"] = order_val

        sort_end = end_dt if end_dt else datetime.max
        sort_order = order_val if order_val is not None else float("inf")
        rows.append((sort_end, sort_order, title.lower(), item))

    # Sort: soonest end date first, then explicit order, then title
    rows.sort(key=lambda t: (t[0], t[1], t[2]))
    manifest = [t[3] for t in rows]

    # Only write if content changed
    old = None
    if os.path.exists(out_path):
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                old = json.load(f)
        except Exception:
            old = None

    if old != manifest:
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        print(f"Wrote {out_path} with {len(manifest)} items")
        return True

    print(f"No changes for {out_path}")
    return False

if __name__ == "__main__":
    # Local test helper
    build_manifest("images", "images.json")
