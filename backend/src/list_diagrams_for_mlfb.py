"""
Produces the SET of applicable circuit-diagram references for a given
decoded MLFB + Z-code string - the core deliverable of the sheet-selection
stage, without attempting a rendered composite drawing.

Usage:
    python src/list_diagrams_for_mlfb.py "3AE5554-2AE40-7KN2-Z_D91+W69+F46+F38+E46+C25"
"""
import sys
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import decoder
import sheet_selector


def list_diagrams(raw_mlfb: str):
    result = decoder.decode(raw_mlfb)
    kb = decoder.KB
    selected, unresolved = sheet_selector.select_diagrams(result, kb)

    ordered = sorted(selected, key=lambda r: (int(r["blatt_no"]), r["reference_diagram"]))
    rows = []
    for r in ordered:
        rows.append({
            "blatt_no": r["blatt_no"],
            "topic": r["topic_name_en"],
            "reference_diagram": r["reference_diagram"],
            "condition_type": r["condition_type"],
            "condition": r.get("condition_expr") or r.get("release_slot") or ("always/default" if r["condition_type"] in ("always", "default") else ""),
        })

    return {
        "input_mlfb": raw_mlfb,
        "base_article": (result.get("primary_lookup") or {}).get("article_number"),
        "tier_kv": result.get("resolved_voltage_tier_kv"),
        "input_z_codes": result.get("all_input_codes", []),
        "decoder_warnings": result.get("warnings", []),
        "diagram_set": rows,
        "diagram_count": len(rows),
        "unresolved_topics": unresolved,
    }


def to_csv(report: dict, path: str):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["blatt_no", "topic", "reference_diagram", "condition_type", "condition"])
        w.writeheader()
        for row in report["diagram_set"]:
            w.writerow(row)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python src/list_diagrams_for_mlfb.py '<mlfb string>'")
        raise SystemExit(1)
    report = list_diagrams(sys.argv[1])
    print(json.dumps(report, indent=2, ensure_ascii=False))
