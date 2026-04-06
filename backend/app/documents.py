from __future__ import annotations

from pathlib import Path


def extract_text_from_document(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        return "\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()

    if suffix == ".docx":
        from docx import Document

        document = Document(str(path))
        return "\n".join(paragraph.text for paragraph in document.paragraphs).strip()

    return path.read_text(encoding="utf-8")
