from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
import shutil
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
STATIC_DIR = PROJECT_ROOT / "static"
GENERATED_DIR = STATIC_DIR / "generated"
SOURCE_PDF = PROJECT_ROOT / "data" / "S_A7E_449_99009_031_0R_001.pdf"

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import crop_and_assemble_diagrams  # type: ignore


def _safe_token(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in value.upper())
    return cleaned.strip("_")[:80] or "MLFB"


def generate_diagram_pages(raw_mlfb: str) -> dict[str, Any]:
    if not SOURCE_PDF.exists():
        raise FileNotFoundError(
            f"Source PDF not found at {SOURCE_PDF}. Place S_A7E_449_99009_031_0R_001.pdf in /sion_mlfb_agent/data/."
        )

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    run_name = f"{_safe_token(raw_mlfb)}_{stamp}"
    run_dir = GENERATED_DIR / run_name
    run_dir.mkdir(parents=True, exist_ok=True)

    output_prefix = run_dir / "diagram"
    build_result = crop_and_assemble_diagrams.build(raw_mlfb, str(SOURCE_PDF), str(output_prefix))

    page_urls = []
    for page_path in build_result.get("output_pages", []):
        page_file = Path(page_path)
        if not page_file.exists():
            continue
        target = run_dir / page_file.name
        if page_file.resolve() != target.resolve():
            shutil.copy2(page_file, target)
        page_urls.append(f"/static/generated/{run_name}/{target.name}")

    return {
        "input_mlfb": raw_mlfb,
        "run_name": run_name,
        "output_pages": page_urls,
        "build_result": build_result,
    }
