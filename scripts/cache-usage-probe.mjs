import fs from "node:fs";

function loadDotEnv(path = ".env") {
  if (!fs.existsSync(path)) return {};
  const env = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function chatCompletionsUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function getSlot(env, name) {
  const upper = name.toUpperCase();
  return {
    slot: name,
    baseUrl: env[`MINIROUTER_${upper}_BASE_URL`],
    apiKey: env[`MINIROUTER_${upper}_API_KEY`],
    model: env[`MINIROUTER_${upper}_MODEL`],
  };
}

function stablePrefix() {
  const policy = [
    "You are a precise engineering assistant.",
    "Always answer concisely.",
    "The following stable policy block is intentionally repeated to test provider context caching.",
  ].join("\n");
  const chunk = [
    "MiniRouter cache probe stable prefix.",
    "Keep API native semantics.",
    "Protect system and tools prefix.",
    "Compress only dynamic tails.",
    "Preserve OCR numbers, tables, code identifiers, file paths, and error messages.",
  ].join(" ");
  return `${policy}\n\n${Array.from({ length: 120 }, (_, i) => `${i + 1}. ${chunk}`).join("\n")}`;
}

function extractUsage(json) {
  const usage = json?.usage ?? {};
  const details = usage.prompt_tokens_details ?? usage.input_tokens_details ?? {};
  const anthropicCacheRead = usage.cache_read_input_tokens;
  const anthropicCacheCreate = usage.cache_creation_input_tokens;
  return {
    rawUsage: usage,
    inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
    cachedTokens: Number(
      usage.cache_read_tokens ??
      usage.cached_tokens ??
      details.cached_tokens ??
      details.cache_read_tokens ??
      details?.caching?.credits ??
      anthropicCacheRead ??
      0,
    ),
    cacheCreateTokens: Number(anthropicCacheCreate ?? 0),
  };
}

async function callSlot(slot, attempt) {
  const body = {
    model: slot.model,
    messages: [
      { role: "system", content: stablePrefix() },
      {
        role: "user",
        content:
          "Cache probe task: return exactly one short Chinese sentence explaining why static prefixes should not be compressed.",
      },
    ],
    temperature: 0,
    max_tokens: 32,
    stream: false,
  };

  const started = Date.now();
  const response = await fetch(chatCompletionsUrl(slot.baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${slot.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { parseError: text.slice(0, 300) };
  }

  const usage = extractUsage(json);
  return {
    slot: slot.slot,
    model: slot.model,
    attempt,
    ok: response.ok,
    status: response.status,
    latencyMs: Date.now() - started,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
    cacheCreateTokens: usage.cacheCreateTokens,
    usageKeys: Object.keys(usage.rawUsage ?? {}),
    promptTokenDetailKeys: Object.keys(usage.rawUsage?.prompt_tokens_details ?? usage.rawUsage?.input_tokens_details ?? {}),
    errorType: json?.error?.type ?? json?.error?.code ?? null,
    errorMessage: json?.error?.message ? String(json.error.message).slice(0, 160) : null,
  };
}

const env = loadDotEnv();
const slots = ["balanced", "strong"].map((name) => getSlot(env, name)).filter((slot) => slot.baseUrl && slot.apiKey && slot.model);
const results = [];

for (const slot of slots) {
  for (const attempt of [1, 2]) {
    results.push(await callSlot(slot, attempt));
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
