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
  const chunk = [
    "MiniRouter stream cache probe stable prefix.",
    "Static system and tool schema prefixes should be preserved.",
    "Dynamic tool logs, RAG snippets, shell output, and diffs may be tail-compressed.",
    "Do not compress OCR numbers, table values, code identifiers, or user intent.",
  ].join(" ");
  return Array.from({ length: 180 }, (_, i) => `${i + 1}. ${chunk}`).join("\n");
}

function extractUsageFromObject(json) {
  const usage = json?.usage ?? {};
  const details = usage.prompt_tokens_details ?? usage.input_tokens_details ?? {};
  return {
    rawUsage: usage,
    inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
    cachedTokens: Number(
      usage.cache_read_input_tokens ??
        usage.cache_read_tokens ??
        usage.cached_tokens ??
        details.cached_tokens ??
        details.cache_read_tokens ??
        details?.caching?.credits ??
        0,
    ),
  };
}

function summarizeUsage(usage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
    usageKeys: Object.keys(usage.rawUsage ?? {}),
    detailKeys: Object.keys(usage.rawUsage?.prompt_tokens_details ?? usage.rawUsage?.input_tokens_details ?? {}),
  };
}

async function readSseUsage(response) {
  const text = await response.text();
  let usage = {};
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data);
      events.push({
        keys: Object.keys(json),
        usageKeys: json.usage ? Object.keys(json.usage) : [],
        detailKeys: json.usage?.prompt_tokens_details ? Object.keys(json.usage.prompt_tokens_details) : [],
      });
      if (json.usage) usage = json.usage;
    } catch {
      // Ignore non-JSON SSE data.
    }
  }
  return {
    usage: extractUsageFromObject({ usage }),
    eventCount: events.length,
    lastEvents: events.slice(-5),
  };
}

async function callSlot(slot, stream, attempt) {
  const body = {
    model: slot.model,
    messages: [
      { role: "system", content: stablePrefix() },
      {
        role: "user",
        content: "用一句中文回答：为什么静态前缀要优先保留给供应商缓存？",
      },
    ],
    temperature: 0,
    max_tokens: 32,
    stream,
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

  if (stream) {
    const parsed = await readSseUsage(response);
    return {
      slot: slot.slot,
      model: slot.model,
      stream,
      attempt,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      ...summarizeUsage(parsed.usage),
      eventCount: parsed.eventCount,
      lastEvents: parsed.lastEvents,
    };
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  const usage = extractUsageFromObject(json);
  return {
    slot: slot.slot,
    model: slot.model,
    stream,
    attempt,
    ok: response.ok,
    status: response.status,
    latencyMs: Date.now() - started,
    ...summarizeUsage(usage),
    errorType: json?.error?.type ?? json?.error?.code ?? null,
    errorMessage: json?.error?.message ? String(json.error.message).slice(0, 160) : null,
  };
}

const env = loadDotEnv();
const slot = getSlot(env, process.argv[2] ?? "balanced");
if (!slot.baseUrl || !slot.apiKey || !slot.model) {
  console.error("Missing slot config. Pass balanced or strong, and configure MINIROUTER_<SLOT>_*.");
  process.exit(1);
}

const results = [];
for (const stream of [false, true]) {
  for (const attempt of [1, 2]) {
    results.push(await callSlot(slot, stream, attempt));
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
