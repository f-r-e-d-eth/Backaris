# .BackarisIgnore

Backaris supports a deliberately small ignore format.

## Ignore an entire folder

Place an empty file named:

```
.BackarisIgnore
```

inside the folder. That folder's contents and all subfolders are excluded from scanning and, later, backup.

A file containing only blank lines or comments is also treated as empty.

## Ignore selected content

Add one pattern per line:

```
# development clutter
*.tmp
*.log
.venv
__pycache__
cache
screenshots/raw
```

Simple names/patterns such as `.venv` or `*.tmp` apply below the directory containing the ignore file. Patterns containing `/` are relative to that directory.

Lines beginning with `#` are comments.

## Notes

- `.BackarisIgnore` itself is not counted or backed up.
- Symbolic-link directories are not followed.
- The scanner reports ignored file count and ignored byte size separately.
- This is intentionally not a full implementation of Git's `.gitignore` syntax.
