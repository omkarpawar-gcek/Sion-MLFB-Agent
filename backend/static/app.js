const mlfbInput = document.getElementById("mlfbInput");
const decodeBtn = document.getElementById("decodeBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const diagramsCard = document.getElementById("diagramsCard");
const diagramStatus = document.getElementById("diagramStatus");
const diagramGallery = document.getElementById("diagramGallery");

decodeBtn.addEventListener("click", runAll);
mlfbInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runAll(); });

async function runAll() {
  const mlfb = mlfbInput.value.trim();
  statusEl.textContent = "";
  statusEl.classList.remove("error");
  resultsEl.classList.add("hidden");
  diagramsCard.classList.add("hidden");
  diagramGallery.innerHTML = "";

  if (!mlfb) {
    statusEl.textContent = "Please enter an MLFB.";
    statusEl.classList.add("error");
    return;
  }

  decodeBtn.disabled = true;
  statusEl.textContent = "Decoding\u2026";

  try {
    const decodeResp = await fetch("/api/decode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mlfb }),
    });
    const decodeData = await decodeResp.json();
    if (!decodeResp.ok) throw new Error(decodeData.error || "Decode failed.");

    renderDecodeResult(decodeData);
    statusEl.textContent = "Decoded successfully.";

    diagramsCard.classList.remove("hidden");
    diagramStatus.textContent = "Generating diagram pages from the source PDF\u2026";
    diagramGallery.innerHTML = "";

    const diagResp = await fetch("/api/diagrams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mlfb }),
    });
    const diagData = await diagResp.json();
    if (!diagResp.ok) throw new Error(diagData.error || "Diagram generation failed.");

    renderDiagrams(diagData);
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    statusEl.classList.add("error");
    if (diagramsCard.classList.contains("hidden") === false) {
      diagramStatus.textContent = "Could not generate diagrams: " + err.message;
    }
  } finally {
    decodeBtn.disabled = false;
  }
}

function renderDecodeResult(data) {
  const result = data.decoded_result;
  const summary = data.summary;

  const summaryRows = [
    ["Input MLFB", data.input_mlfb],
    ["Product", result.product],
    ["Resolved voltage tier", (result.primary_lookup_extra && result.primary_lookup_extra.tier_kv) || result.resolved_voltage_tier_kv || "\u2014"],
    ["Order codes recognized", summary.order_code_count],
    ["Warnings", summary.warning_count],
    ["Wiring diagrams selected", summary.selected_diagram_count],
  ];
  const summaryTable = document.querySelector("#summaryTable tbody") || document.querySelector("#summaryTable");
  document.getElementById("summaryTable").innerHTML =
    "<tbody>" + summaryRows.map(([k, v]) => `<tr><th>${escapeHtml(String(k))}</th><td>${escapeHtml(String(v))}</td></tr>`).join("") + "</tbody>";

  const posBody = document.querySelector("#positionsTable tbody");
  posBody.innerHTML = result.decoded.map(d =>
    `<tr><td>${d.position}</td><td><code>${escapeHtml(d.value)}</code></td><td>${escapeHtml(d.meaning)}</td></tr>`
  ).join("");

  const ordersBody = document.querySelector("#ordersTable tbody");
  const orderCodes = result.order_codes || [];
  document.getElementById("noOrders").classList.toggle("hidden", orderCodes.length > 0);
  ordersBody.innerHTML = orderCodes.map(oc =>
    `<tr><td><code>${escapeHtml(oc.code)}</code></td><td>${escapeHtml(oc.description || "")}</td></tr>`
  ).join("");

  const exceptionsCard = document.getElementById("exceptionsCard");
  const exceptionsBox = document.getElementById("exceptionsBox");
  const exceptions = result.exceptions || [];
  exceptionsCard.classList.toggle("hidden", exceptions.length === 0);
  exceptionsBox.innerHTML = exceptions.map(e =>
    `<div class="exc"><b>${escapeHtml(e.field)}</b> = ${escapeHtml(String(e.value))} <span class="badge">${escapeHtml(e.status)}</span><br>${escapeHtml(e.explanation)}</div>`
  ).join("");

  const warningsCard = document.getElementById("warningsCard");
  const warningsBox = document.getElementById("warningsBox");
  const warnings = result.warnings || [];
  warningsCard.classList.toggle("hidden", warnings.length === 0);
  warningsBox.innerHTML = warnings.map(w => `<div class="warn">${escapeHtml(w)}</div>`).join("");

  resultsEl.classList.remove("hidden");
}

function renderDiagrams(data) {
  const pages = data.output_pages || [];
  const build = data.build_result || {};
  if (!pages.length) {
    diagramStatus.textContent = "No diagram pages were generated for this MLFB.";
    return;
  }
  diagramStatus.textContent =
    `${build.circuit_diagram_count || 0} circuit diagram(s) + ${build.admin_page_count || 0} reference sheet(s) across ${pages.length} page(s).`;
  diagramGallery.innerHTML = pages.map((url, i) =>
    `<figure><img src="${url}" alt="Wiring diagram page ${i + 1}" loading="lazy">
      <figcaption>Page ${i + 1} of ${pages.length}</figcaption></figure>`
  ).join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
