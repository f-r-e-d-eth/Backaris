from __future__ import annotations

import fnmatch
import json
import os
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "backaris.db"
CONFIG_PATH = BASE_DIR / "config.json"

app = Flask(__name__, static_folder=None)


def now_text():
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")


def format_size(size):
    value = float(size)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.0f} {unit}" if unit in ("B", "KB") else f"{value:.1f} {unit}"
        value /= 1024


def load_config():
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps({
            "folders": [
                {"name": "Documents", "path": "~/Documents"},
                {"name": "Pictures", "path": "~/Pictures"},
                {"name": "Projects", "path": "~/Projects"}
            ]
        }, indent=2), encoding="utf-8")
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("""
        CREATE TABLE IF NOT EXISTS files (
            folder_path TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            size INTEGER NOT NULL,
            mtime_ns INTEGER NOT NULL,
            PRIMARY KEY(folder_path, relative_path)
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS folders (
            folder_path TEXT PRIMARY KEY,
            last_scan TEXT NOT NULL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS daily_stats (
            day TEXT NOT NULL,
            folder_path TEXT NOT NULL,
            file_count INTEGER NOT NULL,
            total_size INTEGER NOT NULL,
            new_count INTEGER NOT NULL,
            modified_count INTEGER NOT NULL,
            deleted_count INTEGER NOT NULL,
            collected_at TEXT NOT NULL,
            PRIMARY KEY(day, folder_path)
        )
    """)
    return db


def _read_ignore_file(path):
    """Return (ignore_whole_folder, patterns) for one .BackarisIgnore file."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError):
        return False, []

    meaningful = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    # A truly empty file (or one containing comments/whitespace only) hides the tree.
    return len(meaningful) == 0, meaningful


def _matches_ignore(relative_from_rule_dir, name, patterns):
    rel = relative_from_rule_dir.as_posix()
    for pattern in patterns:
        pattern = pattern.replace("\\", "/").strip().rstrip("/")
        if not pattern:
            continue
        # Patterns containing a slash match a path below the ignore file.
        # Simple patterns match a file/folder name anywhere below it.
        if "/" in pattern:
            if fnmatch.fnmatch(rel, pattern) or rel == pattern or rel.startswith(pattern + "/"):
                return True
        elif fnmatch.fnmatch(name, pattern):
            return True
    return False


def _count_tree(path):
    """Best-effort count/size used only for the 'ignored' statistics."""
    count = 0
    size = 0
    if path.is_file():
        try:
            return 1, path.stat().st_size
        except OSError:
            return 0, 0
    for current, dirs, names in os.walk(path, followlinks=False):
        dirs[:] = [d for d in dirs if not Path(current, d).is_symlink()]
        for name in names:
            p = Path(current, name)
            try:
                size += p.stat().st_size
                count += 1
            except OSError:
                pass
    return count, size


def detect_usb_drives():
    """Return mounted removable/USB filesystems on Linux. Read-only detection."""
    try:
        proc = subprocess.run(
            ["lsblk", "-J", "-b", "-o", "NAME,PATH,TYPE,TRAN,RM,LABEL,UUID,FSTYPE,MOUNTPOINT,SIZE"],
            capture_output=True, text=True, timeout=5, check=True
        )
        data = json.loads(proc.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        return [], str(exc)

    drives = []

    def walk(node, inherited_usb=False):
        is_usb = inherited_usb or node.get("tran") == "usb" or bool(node.get("rm"))
        mount = node.get("mountpoint")
        if is_usb and mount and node.get("type") in ("part", "disk"):
            try:
                usage = os.statvfs(mount)
                free = usage.f_bavail * usage.f_frsize
                capacity = usage.f_blocks * usage.f_frsize
            except OSError:
                free = None
                capacity = node.get("size")
            drives.append({
                "name": node.get("name"),
                "path": node.get("path"),
                "label": node.get("label") or node.get("name") or "USB drive",
                "uuid": node.get("uuid"),
                "filesystem": node.get("fstype"),
                "mountpoint": mount,
                "capacity": capacity,
                "capacity_text": format_size(capacity) if capacity is not None else None,
                "free": free,
                "free_text": format_size(free) if free is not None else None,
            })
        for child in node.get("children") or []:
            walk(child, is_usb)

    for device in data.get("blockdevices", []):
        walk(device)
    return drives, None


def scan_tree(root):
    files = {}
    errors = []
    ignored_files = 0
    ignored_bytes = 0
    # Each entry is (directory containing .BackarisIgnore, patterns).
    active_rules = []

    for current, dirs, names in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)

        # Keep only rules inherited by this directory.
        active_rules = [
            (base, patterns) for base, patterns in active_rules
            if current_path == base or base in current_path.parents
        ]

        ignore_file = current_path / ".BackarisIgnore"
        if ignore_file.is_file():
            ignore_whole, patterns = _read_ignore_file(ignore_file)
            if ignore_whole:
                # The marker itself is configuration, not backup data.
                for child in current_path.iterdir():
                    if child.name == ".BackarisIgnore":
                        continue
                    c, s = _count_tree(child)
                    ignored_files += c
                    ignored_bytes += s
                dirs[:] = []
                continue
            active_rules.append((current_path, patterns))

        kept_dirs = []
        for dirname in dirs:
            path = current_path / dirname
            if path.is_symlink():
                continue
            ignored = any(
                _matches_ignore(path.relative_to(base), dirname, patterns)
                for base, patterns in active_rules
                if path == base or base in path.parents
            )
            if ignored:
                c, s = _count_tree(path)
                ignored_files += c
                ignored_bytes += s
            else:
                kept_dirs.append(dirname)
        dirs[:] = kept_dirs

        for name in names:
            if name == ".BackarisIgnore":
                continue
            path = current_path / name
            try:
                ignored = any(
                    _matches_ignore(path.relative_to(base), name, patterns)
                    for base, patterns in active_rules
                    if path == base or base in path.parents
                )
                if ignored:
                    stat = path.stat()
                    ignored_files += 1
                    ignored_bytes += stat.st_size
                    continue

                stat = path.stat()
                rel = str(path.relative_to(root))
                files[rel] = {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
            except (OSError, PermissionError, ValueError) as exc:
                errors.append(f"{path}: {exc}")

    return files, errors, ignored_files, ignored_bytes

def folder_result(item, db):
    root = Path(item["path"]).expanduser().resolve()
    name = item.get("name") or root.name
    if not root.is_dir():
        return {
            "name": name, "path": str(root), "available": False,
            "error": "Folder not found", "file_count": 0, "total_size": 0,
            "new": 0, "modified": 0, "deleted": 0, "changes": []
        }

    current, errors, ignored_files, ignored_bytes = scan_tree(root)
    previous_rows = db.execute(
        "SELECT relative_path, size, mtime_ns FROM files WHERE folder_path=?",
        (str(root),)
    ).fetchall()
    previous = {r["relative_path"]: {"size": r["size"], "mtime_ns": r["mtime_ns"]} for r in previous_rows}
    has_baseline = bool(previous_rows) or db.execute(
        "SELECT 1 FROM folders WHERE folder_path=?", (str(root),)
    ).fetchone() is not None

    changes = []
    if has_baseline:
        for rel, meta in current.items():
            if rel not in previous:
                changes.append({"type": "new", "path": rel, "size": meta["size"]})
            elif meta != previous[rel]:
                changes.append({"type": "modified", "path": rel, "size": meta["size"]})
        for rel, meta in previous.items():
            if rel not in current:
                changes.append({"type": "deleted", "path": rel, "size": meta["size"]})

    counts = {kind: sum(c["type"] == kind for c in changes) for kind in ("new", "modified", "deleted")}
    return {
        "name": name,
        "path": str(root),
        "available": True,
        "file_count": len(current),
        "total_size": sum(v["size"] for v in current.values()),
        "total_size_text": format_size(sum(v["size"] for v in current.values())),
        "new": counts["new"],
        "modified": counts["modified"],
        "deleted": counts["deleted"],
        "changed": len(changes),
        "baseline": has_baseline,
        "changes": sorted(changes, key=lambda x: x["path"].lower())[:500],
        "errors": errors[:20],
        "ignored_files": ignored_files,
        "ignored_bytes": ignored_bytes,
        "ignored_size_text": format_size(ignored_bytes),
        "_files": current,
    }


def collect_daily_stat(result, db):
    """Keep one statistics sample per folder and calendar day."""
    if not result.get("available"):
        return
    day = datetime.now().astimezone().strftime("%Y-%m-%d")
    db.execute("""
        INSERT INTO daily_stats(
            day, folder_path, file_count, total_size,
            new_count, modified_count, deleted_count, collected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day, folder_path) DO UPDATE SET
            file_count=excluded.file_count,
            total_size=excluded.total_size,
            new_count=excluded.new_count,
            modified_count=excluded.modified_count,
            deleted_count=excluded.deleted_count,
            collected_at=excluded.collected_at
    """, (
        day, result["path"], result["file_count"], result["total_size"],
        result["new"], result["modified"], result["deleted"], now_text()
    ))


def history_for(folder_path, db, days=30):
    rows = db.execute("""
        SELECT day, file_count, total_size, new_count, modified_count, deleted_count
        FROM daily_stats
        WHERE folder_path=?
        ORDER BY day DESC
        LIMIT ?
    """, (folder_path, days)).fetchall()
    return [dict(row) for row in reversed(rows)]


def save_baseline(result, db):
    root = result["path"]
    db.execute("DELETE FROM files WHERE folder_path=?", (root,))
    db.executemany(
        "INSERT INTO files(folder_path, relative_path, size, mtime_ns) VALUES (?, ?, ?, ?)",
        [(root, rel, meta["size"], meta["mtime_ns"]) for rel, meta in result["_files"].items()]
    )
    db.execute(
        "INSERT INTO folders(folder_path,last_scan) VALUES(?,?) "
        "ON CONFLICT(folder_path) DO UPDATE SET last_scan=excluded.last_scan",
        (root, now_text())
    )


@app.get("/api/usb")
def usb_status():
    drives, error = detect_usb_drives()
    return jsonify({"drives": drives, "error": error, "time": now_text()})



@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(BASE_DIR, path)


@app.get("/api/status")
def status():
    config = load_config()
    with connect() as db:
        results = [folder_result(item, db) for item in config.get("folders", [])]
        for result in results:
            result["history"] = history_for(result["path"], db)
            result.pop("_files", None)
        return jsonify({"folders": results, "scan_time": now_text()})


@app.post("/api/scan")
def scan():
    config = load_config()
    with connect() as db:
        results = [folder_result(item, db) for item in config.get("folders", [])]
        for result in results:
            if result["available"] and not result["baseline"]:
                save_baseline(result, db)
            collect_daily_stat(result, db)
        db.commit()
        public = []
        for result in results:
            result["history"] = history_for(result["path"], db)
            result.pop("_files", None)
            public.append(result)
        return jsonify({"folders": public, "scan_time": now_text()})


@app.post("/api/baseline")
def baseline():
    config = load_config()
    with connect() as db:
        results = [folder_result(item, db) for item in config.get("folders", [])]
        for result in results:
            if result["available"]:
                save_baseline(result, db)
        db.commit()
    return jsonify({"ok": True, "time": now_text()})


if __name__ == "__main__":
    load_config()
    print("Backaris V0.5 -> http://127.0.0.1:5003")
    app.run(host="127.0.0.1", port=5003, debug=False)
