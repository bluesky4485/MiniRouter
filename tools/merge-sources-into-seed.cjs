/**
 * 从旧版 update-models.mjs (HEAD) 的 m() 调用里提取 sourcePricing/sourceBenchmark,
 * 合并进 seed-data.json, 然后重新 seed 到 SQLite。
 *
 * Run: node tools/merge-sources-into-seed.cjs
 */
const { readFileSync, writeFileSync } = require("fs");

const oldSrc = readFileSync("tmp/old-update-models.mjs", "utf8");
const seed = JSON.parse(readFileSync("models/seed-data.json", "utf8"));

// m() 签名 (旧版):
// m(id, provider, displayName, type, input, output, cacheHit, ctx, maxOut,
//   tools, json, vision, video, audio, releaseDate, notes, dataStatus,
//   srcPricing, [codingScore], [reasoningScore], [srcBenchmark])
// 当有评分时是 21 参, 无评分时 17 参(srcPricing 是最后一个)。

// 用字符串感知的方式切分参数
function splitArgs(callBody) {
  const args = [];
  let current = "";
  let depth = 0;
  let inStr = false;
  let quote = "";
  for (let i = 0; i < callBody.length; i++) {
    const c = callBody[i];
    if (inStr) {
      current += c;
      if (c === "\\" && i + 1 < callBody.length) { current += callBody[++i]; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = true; quote = c; current += c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { args.push(current.trim()); current = ""; continue; }
    current += c;
  }
  if (current.trim() !== "") args.push(current.trim());
  return args;
}

// 解析一个字符串字面量参数, 去掉外层引号
function parseStr(arg) {
  const m = arg.match(/^"(.*)"$/s);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
}

// 找所有 m("id", ...) 调用
const calls = [];
const re = /\bm\(\s*"/g;
let match;
while ((match = re.exec(oldSrc)) !== null) {
  const parenIdx = oldSrc.indexOf("(", match.index);
  const idMatch = oldSrc.slice(parenIdx).match(/^\("([^"]+)"/);
  if (!idMatch) continue;
  const id = idMatch[1];
  // 找匹配的右括号
  let depth = 0, inStr = false, quote = "", end = -1;
  for (let i = parenIdx; i < oldSrc.length; i++) {
    const c = oldSrc[i];
    if (inStr) {
      if (c === "\\" && i + 1 < oldSrc.length) { i++; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = true; quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) continue;
  const body = oldSrc.slice(parenIdx + 1, end - 1);
  const args = splitArgs(body);
  calls.push({ id, args });
}

console.log(`从旧 update-models.mjs 解析到 ${calls.length} 个 m() 调用`);

// 提取每个模型的 sourcePricing 和 sourceBenchmark
const sourceMap = new Map();
for (const call of calls) {
  const a = call.args;
  // args[16] = dataStatus, args[17] = srcPricing
  let sPricing = null, sBenchmark = null;
  if (a.length >= 18) sPricing = parseStr(a[17]);
  if (a.length >= 21) sBenchmark = parseStr(a[20]);
  sourceMap.set(call.id, { sourcePricing: sPricing, sourceBenchmark: sBenchmark });
}

// 合并到 seed
let added = 0;
for (const m of seed) {
  const src = sourceMap.get(m.id);
  if (!src) continue;
  if (src.sourcePricing && !m.sourcePricing) { m.sourcePricing = src.sourcePricing; added++; }
  if (src.sourceBenchmark && !m.sourceBenchmark) { m.sourceBenchmark = src.sourceBenchmark; }
}

writeFileSync("models/seed-data.json", JSON.stringify(seed, null, 2) + "\n");
console.log(`已合并 sourcePricing 到 ${added} 个模型`);
console.log(`seed-data.json 现有 sourcePricing: ${seed.filter(m => m.sourcePricing).length} 个`);
console.log(`seed-data.json 现有 sourceBenchmark: ${seed.filter(m => m.sourceBenchmark).length} 个`);
