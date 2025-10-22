import re, os, json, hashlib
from datetime import datetime
from zoneinfo import ZoneInfo

VALID_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
DEFAULT_DURATION = 8
CENTRAL = ZoneInfo("America/Chicago")

# Option B pattern
PATTERN = re.compile(
    r"^(?:(?P<start>\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2})?)_to_(?P<end>\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2})?)__)?"
    r"(?:(?P<dur>\d+)s__)?"
    r"(?:(?:o(?P<order>\d+)__)?)"
    r"(?P<title>.+?)\.(?P<ext>png|jpg|jpeg|webp|gif)$",
    re.IGNORECASE
)

def parse_dt(token: str | None):
    if not token:
        return None
    try:
        if "_" in token:
            return datetime.strptime(token, "%Y-%m-%d_%H-%M").replace(tzinfo=CENTRAL)
        return datetime.strptime(token, "%Y-%m-%d").replace(tzinfo=CENTRAL)
    except ValueError:
        return None

def human_title(name: str) -> str:
    t = os.path.splitext(name)[0]
    t = t.replace("_", " ").replace("-", " ")
    return " ".join(t.split())

def main():
    images_dir = os.environ.get("INPUT_IMAGES_DIR", "images")
    out_path = os.environ.get("INPUT_OUT_PATH", "images.json")

    files = []
    for root, _, fnames in os.walk(images_dir):
        for fn in fnames:
            _, ext = os.path.splitext(fn)
            if ext.lower() not in VALID_EXT:
                continue
            rel = os.path.relpath(os.path.join(root, fn), start=os.getcwd()).replace("\\", "/")
            files.append(rel)

    now = datetime.now(tz=CENTRAL)
    rows = []
    for rel in sorted(files):
        name = os.path.basename(rel)
        base, _ = os.path.splitext(name)
        m = PATTERN.match(name)
        start_dt = end_dt = None
        duration = DEFAULT_DURATION
        order_val = None
        title = human_title(base)
        if m:
            start_dt = parse_dt(m.group("start"))
            end_dt   = parse_dt(m.group("end"))
            duration = int(m.group("dur")) if m.group("dur") else duration
            order_val = int(m.group("order")) if m.group("order") else None
            title = human_title(m.group("title"))

        # Exclude expired
        if end_dt and end_dt < now:
            continue

        item = {
            "url": rel if rel.startswith("images/") else rel.replace(images_dir + "/", "images/"),
            "title": title,
            "durationSeconds": duration
        }
        if start_dt: item["start"] = start_dt.strftime("%Y-%m-%dT%H:%M:%S")
        if end_dt:   item["end"]   = end_dt.strftime("%Y-%m-%dT%H:%M:%S")
        if order_val is not None: item["order"] = order_val

        sort_end = end_dt if end_dt else datetime.max.replace(tzinfo=CENTRAL)
        rows.append((sort_end, order_val if order_val is not None else float("inf"), title.lower(), item))

    rows.sort(key=lambda t: (t[0], t[1], t[2]))
    manifest = [t[3] for t in rows]

    # Write only if changed
    old = None
    if os.path.exists(out_path):
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                old = json.load(f)
        except Exception:
            old = None

    changed = (old != manifest)
    if changed:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        print(f"Wrote {out_path} with {len(manifest)} items")
    else:
        print("No changes to images.json")

    with open(".imagesjson.changed", "w") as f:
        f.write("1" if changed else "0")

if __name__ == "__main__":
    main()
