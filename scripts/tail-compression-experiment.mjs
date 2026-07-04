import { compressContext } from "../src/compression/index.ts";

function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function makeStaticPrefix(tokens = 8000) {
  const unit = "Stable system/tools/developer prefix. Preserve for provider cache. ";
  return unit.repeat(Math.ceil((tokens * 4) / unit.length));
}

function makeLogLines(lines) {
  const items = [];
  for (let i = 0; i < lines; i++) {
    items.push(`[${i}] INFO build step=${i % 17} path=D:\\MVP\\MiniRouter\\src\\server\\routes\\chat.ts status=ok elapsed=${i}ms`);
  }
  items.push("ERROR final check failed: TypeError: Cannot read properties of undefined (reading 'cached_tokens')");
  items.push("TOTAL files=184 warnings=12 errors=1");
  return items.join("\n");
}

function makePrettyJson(objects) {
  return JSON.stringify(
    Array.from({ length: objects }, (_, i) => ({
      id: `row-${i}`,
      status: i % 19 === 0 ? "warning" : "ok",
      path: `D:/MVP/MiniRouter/src/file-${i}.ts`,
      count: i,
      message: "This is a repeated JSON payload from a tool result.",
    })),
    null,
    2,
  );
}

function makeRagDocs(paragraphs) {
  const paragraph =
    "MiniRouter routing documentation. This paragraph describes model capabilities, context windows, pricing, cache policy, and fallback behavior. ";
  return Array.from({ length: paragraphs }, (_, i) => `Doc ${i}: ${paragraph.repeat(8)}`).join("\n\n");
}

const scenarios = [
  {
    name: "short_tail",
    tail: "Small dynamic user question with no tool output.",
  },
  {
    name: "tool_logs_10k",
    tail: makeLogLines(120),
  },
  {
    name: "tool_logs_50k",
    tail: makeLogLines(650),
  },
  {
    name: "pretty_json_tool",
    tail: makePrettyJson(180),
  },
  {
    name: "rag_docs_40k",
    tail: makeRagDocs(35),
  },
];

async function runScenario(s) {
  const staticPrefix = makeStaticPrefix();
  const original = [
    { role: "system", content: staticPrefix },
    { role: "user", content: "Please answer using the latest tool result." },
    { role: "tool", tool_call_id: "call_1", content: s.tail },
  ];

  const safe = await compressContext(original, {
    enabled: true,
    layers: {
      deduplication: false,
      whitespace: true,
      dictionary: false,
      paths: false,
      jsonCompact: true,
      observation: false,
      dynamicCodebook: false,
    },
  });

  const aggressiveTail = await compressContext(original, {
    enabled: true,
    layers: {
      deduplication: false,
      whitespace: true,
      dictionary: false,
      paths: false,
      jsonCompact: true,
      observation: true,
      dynamicCodebook: false,
    },
  });

  const originalTokens = estimateTokens(original);
  const safeTokens = estimateTokens(safe.messages);
  const aggressiveTokens = estimateTokens(aggressiveTail.messages);
  const staticTokens = estimateTokens([{ role: "system", content: staticPrefix }]);

  return {
    scenario: s.name,
    originalTokens,
    staticTokens,
    tailTokens: originalTokens - staticTokens,
    safeTokens,
    safeSavedTokens: originalTokens - safeTokens,
    safeSavedPct: (originalTokens - safeTokens) / originalTokens,
    aggressiveTokens,
    aggressiveSavedTokens: originalTokens - aggressiveTokens,
    aggressiveSavedPct: (originalTokens - aggressiveTokens) / originalTokens,
    aggressiveTailSavedPct: (originalTokens - aggressiveTokens) / Math.max(originalTokens - staticTokens, 1),
    observationCompressed: aggressiveTail.stats.observationsCompressed,
    observationCharsSaved: aggressiveTail.stats.observationCharsSaved,
    jsonCharsSaved: aggressiveTail.stats.jsonCompactedChars,
  };
}

const rows = [];
for (const scenario of scenarios) rows.push(await runScenario(scenario));

console.log(JSON.stringify(rows, null, 2));
console.log("\nCSV");
console.log("scenario,originalTokens,staticTokens,tailTokens,safeSavedPct,aggressiveSavedPct,aggressiveTailSavedPct,observationCompressed");
for (const r of rows) {
  console.log([
    r.scenario,
    r.originalTokens,
    r.staticTokens,
    r.tailTokens,
    (r.safeSavedPct * 100).toFixed(1),
    (r.aggressiveSavedPct * 100).toFixed(1),
    (r.aggressiveTailSavedPct * 100).toFixed(1),
    r.observationCompressed,
  ].join(","));
}
