// Replace the inline MODELS array in dashboard.html with a dynamic fetch(/api/models) loader.
const { readFileSync, writeFileSync } = require("fs");

const html = readFileSync("models/dashboard.html", "utf8");
const startMarker = "const MODELS = [";
const startIdx = html.indexOf(startMarker);
if (startIdx === -1) throw new Error('marker not found');

// find matching ] (string-aware)
const bodyStart = startIdx + startMarker.length;
let depth = 1, inStr = false, quote = "", endIdx = -1;
for (let i = bodyStart; i < html.length; i++) {
  const c = html[i];
  if (inStr) {
    if (c === "\\" && i + 1 < html.length) { i++; continue; }
    if (c === quote) inStr = false;
    continue;
  }
  if (c === '"' || c === "'" || c === "`") { inStr = true; quote = c; continue; }
  if (c === "[" || c === "{") depth++;
  else if (c === "]" || c === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
}

const before = html.slice(0, startIdx);
const after = html.slice(endIdx + 1);

const loader = `let MODELS = [];
const DEFAULT_MODELS_API_URL = location.protocol === "file:" ? "http://localhost:8402/api/models" : "/api/models";
const MODELS_API_URL = new URLSearchParams(location.search).get("api") || DEFAULT_MODELS_API_URL;

loadModels();

async function loadModels() {
  const tbody = document.getElementById("tbody");
  const count = document.getElementById("count");
  if (tbody) tbody.innerHTML = '<tr><td colspan="15" class="muted">Loading database models...</td></tr>';
  if (count) count.textContent = "Loading...";
  try {
    const response = await fetch(MODELS_API_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload = await response.json();
    MODELS = Array.isArray(payload.data) ? payload.data : [];
    document.getElementById("updateDate").textContent = new Date().toISOString().slice(0, 10);
    initProviders();
    render();
  } catch (error) {
    console.error("Failed to load model database", error);
    if (tbody) tbody.innerHTML = '<tr><td colspan="15" class="muted">Failed to load database models from ' + MODELS_API_URL + '</td></tr>';
    if (count) count.textContent = "Database load failed";
  }
}
`;

const newHtml = before + loader + after;
writeFileSync("models/dashboard.html", newHtml);
console.log("dashboard.html 已改为动态 API 加载");
console.log("before末尾:", JSON.stringify(before.slice(-40)));
console.log("after开头:", JSON.stringify(after.slice(0, 40)));
