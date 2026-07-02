const { readFileSync } = require("fs");
const { homedir } = require("os");
const { join } = require("path");
const Database = require("better-sqlite3");

const db = new Database(join(homedir(), ".minirouter", "minirouter.db"), { readonly: true });

const ids = [...readFileSync("models/update-models.mjs", "utf8").matchAll(/m\("([^"]+)"/g)].map(m => m[1]);

let modelAliases = {};
try { modelAliases = require("./tools/model-benchmark-aliases.mjs").MODEL_BENCHMARK_ALIASES; } catch (e) {}

// Build a lookup map of all raw models
const allRaw = db.prepare(`
  select normalized_id, name, organization_id,
    swe_bench_verified_score, swe_bench_pro_score, scicode_score,
    coding_arena_score, terminal_bench_score, index_code,
    gpqa_score, aime_2025_score, hle_score, frontiermath_score,
    arc_agi_v2_score, index_reasoning, index_math,
    mmmlu_score, simpleqa_score
  from llm_stats_models
`).all();

const rawMap = new Map(allRaw.map(r => [r.normalized_id, r]));

// Also build by model_id for fallback
const rawMapByModelId = new Map(allRaw.map(r => [r.model_id, r]));

let direct = 0, alias = 0, miss = 0;
const missList = [];
const hitDetails = [];

ids.forEach(id => {
  const lookupId = modelAliases[id] || id;
  const row = rawMap.get(lookupId);
  if (row) {
    hitDetails.push({ id, lookupId, row });
    direct++;
  } else {
    missList.push({ id, lookupId });
    miss++;
  }
});

console.log(`Total models in update-models.mjs: ${ids.length}`);
console.log(`Direct hits: ${direct}, Missing: ${miss}`);
console.log(`\n=== Missing models ===`);
missList.forEach(({ id, lookupId }) => {
  if (id !== lookupId) console.log(`  ${id}  →  ${lookupId}  (NOT FOUND)`);
  else console.log(`  ${id}`);
});

// List all raw entries by provider for domestic orgs
console.log(`\n=== All raw entries by domestic orgs (for making aliases) ===`);
const domesticOrgs = ['qwen', 'zai', 'zai-org', 'deepseek', 'moonshotai', 'minimax', 'bytedance', 'xiaomi', 'meituan', 'tencent', 'stepfun', 'baidu', 'kimi', '01-ai'];
const domesticRaw = allRaw.filter(r => {
  const org = r.organization_id || '';
  return domesticOrgs.some(d => org.toLowerCase().includes(d));
});
domesticRaw.forEach(r => {
  console.log(`  ${r.normalized_id.padEnd(55)} ${(r.name || '').slice(0,50)}`);
});

// Show score coverage for matched
console.log(`\n=== Score coverage for matched models ===`);
hitDetails.forEach(({ id, row }) => {
  const hasCoding = row.swe_bench_verified_score != null || row.swe_bench_pro_score != null || row.scicode_score != null || row.coding_arena_score != null;
  const hasReasoning = row.gpqa_score != null || row.aime_2025_score != null || row.hle_score != null;
  const hasChinese = row.mmmlu_score != null || row.simpleqa_score != null;
  const parts = [];
  if (hasCoding) parts.push('coding');
  if (hasReasoning) parts.push('reasoning');
  if (hasChinese) parts.push('chinese');
  if (parts.length < 3) {
    console.log(`  PARTIAL ${id}: [${parts.join(', ')}] ← need: [coding, reasoning, chinese]`);
  }
});
