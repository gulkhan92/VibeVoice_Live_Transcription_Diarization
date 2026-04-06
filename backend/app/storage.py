from __future__ import annotations

from pathlib import Path
import uuid


GENERATED_DIR = Path("backend/generated")
UPLOADS_DIR = Path("backend/uploads")


def ensure_storage() -> None:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def unique_path(directory: Path, suffix: str) -> Path:
    ensure_storage()
    return directory / f"{uuid.uuid4().hex}{suffix}"
