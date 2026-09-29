# Backaris

A cyberpunk-style local backup and file-activity dashboard.

## V0.2 — Live folder scanner

Backaris now scans real folders through a tiny local Flask backend. The scan is read-only: it records file paths, sizes and modification timestamps in a local SQLite database.

The first scan establishes a baseline. Later scans show files that are **new**, **modified**, or **deleted** compared with that baseline. For now the baseline is intentionally not advanced automatically after every scan; later a successful USB backup will advance it.

### Setup

```bash
git clone https://github.com/f-r-e-d-eth/Backaris.git
cd Backaris
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Edit `config.json` and enter the folders you want Backaris to watch.

Then run:

```bash
python3 backaris.py
```

Open **http://127.0.0.1:5003**.

### Current safety boundary

V0.2 does **not** copy, modify, delete or back up your source files. It only reads metadata and writes its own `backaris.db` database.

### Next

- Choose folders from the UI
- Record real backup timestamps
- Detect the backup USB
- Connect successful backups to the baseline
- Add historical activity statistics

> SAME FILES. NEW STORIES.
