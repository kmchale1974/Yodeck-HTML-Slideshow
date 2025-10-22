mkdir -Force tools
@'
import re, os, json
from datetime import datetime
from zoneinfo import ZoneInfo

VALID_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
DEFAULT_DURATION = 8
CENTRAL = ZoneInfo("America/Chicago")

PATTERN = re.compile(
    r"^(?:(?P<start>\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2})?)_to_(?P<end>\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2})?)__)?"
    r"(?:(?P<dur>\d+)s__)?"
    r"(?:(?:o(?P<order>\d+)__)?)"
    r"(?P<title>.+?)\.(?P<ext>png|jpg|jpeg|webp|gif)$",
    re.IGNORECASE
)

def parse_dt(token):
    if not token: return None
    try:
        if "_" in token:
            return datetime.strptime(token, "%Y-%m-%d_%H-%M").replace(tzinfo=CENTRAL)
        return datetime.strptime(token, "%Y-%m-%d").replace(tzinfo=CENTRAL)
    except ValueError:
        return None

def human_title(name):
    t = os.path.splitext(name)[0].replace("_"," ").replace("-"," ")
    return " ".join(t.split())

def build_manifest(images_dir, out_path):
    files = []
    for root, _, fnames in os.walk(images_dir):
        for fn in fnames:
            _, ext = os.path.splitext(fn)
            if ext.lower() in VALID_EXT:
                rel = os.path.relpath(os.path.join(root, fn), start=os.getcwd()).replace("\\","/")
                files.append(rel)

    now = datetime.now(tz=CENTRAL)
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
            end_dt   = parse_dt(m.group("end"))
            duration = int(m.group("dur")) if m.group("dur") else duration
            order_val = int(m.group("order")) if m.group("order") else None
            title = human_title(m.group("title"))

        if end_dt and end_dt < now:
            continue

        url = rel.replace(images_dir + "/", "images/") if rel.startswith(images_dir + "/") else rel
        item = {"url": url, "title": title, "durationSeconds": duration}
        if start_dt: item["start"] = start_dt.strftime("%Y-%m-%dT%H:%M:%S")
        if end_dt:   item["end"]   = end_dt.strftime("%Y-%m-%dT%H:%M:%S")
        if order_val is not None: item["order"] = order_val

        sort_end = end_dt if end_dt else datetime.max.replace(tzinfo=CENTRAL)
        rows.append((sort_end, order_val if order_val is not None else float("inf"), title.lower(), item))

    rows.sort(key=lambda t:(t[0], t[1], t[2]))
    manifest = [t[3] for t in rows]

    old = None
    if os.path.exists(out_path):
        try:
            with open(out_path,"r",encoding="utf-8") as f: old = json.load(f)
        except Exception: old = None
    if old != manifest:
        with open(out_path,"w",encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        print(f"Wrote {out_path} with {len(manifest)} items")
        return True
    print(f"No changes for {out_path}")
    return False

if __name__ == "__main__":
    # local single-folder run (not used by CI directly)
    build_manifest("images", "images.json")
'@ | Set-Content -Encoding UTF8 tools\gen_images_json.py
