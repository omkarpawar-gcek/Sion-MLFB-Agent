"""
Full MLFB decode + diagram-set report generator (PIL-based rendering).

For diagrams with a structured circuit_diagram_definitions.json entry, a
standalone rendered schematic is produced via diagram_renderer_pil. For the
"always" administrative sheets that only reference a Blatt number of the
source PDF (cover sheet, table of contents, legend, terminal diagrams,
revision history), the ACTUAL page image is extracted directly from
S_A7E_449_99009_031_0R_001.pdf.

Usage:
    python src/generate_mlfb_report.py "<mlfb string>" <output_dir> [source_pdf_path]
"""
import sys
import re
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import decoder
import sheet_selector
import diagram_renderer_pil as diagram_renderer


def _safe_filename(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", s).strip("_")


def extract_pdf_page_image(pdf_path, blatt_no, output_path, resolution=150):
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[int(blatt_no) - 1]  # Blatt N == PDF page N in this document
        im = page.to_image(resolution=resolution)
        im.save(output_path)


def generate(raw_mlfb: str, output_dir: str, source_pdf_path: str = None):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    result = decoder.decode(raw_mlfb)
    kb = decoder.KB
    selected, unresolved = sheet_selector.select_diagrams(result, kb)
    definitions_by_ref = diagram_renderer.load_definitions()

    ordered = sorted(selected, key=lambda r: (int(r["blatt_no"]), r["reference_diagram"]))
    manifest = []

    for idx, row in enumerate(ordered, start=1):
        ref = row["reference_diagram"]
        blatt = row["blatt_no"]
        topic = row["topic_name_en"]
        ddef = definitions_by_ref.get(ref)

        fname_base = f"{idx:02d}_Blatt{blatt}_{_safe_filename(topic)}"
        entry = {"blatt_no": blatt, "topic": topic, "reference_diagram": ref, "file": None, "source": None}

        if ddef is not None:
            fname = output_dir / f"{fname_base}.png"
            try:
                diagram_renderer.render_diagram_image(ddef, fname)
                entry["file"] = str(fname)
                entry["source"] = "rendered_from_definition"
            except Exception as exc:
                entry["source"] = f"render_failed: {exc}"
        elif row["condition_type"] in ("always", "reference_only") and source_pdf_path:
            fname = output_dir / f"{fname_base}.png"
            try:
                extract_pdf_page_image(source_pdf_path, blatt, fname)
                entry["file"] = str(fname)
                entry["source"] = "extracted_pdf_page"
            except Exception as exc:
                entry["source"] = f"extraction_failed: {exc}"
        manifest.append(entry)

    return {
        "input_mlfb": raw_mlfb,
        "base_article": (result.get("primary_lookup") or {}).get("article_number"),
        "tier_kv": result.get("resolved_voltage_tier_kv"),
        "decode_result": result,
        "diagram_manifest": manifest,
        "unresolved_topics": unresolved,
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python src/generate_mlfb_report.py '<mlfb string>' <output_dir> [source_pdf_path]")
        raise SystemExit(1)
    pdf_path = sys.argv[3] if len(sys.argv) > 3 else None
    report = generate(sys.argv[1], sys.argv[2], pdf_path)
    print(json.dumps({k: v for k, v in report.items() if k != "decode_result"}, indent=2, ensure_ascii=False))
