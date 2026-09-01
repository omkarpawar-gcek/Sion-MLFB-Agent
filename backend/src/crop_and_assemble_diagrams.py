"""
v2: Extracts REAL diagram crops from the source PDF, auto-trims excess
whitespace above/below each crop, and assembles them into non-overlapping
side-by-side pages (dynamic row heights based on actual image content -
no fixed cell size that could clip or overlap taller diagrams).

Administrative full-page sheets (cover, table of contents, legend,
terminal diagrams, revision history) are kept as complete, uncropped
pages, each on its own row so they never overlap the circuit diagrams.
"""
import re
import sys
import json
import textwrap
from pathlib import Path

import pdfplumber
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageChops

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import decoder
import sheet_selector

REF_PATTERN = re.compile(r'^S_A7E_449_\d+_\d+$')
RES = 150
SCALE = RES / 72.0
TOP_MARGIN_PT = 140  # below the "Position:.../Order codes" header row, excludes it from crops


def _cluster_rows(refs, tol=25):
    rows = []
    for r in sorted(refs, key=lambda w: w["top"]):
        placed = False
        for row in rows:
            if abs(r["top"] - row["top_ref"]) <= tol:
                row["items"].append(r)
                placed = True
                break
        if not placed:
            rows.append({"top_ref": r["top"], "items": [r]})
    return rows


def _autotrim(img, pad=8, bg="white"):
    """Trim uniform background border, leaving a small padding."""
    bg_img = Image.new(img.mode, img.size, bg)
    diff = ImageChops.difference(img, bg_img)
    diff = ImageChops.add(diff, diff, 2.0, -20)  # ignore near-white noise
    bbox = diff.getbbox()
    if not bbox:
        return img
    left = max(bbox[0] - pad, 0)
    top = max(bbox[1] - pad, 0)
    right = min(bbox[2] + pad, img.width)
    bottom = min(bbox[3] + pad, img.height)
    return img.crop((left, top, right, bottom))


def extract_all_crops(pdf_path):
    crops = {}
    with pdfplumber.open(pdf_path) as pdf:
        for blatt in sorted({4, 5, 6, 7, 8, 9, 10}):
            page = pdf.pages[blatt - 1]
            words = page.extract_words()
            refs = [w for w in words if REF_PATTERN.match(w["text"])]
            if not refs:
                continue
            rows = _cluster_rows(refs)
            rows.sort(key=lambda row: row["top_ref"])

            im = page.to_image(resolution=RES)
            pil_img = im.original

            for row_idx, row in enumerate(rows):
                items = sorted(row["items"], key=lambda w: w["x0"])
                columns = []
                for r in items:
                    if columns and abs(r["x0"] - columns[-1]["x0"]) < 15:
                        columns[-1]["names"].append(r["text"])
                    else:
                        columns.append({"x0": r["x0"], "names": [r["text"]]})

                top_pt = TOP_MARGIN_PT if row_idx == 0 else rows[row_idx - 1]["top_ref"] + 20
                bottom_pt = (rows[row_idx + 1]["top_ref"] - 5) if row_idx + 1 < len(rows) else min(page.height - 25, row["top_ref"] + 20)

                xs = [c["x0"] for c in columns]
                for i, col in enumerate(columns):
                    left = 40 if i == 0 else (xs[i - 1] + xs[i]) / 2
                    right = (page.width - 20) if i == len(columns) - 1 else (xs[i] + xs[i + 1]) / 2
                    box = (left * SCALE, top_pt * SCALE, right * SCALE, bottom_pt * SCALE)
                    crop = pil_img.crop(box)
                    crop = _autotrim(crop)
                    for name in col["names"]:
                        crops[name] = crop
    return crops


def extract_admin_page(pdf_path, blatt_no):
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[blatt_no - 1]
        im = page.to_image(resolution=RES)
        return _autotrim(im.original, pad=15)


def _font(size, bold=False):
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", size)
    except Exception:
        return ImageFont.load_default()


def label_diagram(img, title, ref_label, target_width, max_body_height=560):
    """Scale to FIT WITHIN (target_width, max_body_height) - preserving aspect
    ratio - so very tall/narrow diagrams (some are 7:1 aspect) don't blow up
    row heights. The label header sits above the (possibly narrower) image,
    horizontally centered within a fixed-width column so columns still align."""
    scale = min(target_width / img.width, max_body_height / img.height)
    new_size = (max(1, int(img.width * scale)), max(1, int(img.height * scale)))
    img_resized = img.resize(new_size)

    header_h = 46
    canvas = Image.new("RGB", (target_width, new_size[1] + header_h), "white")
    draw = ImageDraw.Draw(canvas)
    title_font = _font(13, bold=True)
    ref_font = _font(9)

    def centered(text, y, font, fill="black"):
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        draw.text(((target_width - tw) / 2, y), text, font=font, fill=fill)

    lines = textwrap.wrap(title, max(18, target_width // 9))[:2]
    y = 3
    for line in lines:
        centered(line, y, title_font)
        y += 15
    centered(ref_label, y + 1, ref_font, fill="#0082c9")

    paste_x = (target_width - new_size[0]) // 2
    canvas.paste(img_resized, (paste_x, header_h))
    draw.rectangle([0, 0, target_width - 1, canvas.height - 1], outline="#cccccc", width=1)
    return canvas


def assemble_pages(circuit_items, admin_items, output_prefix, page_width=1600,
                    circuit_cols=4, circuit_cell_width=340, admin_cols=2, max_page_height=2600):
    """Lay out diagrams with dynamically-sized rows so nothing overlaps:
    - admin/full-page items are grouped `admin_cols` per row (still uncropped,
      just scaled down together so they don't each eat a full page)
    - circuit diagram crops are grouped side-by-side, `circuit_cols` per row,
      row height = tallest image in that row (no fixed cell height)."""
    margin = 20
    gap = 14

    admin_cell_width = (page_width - 2 * margin - gap * (admin_cols - 1)) // admin_cols
    admin_labeled = [label_diagram(img, title, ref, admin_cell_width) for title, ref, img in admin_items]
    circuit_labeled = [label_diagram(img, title, ref, circuit_cell_width) for title, ref, img in circuit_items]

    admin_rows = [admin_labeled[i:i + admin_cols] for i in range(0, len(admin_labeled), admin_cols)]
    circuit_rows = [circuit_labeled[i:i + circuit_cols] for i in range(0, len(circuit_labeled), circuit_cols)]

    # Fixed, predictable pagination: page 1 = all admin/full-page sheets,
    # page 2(+) = all circuit diagrams (split further only if there are a
    # lot of circuit rows) - each page is exactly as tall as its content
    # needs, no artificial height cap that could force excess pagination.
    pages_rows = []
    if admin_rows:
        pages_rows.append(admin_rows)
    MAX_CIRCUIT_ROWS_PER_PAGE = 6
    for i in range(0, len(circuit_rows), MAX_CIRCUIT_ROWS_PER_PAGE):
        pages_rows.append(circuit_rows[i:i + MAX_CIRCUIT_ROWS_PER_PAGE])

    outputs = []
    for p_idx, page_rows in enumerate(pages_rows, start=1):
        page_h = margin + sum(max(img.height for img in row) + gap for row in page_rows) + margin
        page_img = Image.new("RGB", (page_width, int(page_h)), "white")
        y = margin
        for row in page_rows:
            row_h = max(img.height for img in row)
            if len(row) == 1 and row[0].width >= page_width - 2 * margin - 10:
                x = margin
                page_img.paste(row[0], (x, y))
            else:
                total_w = sum(img.width for img in row) + gap * (len(row) - 1)
                x = max(margin, (page_width - total_w) // 2)
                for img in row:
                    page_img.paste(img, (x, y))
                    x += img.width + gap
            y += row_h + gap
        out_path = f"{output_prefix}_page{p_idx}.png"
        page_img.save(out_path)
        outputs.append(out_path)
    return outputs


def build(raw_mlfb, pdf_path, output_prefix):
    result = decoder.decode(raw_mlfb)
    kb = decoder.KB
    selected, unresolved = sheet_selector.select_diagrams(result, kb)
    ordered = sorted(selected, key=lambda r: (int(r["blatt_no"]), r["reference_diagram"]))

    crops = extract_all_crops(pdf_path)

    circuit_items, admin_items = [], []
    for row in ordered:
        ref = row["reference_diagram"]
        topic = row["topic_name_en"]
        blatt = int(row["blatt_no"])
        if ref in crops:
            circuit_items.append((topic, ref, crops[ref]))
        elif ref.startswith("S_A7E_449_99009_031_0R"):
            page_img = extract_admin_page(pdf_path, blatt)
            admin_items.append((topic, f"Blatt {blatt}", page_img))

    pages = assemble_pages(circuit_items, admin_items, output_prefix)
    return {
        "input_mlfb": raw_mlfb,
        "circuit_diagram_count": len(circuit_items),
        "admin_page_count": len(admin_items),
        "unmatched_count": len(ordered) - len(circuit_items) - len(admin_items),
        "output_pages": pages,
    }


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python src/crop_and_assemble_diagrams.py '<mlfb>' <pdf_path> <output_prefix>")
        raise SystemExit(1)
    result = build(sys.argv[1], sys.argv[2], sys.argv[3])
    print(json.dumps(result, indent=2))
