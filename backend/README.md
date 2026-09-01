# SION 3AE5 MLFB Decoder & Wiring Diagram Viewer - Web App

A small Flask app that wraps the project's already-verified Python logic:

- `src/decoder.py` - decodes an MLFB / Z-code string
- `src/sheet_selector.py` - selects the applicable wiring-diagram topics
- `src/crop_and_assemble_diagrams.py` - crops the real diagrams out of the
  source PDF and assembles them into clean output pages

No decoding logic is reimplemented in the web layer - `web/services/*.py`
only calls the existing functions and shapes the result as JSON.

## Run locally

```bash
cd sion_mlfb_agent
pip install -r requirements.txt
python web/app.py
```

Then open **http://localhost:8080** in your browser.

## Run on Replit

1. Create a new Repl -> "Import from a zip" (or a plain Python template and
   upload these files).
2. Make sure the project keeps this folder layout:
   ```
   sion_mlfb_agent/
     .replit
     requirements.txt
     src/...
     data/...           <- must include S_A7E_449_99009_031_0R_001.pdf
     web/app.py
     web/services/...
     web/templates/index.html
     web/static/...
   ```
3. Click **Run**. The `.replit` file already does
   `pip install -r requirements.txt` and starts `python web/app.py`,
   listening on `0.0.0.0:8080` (Replit maps this to your public URL
   automatically).

## API

- `POST /api/decode` `{ "mlfb": "3AE5554-2AE40-7KN2-Z_D91+W69+F46+F38+E46+C25" }`
  -> decoded positions, order codes, warnings/exceptions, selected diagram topics.
- `POST /api/diagrams` `{ "mlfb": "..." }`
  -> generates and returns URLs of the assembled wiring-diagram page images
  (saved under `web/static/generated/<run>/`).
- `GET /api/health` -> `{"status": "ok"}`

## Notes

- The source PDF must live at `data/S_A7E_449_99009_031_0R_001.pdf`.
- Generated diagram pages accumulate under `web/static/generated/` (one
  timestamped folder per decode). Safe to delete periodically.
- Only the SION 3AE5 family is supported (per `decoder.py`).
