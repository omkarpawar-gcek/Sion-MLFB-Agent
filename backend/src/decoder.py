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
        # Underscore added as a separator 2026-08-21: inputs commonly use "-Z_CODE1+CODE2" (leading
        # underscore right after the Z marker). Previously this made the first code parse as "_CODE1"
        # (an unrecognized token) instead of "CODE1" - underscore is never part of a real order code.
        extras = [x for x in re.split(r"[\s,;_]+", suffix) if x]
    else:
        base, extras = raw, []
    base = base.replace("-", "")
    return base, extras

def find_primary(article_number: str):
    # The catalog's primary-data tables identify the first 8 positions
    # as an article-number prefix such as 3AE5124-2.
    # Uses the verified, full technical-data CSV (extracted directly from the
    # catalog PDF's text layer, all 359 rows cross-checked) instead of the
    # older starter lookup, which had corrupted values for many rows
    # (e.g. impossible 275kV/40003A entries) - see chat notes 2026-08-20.
    import csv
    path = ROOT / "data" / "primary_article_technical_data_full.csv"
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["article_number"].replace("-", "") == article_number.replace("-", ""):
                return row
    return None


def find_option_compatibility(article_number: str):
    # Article-level D59 (wide housing) / W66 / W88 / W89 / M30 availability, extracted from the
    # catalog's "Selection of primary data" compatibility table (all 5 voltage tiers).
    # "D59_standard_compulsory"=YES means only standard housing is offered (D59 NOT an option for
    # this exact article); "D59_optional"=YES means D59 is a valid OPTIONAL order code for it - the
    # two are normally mutually exclusive per article (confirmed 2026-08-20 against 360 catalog
    # rows; 0 rows have both=YES). Columns renamed 2026-08-21 so D59 is the primary concept, split
    # into these two states. A small number of rows (20/360) have both=NO - treat those as
    # UNRESOLVED rather than silently valid or invalid; see the D59 validation check below.
    import csv
    path = ROOT / "data" / "article_option_compatibility.csv"
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
        known_exceptions = KB.get("known_exceptions", {}).get("position_5_special_series", {})
        confirmed = known_exceptions.get("confirmed_values", {})
        if voltage_code in confirmed and lookup and lookup.get("tier_kv"):
            # Documented, confirmed exception - not an error. Kept separate from "warnings".
            result.setdefault("exceptions", []).append({
                "field": "position_5",
                "value": voltage_code,
                "status": "CONFIRMED_EXCEPTION",
                "explanation": confirmed[voltage_code],
                "resolved_voltage_tier_kv": lookup["tier_kv"],
            })
            result["resolved_voltage_tier_kv"] = lookup["tier_kv"]
        elif lookup and lookup.get("tier_kv"):
            # Not yet a documented exception, but the lookup resolves it anyway - flag as a warning
            # so it can be reviewed and promoted to a confirmed exception if it recurs.
            result["warnings"].append(
                f"Position-5 voltage code '{voltage_code}' is not in the standard 0-4 table and is not "
                f"yet a documented exception, but the primary article lookup confirms this is a "
                f"{lookup['tier_kv']} kV article. Consider adding it to known_exceptions if this recurs."
            )
            result["resolved_voltage_tier_kv"] = lookup["tier_kv"]
        else:
            result["warnings"].append(
                f"Unknown position-5 voltage code: {voltage_code} (no primary lookup match to resolve it either)"
            )

    if lookup:
        result["decoded"].extend([
            {"position": 6, "value": pos["6"],
             "meaning": f"Pole-center distance: {lookup['pole_center_distance_mm']} mm; "
                        f"vertical terminal distance: {lookup['vertical_distance_terminals_mm']} mm"},
            {"position": 7, "value": pos["7"],
             "meaning": f"Rated short-circuit breaking current: {lookup['rated_scb_current_kA']} kA"},
            {"position": 8, "value": pos["8"],
             "meaning": f"Rated continuous current: {lookup['rated_continuous_current_A']} A"},
        ])
        result["primary_lookup_extra"] = {
            "tier_kv": lookup.get("tier_kv"),
            "weight_kg": lookup.get("weight_kg"),
            "dimensional_drawing_no": lookup.get("dimensional_drawing_no"),
            "operating_cycle_diagram_no": lookup.get("operating_cycle_diagram_no"),
        }
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

    if pos["11"] in p["11"]["standard_code_map"]:
        result["decoded"].append({
            "position": 11, "value": pos["11"],
            "meaning": f"1st release operating voltage: {p['11']['standard_code_map'][pos['11']]}"
        })
    elif pos["11"] == "9":
        result["decoded"].append({
            "position": 11, "value": pos["11"],
            "meaning": "1st release operating voltage: special - see L1x order code for exact value"
        })

    if pos["12"] in p["12"]["standard_code_map"]:
        result["decoded"].append({
            "position": 12, "value": pos["12"],
            "meaning": f"2nd release operating voltage: {p['12']['standard_code_map'][pos['12']]}"
        })
    elif pos["12"] == "9":
        result["decoded"].append({
            "position": 12, "value": pos["12"],
            "meaning": "2nd release operating voltage: special - see M1x order code for exact value"
        })

    if pos["13"] in p["13"]["codes"]:
        result["decoded"].append({
            "position": 13, "value": pos["13"],
            "meaning": p["13"]["codes"][pos["13"]]
        })
    elif pos["13"] == "7":
        # User-confirmed 2026-08-21: position-13 = 7 is a new/recent addition to the installation-
        # options scheme that is NOT yet formally documented in the current catalog edition (HG 11.02
        # 2026). An exhaustive full-text search of all 76 catalog pages found no matching table entry.
        # Kept separate from plain "warnings" (like the position-5 special-series exceptions) since the
        # user has confirmed it is a legitimate value, not a typo - but its exact meaning is still unknown.
        result.setdefault("exceptions", []).append({
            "field": "position_13",
            "value": "7",
            "status": "RECOGNIZED_BUT_UNDOCUMENTED",
            "explanation": (
                "User-confirmed 2026-08-21: value 7 is a new update to the installation-options scope "
                "not yet properly documented in the available catalog. Do not treat as an input error, "
                "but do not assume any specific scope-of-installation meaning either until a source is "
                "found."
            ),
        })
    else:
        result["warnings"].append(
            f"INVALID/UNDOCUMENTED position-13 value: '{pos['13']}'. Catalog page 28 only "
            f"documents 0,1,2,3,5,6 for this position - verify input for a possible typo."
        )

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
    elif pos["16"] == "9":
        result["decoded"].append({
            "position": 16, "value": pos["16"],
            "meaning": "Language: special - see R1x order code for exact language"
        })

    return result

def decode(raw: str):
    base, extras = split_input(raw)
    result = decode_base(base)

    zmap = {x["code"]: x for x in KB["z_codes"]}
    result["order_codes"] = []

    from collections import Counter
    extras_count = Counter(extras)
    duplicates = [c for c, n in extras_count.items() if n > 1]
    if duplicates:
        result["warnings"].append(
            f"DUPLICATE order code(s) in input, listed more than once: {', '.join(sorted(duplicates))}. "
            f"Each is only applied once below - verify this wasn't a typo in the input."
        )

    seen = set()
    for code in extras:
        if code in seen:
            continue
        seen.add(code)
        if code in zmap:
            result["order_codes"].append(zmap[code])
        else:
            result["warnings"].append(f"Unknown/unloaded order code: {code}")

    codes = set(extras)
    result["all_input_codes"] = sorted(codes)  # exposes EVERY input code, known or not -
    # needed by downstream consumers (e.g. sheet_selector.py) that must check for codes
    # not yet documented in this project's z_codes KB (e.g. S71, S73 - found 2026-08-21
    # via the wiring-diagram table of contents, not in the HG 11.02 catalog at all).

    # Resolve L1x (position 11 = "9") and M1x (position 12 = "9") special release-voltage order
    # codes into the actual decoded entries - added 2026-08-21. Positions 11/12 were only assigned
    # a generic "special - see L1x/M1x order code" placeholder in decode_base(); once the Z-codes
    # are known (here in decode()), fill in the resolved voltage if the matching code is present.
    l1_codes = {"L1A", "L1B", "L1C", "L1D", "L1E", "L1F", "L1K", "L1L", "L1M"}
    m1_codes = {"M1A", "M1B", "M1C", "M1D", "M1E", "M1F", "M1K", "M1L", "M1M"}
    p11_special = KB["position_codes"]["11"]["special_order_codes"]
    p12_special = KB["position_codes"]["12"]["special_order_codes"]
    found_l1 = codes & l1_codes
    found_m1 = codes & m1_codes
    if result["positions"].get("11") == "9":
        entry = next((x for x in result["decoded"] if x["position"] == 11), None)
        if entry:
            if found_l1:
                code = next(iter(found_l1))
                entry["meaning"] = f"1st release operating voltage: {p11_special.get(code, '?')} (via {code})"
            else:
                result["warnings"].append(
                    "INVALID/INCOMPLETE: position 11 = 9 (special 1st release voltage) but no L1x "
                    "order code is present to specify the exact voltage."
                )
    if result["positions"].get("12") == "9":
        entry = next((x for x in result["decoded"] if x["position"] == 12), None)
        if entry:
            if found_m1:
                code = next(iter(found_m1))
                entry["meaning"] = f"2nd release operating voltage: {p12_special.get(code, '?')} (via {code})"
            else:
                result["warnings"].append(
                    "INVALID/INCOMPLETE: position 12 = 9 (special 2nd release voltage) but no M1x "
                    "order code is present to specify the exact voltage."
                )

    # Resolve R1x (position 16 = "9") special-language order codes - added 2026-08-21, same pattern
    # as L1x/M1x above. Verified against catalog page 31.
    r1_codes = {"R1C", "R1D", "R1F", "R1G", "R1H", "R1K"}
    found_r1 = codes & r1_codes
    p16_special = KB["position_codes"]["16"]["special_order_codes"]
    if result["positions"].get("16") == "9":
        entry = next((x for x in result["decoded"] if x["position"] == 16), None)
        if entry:
            if found_r1:
                code = next(iter(found_r1))
                entry["meaning"] = f"Language: {p16_special.get(code, '?')} (via {code})"
            else:
                result["warnings"].append(
                    "INVALID/INCOMPLETE: position 16 = 9 (special language) but no R1x order code "
                    "is present to specify the exact language."
                )

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
    if ("A29" in codes or "A30" in codes) and ({"M04", "M05"} & codes):
        result["warnings"].append(
            "INVALID: A29/A30 (anti-condensation heating) cannot be combined with M04/M05 "
            "(motorized third-party racking) - per knowledge base validation_rules "
            "A29_not_with_M04_M05 / A30_not_with_M04_M05 (previously documented but not enforced - fixed 2026-08-20)."
        )
    # --- Rules added 2026-08-20 from Options-table catalog screenshots ---
    if "A47" in codes and ({"M04", "M05"} & codes):
        result["warnings"].append(
            "INVALID: M04/M05 (motorized third-party racking) cannot be combined with A47 "
            "(electrical closing lockout) - per catalog Options table remark."
        )
    D9X = {"D90", "D91", "D92", "D93", "D94", "D98"}
    if "D93" in codes and not ({"J64", "W88", "W89"} & codes):
        result["warnings"].append(
            "INVALID/INCOMPLETE: D93 (insulating shell for other manufacturers' racking) requires "
            "J64, W88, or W89 to also be present."
        )
    # Per-code D9x requirement for the two tiers WITHOUT a blanket tier-wide D9x rule (7.2kV, 12kV).
    # E65 removed from this list 2026-08-21: 24kV now has its own blanket rule below (catalog p.20/22/24
    # confirms "All SION vacuum circuit-breakers for 17.5/24/36 kV require an insulating shell via D9x").
    for volt_code, tier_note in [("E13", "12kV"), ("E16", "7.2kV"), ("E95", "12kV")]:
        if volt_code in codes and not (D9X & codes):
            result["warnings"].append(
                f"INVALID/INCOMPLETE: {volt_code} ({tier_note} special withstand-voltage rating) requires "
                f"an insulating shell (one of D90/D91/D92/D93/D94/D98) to also be present."
            )
    # Blanket tier-wide D9x requirement (added 2026-08-21 from catalog footnotes on pages 20/22/24:
    # "All SION vacuum circuit-breakers for 17.5/24/36 kV require an insulating shell via order code
    # D9x; for NXAIR via order code D90 or D91."). Unlike E13/E16/E95 above, this applies to EVERY
    # article at these tiers regardless of which other codes are chosen.
    _tier_for_d9x = (result.get("primary_lookup_extra") or {}).get("tier_kv") or result.get("resolved_voltage_tier_kv")
    if _tier_for_d9x in ("17.5", "24", "36") and not (D9X & codes):
        result["warnings"].append(
            f"INVALID/INCOMPLETE: all SION vacuum circuit-breakers at the {_tier_for_d9x} kV tier require "
            f"an insulating shell (one of D90/D91/D92/D93/D94/D98) - none is present in this input."
        )
    # W63 (NXAIR World/H) / W69 (channel partner product) - added 2026-08-21, refined same day per
    # user domain knowledge: every VCB in this family is EITHER an NXAIR-installation unit (W63) OR
    # a channel partner product (W69) - the two are alternatives for the same 39 special articles,
    # not independent codes. W69 itself is still not found anywhere in the official catalog text
    # (76 pages searched, zero hits) - kept as user-provided/unverified, but now understood to serve
    # as the channel-partner alternative to W63 rather than an unrelated unknown code.
    _w63_compat = find_option_compatibility(f"{base[:7]}-{base[7]}")
    _w63_required = bool(_w63_compat and _w63_compat.get("W63_required") == "YES")
    if _w63_required and not ({"W63", "W69"} & codes):
        result["warnings"].append(
            "INVALID/INCOMPLETE: this article requires either W63 (NXAIR World/H installation) or "
            "W69 (channel partner product) as order code, per the catalog's article-level "
            "compatibility table and user-confirmed product knowledge."
        )
    if {"W63", "W69"} <= codes:
        result["warnings"].append(
            "INVALID: W63 and W69 are mutually exclusive - per user-confirmed product knowledge, a "
            "device is either an NXAIR installation unit or a channel partner product, not both."
        )
    if "W63" in codes and not _w63_required:
        result["warnings"].append(
            "INVALID: W63 is not applicable to this article - it is only used for the specific NXAIR "
            "World/H installation article family per the catalog's article-level compatibility table."
        )
    if "D98" in codes and not ({"D90", "D91"} & codes):
        result["warnings"].append(
            "INVALID/INCOMPLETE: D98 (insulating shell, only lower part) requires D90 or D91 to also be present."
        )
    if "M13" in codes and "W88" in codes:
        result["warnings"].append(
            "INVALID: M13 (13-contact-finger tulip system) cannot be combined with W88 "
            "(third-party components racking)."
        )
    # E46 (rated short-circuit breaking current uprate) - corrected 2026-08-21: this order code
    # REPLACES the base position-7 rating, it does not offer a free choice between 21/26.3 kA.
    # Catalog page 32 pairs the values positionally: "For 12 kV/20 or 25 kA" -> "Isc = 21 or 26.3 kA".
    E46_UPRATE = {"20": "21", "25": "26.3"}
    if "E46" in codes:
        base_scb = ((result.get("primary_lookup") or {}).get("rated_scb_current_kA") or "").strip()
        tier_for_e46 = (result.get("primary_lookup_extra") or {}).get("tier_kv") or result.get("resolved_voltage_tier_kv")
        if tier_for_e46 != "12":
            result["warnings"].append(
                f"INVALID: E46 is a 12 kV-tier order code only, but this article resolves to "
                f"{tier_for_e46} kV."
            )
        elif base_scb in E46_UPRATE:
            result["effective_rated_scb_current_kA"] = E46_UPRATE[base_scb]
            result.setdefault("exceptions", []).append({
                "field": "rated_scb_current_kA",
                "value": E46_UPRATE[base_scb],
                "status": "UPRATED_BY_ORDER_CODE",
                "explanation": (
                    f"E46 uprates the base short-circuit breaking current from {base_scb} kA to "
                    f"{E46_UPRATE[base_scb]} kA. This REPLACES the position-7 base rating - it is "
                    f"not an independent choice between 21/26.3 kA."
                ),
            })
        else:
            result["warnings"].append(
                f"INVALID: E46 requires a 20 kA or 25 kA base article rating (uprates to 21 kA or "
                f"26.3 kA respectively), but this article's base rating is {base_scb or 'unknown'} kA."
            )
    if "D59" in codes:
        opt_compat = find_option_compatibility(f"{base[:7]}-{base[7]}")
        if opt_compat:
            d59_optional = opt_compat.get("D59_optional")
            d59_standard_compulsory = opt_compat.get("D59_standard_compulsory")
            if d59_optional != "YES":
                if d59_standard_compulsory == "YES":
                    result["warnings"].append(
                        f"INVALID: D59 (wide housing) is not offered for article {opt_compat['article_number']} - "
                        f"this exact rating ships in standard housing only (compulsory), per the catalog's "
                        f"article-level compatibility table."
                    )
                else:
                    result["warnings"].append(
                        f"UNRESOLVED: D59 availability for article {opt_compat['article_number']} is not "
                        f"documented as either standard-compulsory or D59-optional in the compatibility "
                        f"table (both flags are NO) - verify against the catalog before treating this "
                        f"input as valid."
                    )
    if "J18" in codes and "A47" in codes:
        result["warnings"].append(
            "INVALID: J18 (fixing bracket for fixed mounting) cannot be combined with A47 "
            "(electrical closing lockout) - per catalog Options table remark."
        )
    # Generic position-13 ("Available for 13th position") enforcement, replacing the old
    # S49-only special case - now checks every order code with a documented restriction.
    pos13_val = result["positions"]["13"]
    opt_compat_for_pos13 = find_option_compatibility(f"{base[:7]}-{base[7]}")
    is_motorized_racking = bool({"M04", "M05"} & codes)

    for oc in result["order_codes"]:
        code = oc["code"]
        if code in ("W88", "W89"):
            # Article-level, drive-type-aware check (corrected 2026-08-21). Reads the per-article
            # W88_manual_pos13 / W88_motorized_pos13 / W89_manual_pos13 / W89_motorized_pos13 columns
            # from article_option_compatibility.csv directly. This supersedes the old coarse
            # tier-only table, which incorrectly claimed W88 was NOT OFFERED at 24kV for every
            # article at that tier - the user's manual catalog review found 16 articles where it
            # IS offered. Manual vs motorized is selected by whether M04/M05 (motorized
            # third-party racking) is present in this input's order codes.
            variant = "motorized" if is_motorized_racking else "manual"
            col = f"{code}_{variant}_pos13"
            allowed_str = (opt_compat_for_pos13 or {}).get(col, "")
            if opt_compat_for_pos13 is None:
                result["warnings"].append(
                    f"UNRESOLVED: Could not verify {code} position-13 compatibility - exact article "
                    f"number not found in article_option_compatibility.csv."
                )
            elif not allowed_str:
                result["warnings"].append(
                    f"INVALID: {code} ({oc['description']}) is not offered for this exact article "
                    f"({variant} variant) per the article-level compatibility table - regardless of "
                    f"position 13."
                )
            else:
                allowed = {v.strip() for v in allowed_str.split(",")}
                if pos13_val not in allowed:
                    result["warnings"].append(
                        f"INVALID: {code} ({oc['description']}) requires 13th position {allowed_str} "
                        f"for this exact article ({variant} variant), but position 13 in this input "
                        f"is '{pos13_val}'."
                    )
            continue  # skip the generic code-level check below for W88/W89 - article-level check already applied

        avail = oc.get("available_for_13th_position")
        if not avail or avail == "All" or avail.startswith("NOT DOCUMENTED"):
            continue
        allowed = {v.strip() for v in avail.split(",")}
        if pos13_val not in allowed:
            result["warnings"].append(
                f"INVALID: {oc['code']} ({oc['description']}) is only available for 13th position "
                f"{avail}, but position 13 in this input is '{pos13_val}'."
            )
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
