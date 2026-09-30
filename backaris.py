from __future__ import annotations

import json
import os
import sqlite3
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


def scan_tree(root):
    files = {}
    errors = []
    for current, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if not Path(current, d).is_symlink()]
        for name in names:
            path = Path(current, name)
            try:
                stat = path.stat()
                rel = str(path.relative_to(root))
                files[rel] = {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
            except (OSError, PermissionError) as exc:
                errors.append(f"{path}: {exc}")
    return files, errors


def folder_result(item, db):
    root = Path(item["path"]).expanduser().resolve()
    name = item.get("name") or root.name
    if not root.is_dir():
        return {
            "name": name, "path": str(root), "available": False,
            "error": "Folder not found", "file_count": 0, "total_size": 0,
            "new": 0, "modified": 0, "deleted": 0, "changes": []
        }

    current, errors = scan_tree(root)
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
    print("Backaris V0.3 -> http://127.0.0.1:5003")
    app.run(host="127.0.0.1", port=5003, debug=False)
