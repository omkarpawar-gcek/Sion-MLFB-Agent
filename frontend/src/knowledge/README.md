# SION 3AE5 MLFB + Z-Code Decoder — Starter

This starter project is built from the uploaded Siemens **SION vacuum circuit-breaker 3AE5, Catalog HG 11.02 · 2026**.

## Included

- `data/sion_3ae5_knowledge.json`
  - MLFB structure
  - position mappings
  - Z/additional order codes
  - special order codes
  - validation rules
  - source-page map
- `data/primary_article_lookup.csv`
  - 360 article-number rows extracted from the primary-data tables on catalog pages 16–24
- `src/decoder.py`
  - deterministic MLFB parser
  - exact primary-article lookup
  - Z/order-code decoding
  - initial compatibility checks
- `source_pages_14_33.txt`
  - extracted source text for audit/debugging

## Run

```bash
python src/decoder.py "3AE5124-2AC90-6KN0-ZL1B+F30"
```

The decoder accepts separators/spaces and keeps `-Z` as the boundary between the base article number and additional order codes.

## Architecture recommendation

Use this deterministic decoder as the ground-truth layer.

Then add an LLM/RAG layer above it:

1. Normalize user input.
2. Deterministically decode MLFB and Z-codes.
3. Validate compatibility.
4. Retrieve supporting catalog passages.
5. Ask the LLM to produce a human-readable engineering description from the structured result.
6. Show the source page for every decoded item.
7. Never let the LLM invent an unknown code.

## Important source limitation

The exact meanings of position 6 and some release-combination rows are configuration-table dependent. The decoder therefore prefers the exact primary article-number lookup instead of guessing from a single global digit mapping.

The project is a **starter knowledge base**, not a certification or ordering authority.
