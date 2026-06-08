"""
Manifest loader and search index builder.

Reads www/ directory at startup:
  - Loads manifest.json (if present) or scans .md files to build one on the fly.
  - Builds a simple keyword → paths inverted index for search_portfolio.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, TypedDict

# ── Types ────────────────────────────────────────────────────────────────────

class SearchResult(TypedDict):
    path: str
    title: str
    excerpt: str
    section: str
    score: float


class ManifestEntry(TypedDict):
    path: str
    title: str
    sections: List[str]
    excerpt: str
    hash: str


# ── Internal state ────────────────────────────────────────────────────────────

_entries: Dict[str, ManifestEntry] = {}   # path → entry
_contents: Dict[str, str] = {}            # path → full text
_loaded: bool = False
_www_root: Optional[Path] = None


# ── Initialisation ────────────────────────────────────────────────────────────

def _extract_title(content: str, filename: str) -> str:
    """Return first H1 heading or derive from filename."""
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return filename.replace("-", " ").replace("_", " ").replace(".md", "").title()


def _section_from_path(path: str) -> str:
    """Return top-level section for a path (e.g. 'experience/foo.md' → 'experience')."""
    parts = path.split("/")
    return parts[0] if len(parts) > 1 else ""


def load(www_dir: str = "www") -> None:
    """
    Load the manifest and build the search index.

    Tries to read *www_dir*/manifest.json first; falls back to scanning *.md files.
    Call this once at startup from main.py.
    """
    global _loaded, _www_root
    _www_root = Path(www_dir)
    _entries.clear()
    _contents.clear()

    manifest_path = _www_root / "manifest.json"
    if manifest_path.exists():
        _load_from_json(manifest_path)
    else:
        _scan_markdown(_www_root)

    _loaded = True


def _load_from_json(manifest_path: Path) -> None:
    with manifest_path.open(encoding="utf-8") as fh:
        data = json.load(fh)

    raw_entries = data if isinstance(data, list) else data.get("entries", [])
    for entry in raw_entries:
        path = entry["path"]
        _entries[path] = entry  # type: ignore[assignment]

        # Also load raw content if the file exists alongside the manifest
        if _www_root is not None:
            md_file = _www_root / path
            if md_file.exists():
                _contents[path] = md_file.read_text(encoding="utf-8")
            else:
                _contents[path] = entry.get("excerpt", "")


def _scan_markdown(root: Path, base: Optional[Path] = None) -> None:
    if base is None:
        base = root
    for child in sorted(root.iterdir()):
        if child.is_dir():
            _scan_markdown(child, base)
        elif child.suffix == ".md":
            rel = child.relative_to(base).as_posix()
            content = child.read_text(encoding="utf-8")
            title = _extract_title(content, child.stem)
            excerpt = content[:150].strip()
            section = _section_from_path(rel)
            entry: ManifestEntry = {
                "path": rel,
                "title": title,
                "sections": [section] if section else [],
                "excerpt": excerpt,
                "hash": "",
            }
            _entries[rel] = entry
            _contents[rel] = content


# ── Public API ────────────────────────────────────────────────────────────────

def get_manifest() -> List[ManifestEntry]:
    """Return all manifest entries."""
    return list(_entries.values())


def validate_path(path: str) -> bool:
    """True if *path* exists in the loaded manifest."""
    return path in _entries


def search(query: str) -> List[SearchResult]:
    """
    Simple keyword search over manifest content.

    Tokenises *query* and counts how many tokens appear in each document's
    title + content.  Returns results sorted by descending score.
    """
    tokens = set(re.findall(r"\w+", query.lower()))
    if not tokens:
        return []

    results: List[SearchResult] = []
    for path, entry in _entries.items():
        doc_text = (
            entry["title"].lower()
            + " "
            + _contents.get(path, entry.get("excerpt", "")).lower()
        )
        hits = sum(1 for t in tokens if t in doc_text)
        if hits == 0:
            continue

        score = round(hits / len(tokens), 4)
        section = entry.get("sections", [""])[0] if entry.get("sections") else ""
        results.append(
            SearchResult(
                path=path,
                title=entry["title"],
                excerpt=entry.get("excerpt", "")[:150],
                section=section,
                score=score,
            )
        )

    results.sort(key=lambda r: r["score"], reverse=True)
    return results
