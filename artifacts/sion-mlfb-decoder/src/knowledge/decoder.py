import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "sion_3ae5_knowledge.json"

with DATA.open(encoding="utf-8") as f:
    KB = json.load(f)

PRIMARY = {}
for item in KB["z_codes"]:
    pass

def normalize_code(code: str) -> str:
    """Normalize spaces/hyphens while preserving the -Z marker."""
    code = code.strip().upper()
    code = re.sub(r"\s+", "", code)
    return code

def split_input(raw: str):
    """
    Return base MLFB and additional order/Z codes.
    Examples:
      3AE5124-2AC90-6KN0-ZL1B+F30
      3AE5124-2AC90-6KN0-Z L1B F30
    """
    raw = normalize_code(raw)
    raw = raw.replace("+", " ")
    if "-Z" in raw:
        base, suffix = raw.split("-Z", 1)
        extras = [x for x in re.split(r"[\s,;]+", suffix) if x]
    else:
        base, extras = raw, []
    base = base.replace("-", "")
    return base, extras

def find_primary(article_number: str):
    # The catalog's primary-data tables identify the first 8 positions
    # as an article-number prefix such as 3AE5124-2.
    import csv
    path = ROOT / "data" / "primary_article_lookup.csv"
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["article_number"].replace("-", "") == article_number.replace("-", ""):
                return row
    return None

def decode_base(base: str):
    if len(base) != 16:
        raise ValueError(
            f"Expected a 16-position article number after removing separators; got {len(base)} characters."
        )
    if not base.startswith("3AE5"):
        raise ValueError("This starter decoder is for Siemens SION 3AE5 only.")

    pos = {str(i + 1): ch for i, ch in enumerate(base)}
    primary_article = f"{base[:7]}-{base[7]}"
    lookup = find_primary(primary_article)

    result = {
        "product": "Siemens SION vacuum circuit-breaker 3AE5",
        "raw_base": base,
        "positions": pos,
        "primary_lookup": lookup,
        "decoded": [],
        "warnings": [],
    }

    p = KB["position_codes"]

    result["decoded"].extend([
        {"position": 1, "value": pos["1"], "meaning": "Switching devices"},
        {"position": 2, "value": pos["2"], "meaning": "Circuit-breaker"},
        {"position": 3, "value": pos["3"], "meaning": "Circuit-breaker type series"},
        {"position": 4, "value": pos["4"], "meaning": "SION 3AE5 circuit-breaker version"},
    ])

    voltage_code = pos["5"]
    voltage_map = p["5"]["codes"]
    if voltage_code in voltage_map:
        result["decoded"].append({
            "position": 5,
            "value": voltage_code,
            "meaning": f"Rated voltage: {voltage_map[voltage_code]} kV"
        })
    else:
        result["warnings"].append(f"Unknown position-5 voltage code: {voltage_code}")

    if lookup:
        result["decoded"].extend([
            {"position": 6, "value": pos["6"],
             "meaning": f"Pole-center distance: {lookup['pole_center_distance_mm']} mm; "
                        f"vertical terminal distance: {lookup['vertical_distance_between_terminals_mm']} mm"},
            {"position": 7, "value": pos["7"],
             "meaning": f"Rated short-circuit breaking current: {lookup['rated_short_circuit_breaking_current_ka']} kA"},
            {"position": 8, "value": pos["8"],
             "meaning": f"Rated continuous current: {lookup['rated_continuous_current_a']} A"},
        ])
    else:
        result["warnings"].append(
            "Exact primary article number was not found in the catalog lookup table; "
            "positions 6–8 should not be guessed."
        )

    if pos["9"] in p["9"]["codes"]:
        result["decoded"].append({
            "position": 9, "value": pos["9"],
            "meaning": p["9"]["codes"][pos["9"]]
        })

    if pos["10"] in p["10"]["codes"]:
        result["decoded"].append({
            "position": 10, "value": pos["10"],
            "meaning": f"Closing solenoid: {p['10']['codes'][pos['10']]}"
        })

    if pos["11"] in p["11-12"]["standard_code_map"]:
        result["decoded"].append({
            "position": "11–12", "value": pos["11"] + pos["12"],
            "meaning": f"1st/2nd release operating voltage: {p['11-12']['standard_code_map'][pos['11']]}"
        })
    elif pos["11"] == "9":
        result["decoded"].append({
            "position": "11–12", "value": pos["11"] + pos["12"],
            "meaning": "Special release voltage; a descriptive order code is required."
        })

    if pos["13"] in p["13"]["codes"]:
        result["decoded"].append({
            "position": 13, "value": pos["13"],
            "meaning": p["13"]["codes"][pos["13"]]
        })

    if pos["14"] in p["14"]["codes"]:
        result["decoded"].append({
            "position": 14, "value": pos["14"],
            "meaning": f"Drive motor operating voltage: {p['14']['codes'][pos['14']]}"
        })

    if pos["15"] in p["15"]["codes"]:
        result["decoded"].append({
            "position": 15, "value": pos["15"],
            "meaning": p["15"]["codes"][pos["15"]]
        })

    if pos["16"] in p["16"]["codes"]:
        result["decoded"].append({
            "position": 16, "value": pos["16"],
            "meaning": p["16"]["codes"][pos["16"]]
        })

    return result

def decode(raw: str):
    base, extras = split_input(raw)
    result = decode_base(base)

    zmap = {x["code"]: x for x in KB["z_codes"]}
    result["order_codes"] = []

    for code in extras:
        if code in zmap:
            result["order_codes"].append(zmap[code])
        else:
            result["warnings"].append(f"Unknown/unloaded order code: {code}")

    codes = set(extras)

    # Source-derived compatibility checks.
    if {"A29", "A30"} <= codes:
        result["warnings"].append("INVALID: A29 and A30 are mutually exclusive.")
    if {"A47", "J60"} <= codes:
        result["warnings"].append("INVALID: A47 and J60 are mutually exclusive.")
    if "W88" in codes and "D93" not in codes:
        result["warnings"].append("INVALID/INCOMPLETE: W88 requires D93.")
    if "W89" in codes and "D93" not in codes:
        result["warnings"].append("INVALID/INCOMPLETE: W89 requires D93.")
    if ("M04" in codes or "M05" in codes) and not ({"W88", "W89"} & codes):
        result["warnings"].append("INVALID/INCOMPLETE: M04/M05 require W88 or W89.")
    if "S49" in codes and result["positions"]["13"] != "0":
        result["warnings"].append("INVALID: S49 is only possible for fixed mounting.")
    if any(c in codes for c in ["B01","B02","B03","B04","B05","B06","B07","B08","B09","B17"]) and result["positions"]["15"] != "X":
        result["warnings"].append("INVALID/INCOMPLETE: selected cable-harness options require position 15 = X.")

    # Resolve common special-order codes into human-readable meanings.
    result["special_order_codes"] = [
        x for x in result["order_codes"]
        if x.get("category") == "special order code"
    ]

    return result

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python src/decoder.py '3AE5124-2AC90-6KN0-ZL1B+F30'")
        raise SystemExit(1)

    result = decode(sys.argv[1])
    print(json.dumps(result, indent=2, ensure_ascii=False))
