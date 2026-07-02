/**
 * Sync LLM Stats benchmark scores from SQLite into update-models.mjs MODELS array.
 *
 * Strategy: parse each m("id", ...) call with a string-aware scanner that respects
 * quoted strings (so commas/parens inside string literals don't break parsing),
 * then rewrite only the coding/reasoning/sourceBenchmark fields for models that
 * have LLM Stats data.
 *
 * After running this, execute `node models/update-models.mjs` to regenerate dashboard.html.
 *
 * Run: node tools/sync-llmstats-scores.cjs
 */
const { readFileSync, writeFileSync } = require("fs");
const { homedir } = require("os");
const { join } = require("path");
const Database = require("better-sqlite3");

const db = new Database(join(homedir(), ".minirouter", "minirouter.db"), { readonly: true });

const dbRows = db.prepare(`
  select id, score_coding, score_reasoning, score_chinese, score_overall
  from model_scores
`).all();
const scoreMap = new Map(dbRows.map(r => [r.id, r]));

let source = readFileSync("models/update-models.mjs", "utf8");

/**
 * Split a function call's argument list into individual argument strings,
 * respecting string literals. `callBody` is the text between the outer parens,
 * e.g. `"id", "provider", ...`.
 */
function splitArgs(callBody) {
  const args = [];
  let current = "";
  let depth = 0;        // bracket depth for [] {} ()
  let inStr = false;
  let quote = "";
  for (let i = 0; i < callBody.length; i++) {
    const c = callBody[i];
    if (inStr) {
      current += c;
      if (c === "\\" && i + 1 < callBody.length) {
        // escape: include next char literally
        current += callBody[++i];
        continue;
      }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = true;
      quote = c;
      current += c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim() !== "") args.push(current.trim());
  return args;
}

// Locate every m("...") call. We scan for `m(` at top level of the MODELS array.
const calls = [];
let searchFrom = 0;
const mCallRe = /\bm\(\s*"/g;
let match;
while ((match = mCallRe.exec(source)) !== null) {
  const callStart = match.index; // index of 'm'
  // Find the opening paren position
  const parenIdx = source.indexOf("(", match.index);
  // Extract the id from the first quoted string
  const idMatch = source.slice(parenIdx).match(/^\("([^"]+)"/);
  if (!idMatch) continue;
  const id = idMatch[1];

  // Scan from parenIdx to find the matching close paren, string-aware
  let depth = 0;
  let inStr = false;
  let quote = "";
  let end = -1;
  for (let i = parenIdx; i < source.length; i++) {
    const c = source[i];
    if (inStr) {
      if (c === "\\" && i + 1 < source.length) { i++; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = true; quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) continue;
  calls.push({ id, callStart, parenStart: parenIdx, end });
}

// m() signature:
// m(id, provider, displayName, type, input, output, cacheHit, ctx, maxOut,
//   tools, json, vision, video, audio, releaseDate, notes, dataStatus,
//   srcPricing, codingScore, reasoningScore, srcBenchmark)
// Indices: 0..20. codingScore=18, reasoningScore=19, srcBenchmark=20.
// BUT some calls omit codingScore/reasoningScore/srcBenchmark when no data
// (e.g. m("zhipu/glm-5-turbo", ..., "confirmed", "https://...")). So we must
// handle variable arg counts: when args.length === 18, only up to srcPricing.
// We only inject scores for models that have LLM Stats data.

const SRC_BENCH = '"https://llm-stats.com/leaderboards/llm-leaderboard"';

let updatedCount = 0;
const report = [];

// Process from the end backwards so indices don't shift as we edit.
calls.sort((a, b) => b.callStart - a.callStart);

for (const call of calls) {
  const dbRow = scoreMap.get(call.id);
  if (!dbRow) continue;

  const hasCoding = dbRow.score_coding != null && dbRow.score_coding > 0;
  const hasReasoning = dbRow.score_reasoning != null && dbRow.score_reasoning > 0;
  if (!hasCoding && !hasReasoning) continue;

  const callBody = source.slice(call.parenStart + 1, call.end - 1); // between ( )
  const args = splitArgs(callBody);

  // Determine layout. Minimum 18 args (id..srcPricing). With scores: 21 args.
  // Find positions of coding/reasoning/srcBenchmark if present.
  // The trailing args pattern is: ..., notes(15), dataStatus(16), srcPricing(17),
  //   [codingScore(18), reasoningScore(19), srcBenchmark(20)]
  let newArgs;
  if (args.length >= 21) {
    // Already has score fields — just replace them.
    newArgs = args.slice();
    if (hasCoding) newArgs[18] = String(dbRow.score_coding);
    if (hasReasoning) newArgs[19] = String(dbRow.score_reasoning);
    newArgs[20] = SRC_BENCH;
  } else if (args.length === 18) {
    // No score fields yet — append them.
    newArgs = args.slice();
    newArgs.push(hasCoding ? String(dbRow.score_coding) : "null");
    newArgs.push(hasReasoning ? String(dbRow.score_reasoning) : "null");
    newArgs.push(SRC_BENCH);
  } else {
    // Unexpected arity — skip to avoid corrupting.
    report.push({ id: call.id, status: "skip", argsLen: args.length });
    continue;
  }

  // Detect actual change
  const oldCall = source.slice(call.callStart, call.end);
  const newCall = "m(" + newArgs.join(", ") + ")";

  if (oldCall === newCall) continue;

  source = source.slice(0, call.callStart) + newCall + source.slice(call.end);
  updatedCount++;
  report.push({
    id: call.id,
    coding: hasCoding ? dbRow.score_coding : null,
    reasoning: hasReasoning ? dbRow.score_reasoning : null,
  });
}

writeFileSync("models/update-models.mjs", source);

console.log(`Score sync complete:`);
console.log(`  Updated: ${updatedCount} models`);
console.log(`  Total m() calls scanned: ${calls.length}`);
if (report.length) {
  console.log(`\n  Changed models:`);
  for (const r of report) {
    if (r.status === "skip") {
      console.log(`    SKIP ${r.id} (argsLen=${r.argsLen})`);
    } else {
      console.log(`    ${r.id.padEnd(40)} coding=${r.coding ?? "—"} reasoning=${r.reasoning ?? "—"}`);
    }
  }
}
console.log(`\n  Next: run \`node models/update-models.mjs\` to regenerate dashboard.html`);
