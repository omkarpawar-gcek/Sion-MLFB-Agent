"""
PIL-based schematic renderer for the SION 3AE5 breaker wiring diagram.

Replaces the matplotlib-based renderer, which hit a persistent, hard-to-
isolate rendering error in this environment when drawing many figures
in sequence (confirmed NOT to be a bug in the diagram logic itself -
tracebacks pointed to pure-numeric code that cannot raise a str/list
TypeError, indicating the failure was inside matplotlib's own text/font
layout internals). PIL's ImageDraw is a much simpler, predictable text
and line renderer with no equivalent layout-engine complexity.
"""
import json
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEFINITIONS_JSON = ROOT / "data" / "circuit_diagram_definitions.json"

W, H = 320, 420
MARGIN = 12


def load_definitions():
    with DEFINITIONS_JSON.open(encoding="utf-8") as f:
        rows = json.load(f)
    return {r["reference_diagram"]: r for r in rows}


def _font(size, bold=False):
    try:
        name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
        return ImageFont.truetype(name, size)
    except Exception:
        return ImageFont.load_default()


def _element_label(el):
    if "terminal" in el:
        pin = el.get("pin", "")
        return f"{el['terminal']}{':' + pin if pin else ''}"
    if "component" in el:
        pins = el.get("pins", "")
        return f"[{el['component']}]" + (f" ({pins})" if pins else "")
    if "connector" in el:
        return f"[{el['connector']}]"
    if "wire_color" in el:
        return f"({el['wire_color']} wire)"
    return str(el)


def _draw_centered(draw, text, y, font, fill="black"):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) / 2, y), text, font=font, fill=fill)


def render_diagram_image(diagram_def, output_path):
    """Render one diagram definition to a standalone PNG file using PIL."""
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    name = diagram_def["name_en"] or diagram_def["name_de"]
    ref = diagram_def["reference_diagram"]
    cond = diagram_def["condition"]
    diagram = diagram_def["diagram"]
    conf = diagram.get("confidence", "n/a")

    title_font = _font(13, bold=True)
    cond_font = _font(11)
    label_font = _font(10)
    small_font = _font(9)

    y = MARGIN
    for line in textwrap.wrap(name, 34)[:2]:
        _draw_centered(draw, line, y, title_font)
        y += 17

    y += 4
    cond_text = cond.get("expr") or ("always" if cond["type"] == "always" else "default")
    _draw_centered(draw, f"[{cond_text}]", y, cond_font, fill="#0082c9")
    y += 22

    body_top = y + 10
    body_bottom = H - 40
    elements = diagram.get("elements", [])

    if diagram.get("type") in ("series_circuit", "ladder_circuit"):
        n = max(len(elements), 1)
        cx = W // 2
        draw.line([(cx, body_top), (cx, body_bottom)], fill="black", width=2)
        step = (body_bottom - body_top) / max(n - 1, 1)
        for i, el in enumerate(elements):
            ny = body_top + i * step
            label = _element_label(el)
            is_component = "component" in el
            r = 5 if is_component else 3
            color = "#c0392b" if is_component else "black"
            if is_component:
                draw.rectangle([cx - r, ny - r, cx + r, ny + r], outline=color, fill="white", width=2)
            else:
                draw.ellipse([cx - r, ny - r, cx + r, ny + r], outline=color, fill="white", width=1)
            draw.text((cx + 10, ny - 6), label, font=label_font, fill="black")
    else:
        ny = body_top
        line_step = max((body_bottom - body_top) / max(len(elements), 1), 18)
        for e in elements:
            label = str(_element_label(e))
            _draw_centered(draw, label, ny, label_font)
            ny += 14
            note = e.get("note") if isinstance(e, dict) else None
            if note:
                for line in textwrap.wrap(str(note), 40):
                    _draw_centered(draw, line, ny, small_font, fill="#555555")
                    ny += 12
            ny += line_step - 14

    footer = f"{ref}\n(conf: {conf})"
    fy = H - 30
    for line in footer.split("\n"):
        _draw_centered(draw, line, fy, small_font, fill="#555555")
        fy += 12

    img.save(output_path)
    return output_path
