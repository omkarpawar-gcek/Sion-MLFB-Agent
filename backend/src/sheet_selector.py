"""
Sheet-selection lookup for the SION 3AE5 wiring diagram assembly stage.

Given a decoded MLFB result from decoder.py, this module selects the correct
reference circuit-diagram macro number for every functional topic (motor
charging, closing circuit, releases, signals, auxiliary switch, drawout
element, earth switch, etc.), using the master dataset built from
S_A7E_449_99009_031_0R_001.pdf's table of contents (Blatt 2) and body-text
footnotes.

Two condition styles are supported per row:
  - z_code_expr: a Python-boolean-style expression over Z-code names
    (e.g. "S71 and J60", "(A29 or A30) and not A47"). Evaluated safely
    against the set of decoded Z-codes.
  - position9_derived: resolved by cross-referencing the KB's
    position_codes.9.release_combination_table against the decoded
    position-9 value (and whether M04/M05 select the motorized racking
    variant is irrelevant here - this is about release type only).

Rows with is_default=TRUE are the fallback when no more specific
condition matches within the same topic_id. Rows with condition_type
"always" are unconditionally included.
"""
import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MASTER_CSV = ROOT / "data" / "diagram_sheet_selection_master.csv"


def load_master():
    with MASTER_CSV.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _eval_condition_expr(expr: str, codes: set) -> bool:
    """Safely evaluate a boolean expression like '(A29 or A30) and not A47'
    against the set of decoded Z-codes, without using eval() on arbitrary
    input from outside this project's own CSV."""
    tokens = set(re.findall(r"[A-Za-z0-9_]+", expr))
    keywords = {"and", "or", "not"}
    names = tokens - keywords
    safe_locals = {name: (name in codes) for name in names}
    # Build a restricted expression using only 'and'/'or'/'not'/parentheses/names
    try:
        return bool(eval(expr, {"__builtins__": {}}, safe_locals))
    except Exception as e:
        raise ValueError(f"Could not evaluate condition_expr {expr!r}: {e}")


def _release_flags_for_position9(kb: dict, position9_value: str) -> dict:
    """Look up the decoded position-9 letter's row(s) in the verified
    release_combination_table and derive simple boolean flags describing
    which release slots are present and of what type. If a letter maps to
    multiple table rows (e.g. B, T, U, V families), the flags are the union
    across all matching rows (conservative: include the macro if ANY
    matching row would need it)."""
    table = kb["position_codes"]["9"]["release_combination_table"]
    matches = [row for row in table if row["position9"] == position9_value]
    flags = {
        "release_2_is_shunt": False,
        "release_2_is_ct": False,
        "release_3_is_shunt": False,
        "release_3_is_ct": False,
        "release_low_energy_ct": False,
        "any_release_is_undervoltage": False,
    }
    for row in matches:
        r2 = (row.get("release_2") or "")
        r3 = (row.get("release_3") or "")
        if "Shunt" in r2:
            flags["release_2_is_shunt"] = True
        if "C.t.-operated" in r2:
            flags["release_2_is_ct"] = True
        if "Shunt" in r3:
            flags["release_3_is_shunt"] = True
        if "C.t.-operated" in r3:
            flags["release_3_is_ct"] = True
        if "Undervoltage" in r2 or "Undervoltage" in r3:
            flags["any_release_is_undervoltage"] = True
    return flags


def select_diagrams(decode_result: dict, kb: dict, extra_flags: dict = None):
    """
    decode_result: the dict returned by decoder.decode(raw_mlfb_string)
    kb: the loaded sion_3ae5_knowledge.json dict (for release_combination_table lookups)
    extra_flags: optional dict of synthetic flags not derivable from decode_result
                 alone, e.g. {"MLFB_POS14_A": True} when position 14 == "A"
                 (used for the "no motor" variant note).

    Returns (selected_rows, unresolved_topics):
      selected_rows: list of master-CSV row dicts, one per applicable topic/condition
      unresolved_topics: list of topic_ids where no condition matched and there
                         was no default/always row to fall back to (should be empty
                         if the dataset is complete).
    """
    rows = load_master()
    # Use ALL input codes (known or not), not just the ones with a KB description -
    # wiring-diagram conditions like S71/S73 are real codes not yet in the main
    # catalog's z_codes list, and must still be matchable here.
    codes = set(decode_result.get("all_input_codes", []))
    if not codes:
        for oc in decode_result.get("order_codes", []):
            codes.add(oc["code"])

    extra_flags = extra_flags or {}
    position9_value = decode_result.get("positions", {}).get("9")
    release_flags = _release_flags_for_position9(kb, position9_value) if position9_value else {}

    from collections import defaultdict
    by_topic = defaultdict(list)
    for r in rows:
        by_topic[r["topic_id"]].append(r)

    selected = []
    unresolved_topics = []

    for topic_id, topic_rows in by_topic.items():
        always_rows = [r for r in topic_rows if r["condition_type"] == "always"]
        selected.extend(always_rows)

        candidate_rows = [r for r in topic_rows if r["condition_type"] not in ("always", "reference_only")]
        if not candidate_rows:
            selected.extend(r for r in topic_rows if r["condition_type"] == "reference_only")
            continue

        matched = []
        for r in candidate_rows:
            if r["condition_type"] == "z_code_expr":
                expr = r["condition_expr"]
                if expr == "MLFB_POS14_A":
                    if extra_flags.get("MLFB_POS14_A"):
                        matched.append(r)
                    continue
                if _eval_condition_expr(expr, codes):
                    matched.append(r)
            elif r["condition_type"] == "position9_derived":
                if release_flags.get(r["release_slot"]):
                    matched.append(r)

        if matched:
            # prefer the most specific match (most tokens referenced) per topic
            def specificity(row):
                return len(re.findall(r"[A-Za-z0-9_]+",
                           row["condition_expr"] or row["release_slot"] or ""))
            matched.sort(key=specificity, reverse=True)
            best = specificity(matched[0])
            selected.extend(m for m in matched if specificity(m) == best)
        else:
            default_rows = [r for r in candidate_rows if r["is_default"] == "TRUE"]
            if default_rows:
                selected.extend(default_rows)
            else:
                unresolved_topics.append(topic_id)

    return selected, unresolved_topics


if __name__ == "__main__":
    import sys
    import json
    sys.path.insert(0, str(ROOT / "src"))
    import decoder

    if len(sys.argv) != 2:
        print("Usage: python src/sheet_selector.py '3AE5124-2AC90-6KN0-ZL1B+F30'")
        raise SystemExit(1)

    result = decoder.decode(sys.argv[1])
    selected, unresolved = select_diagrams(result, decoder.KB)
    print(f"Selected {len(selected)} diagram(s):")
    for r in selected:
        print(f"  [{r['blatt_no']}] {r['topic_name_en']} -> {r['reference_diagram']}")
    if unresolved:
        print("\nUnresolved topics (no match, no default):", unresolved)
