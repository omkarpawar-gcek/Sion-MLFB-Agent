from __future__ import annotations

from pathlib import Path
from typing import Any
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import decoder  # type: ignore
import sheet_selector  # type: ignore


def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "topic_id": row.get("topic_id"),
        "topic_name_en": row.get("topic_name_en"),
        "blatt_no": row.get("blatt_no"),
        "reference_diagram": row.get("reference_diagram"),
        "condition_type": row.get("condition_type"),
        "condition_expr": row.get("condition_expr"),
        "release_slot": row.get("release_slot"),
        "is_default": row.get("is_default"),
    }


def decode_mlfb(raw_mlfb: str) -> dict[str, Any]:
    result = decoder.decode(raw_mlfb)
    selected_rows, unresolved_topics = sheet_selector.select_diagrams(result, decoder.KB)
    selected_rows = sorted(
        selected_rows,
        key=lambda row: (int(row.get("blatt_no") or 999), row.get("reference_diagram") or ""),
    )

    return {
        "input_mlfb": raw_mlfb,
        "decoded_result": result,
        "selected_diagrams": [_serialize_row(row) for row in selected_rows],
        "unresolved_topics": unresolved_topics,
        "summary": {
            "selected_diagram_count": len(selected_rows),
            "warning_count": len(result.get("warnings", [])),
            "order_code_count": len(result.get("order_codes", [])),
        },
    }
