"""
SION 3AE5 MLFB Decoder + Wiring Diagram Viewer - Flask web app.

Serves the React Vite frontend static bundle, and provides the API
endpoints for decoding and diagram generation.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, send_file

BACKEND_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = (BACKEND_DIR.parent / "frontend" / "dist").resolve()

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.decode_service import decode_mlfb
from services.diagram_service import generate_diagram_pages

app = Flask(
    __name__,
    static_folder=str(BACKEND_DIR / "static"),
    static_url_path="/static"
)

_diagram_cache: dict[str, dict] = {}


@app.post("/api/decode")
def api_decode():
    payload = request.get_json(silent=True) or {}
    raw_mlfb = (payload.get("mlfb") or "").strip()
    if not raw_mlfb:
        return jsonify({"error": "Please enter an MLFB."}), 400
    try:
        result = decode_mlfb(raw_mlfb)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result)


@app.post("/api/diagrams")
def api_diagrams():
    payload = request.get_json(silent=True) or {}
    raw_mlfb = (payload.get("mlfb") or "").strip()
    if not raw_mlfb:
        return jsonify({"error": "Please enter an MLFB."}), 400

    if raw_mlfb in _diagram_cache:
        return jsonify(_diagram_cache[raw_mlfb])

    try:
        result = generate_diagram_pages(raw_mlfb)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

    _diagram_cache[raw_mlfb] = result
    return jsonify(result)


@app.get("/api/health")
def api_health():
    return jsonify({"status": "ok"})


# Serve React static assets (JS/CSS from Vite)
@app.route("/assets/<path:filename>")
def serve_vite_assets(filename):
    return send_from_directory(str(FRONTEND_DIST / "assets"), filename)


# Catch-all route for React SPA, serving index.html
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react_app(path):
    if path != "" and (FRONTEND_DIST / path).exists() and (FRONTEND_DIST / path).is_file():
        return send_from_directory(str(FRONTEND_DIST), path)
    return send_file(str(FRONTEND_DIST / "index.html"))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
