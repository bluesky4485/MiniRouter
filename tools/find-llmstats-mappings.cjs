const { readFileSync } = require("fs");
const { homedir } = require("os");
const { join } = require("path");
const Database = require("better-sqlite3");

const db = new Database(join(homedir(), ".minirouter", "minirouter.db"), { readonly: true });

// All raw models
const allRaw = db.prepare(`select normalized_id, name, organization_id from llm_stats_models`).all();

// 77 models from update-models.mjs
const seedIds = [...readFileSync("models/update-models.mjs", "utf8").matchAll(/m\("([^"]+)"/g)].map(m => m[1]);

// Existing aliases
let existingAliases = {};
try { existingAliases = require("./tools/model-benchmark-aliases.mjs").MODEL_BENCHMARK_ALIASES; } catch (e) {}

const rawMap = new Map(allRaw.map(r => [r.normalized_id, r]));

// For each seed model, try to find the best match
// Strategy: provider prefix + name similarity
const providerPrefixMap = {
  "deepseek": "deepseek/",
  "zhipu": "zhipu/",
  "alibaba": "alibaba/",
  "bytedance": "bytedance/",
  "xiaomi": "xiaomi/",
  "meituan": "meituan/",
  "minimax": "minimax/",
  "tencent": "tencent/",
  "moonshot": "moonshot/",
  "stepfun": "stepfun/",
  "baidu": "baidu/",
  "openai": "openai/",
  "anthropic": "anthropic/",
  "google": "google/",
};

// Fuzzy search: for each seed model, list all possible raw matches from same provider
const results = [];
seedIds.forEach(seedId => {
  const provider = seedId.split("/")[0];
  const prefix = providerPrefixMap[provider] || provider + "/";
  const rawCandidates = allRaw.filter(r => r.normalized_id.startsWith(prefix));

  const lookupId = existingAliases[seedId] || seedId;
  const directHit = rawMap.get(lookupId);

  // Compute simple name similarity
  const seedName = seedId.replace(prefix, "").toLowerCase().replace(/[-_.]/g, "");
  const scored = rawCandidates.map(r => {
    const rawName = r.normalized_id.replace(prefix, "").toLowerCase().replace(/[-_.]/g, "");
    // Simple substring match score
    let score = 0;
    if (rawName.includes(seedName)) score = 100;
    else if (seedName.includes(rawName)) score = 80;
    else {
      // Check common parts
      const parts = seedName.split(/[\/]/);
      const rawParts = rawName.split(/[\/]/);
      const common = parts.filter(p => rawParts.some(rp => rp.includes(p) || p.includes(rp)));
      score = common.length / Math.max(parts.length, rawParts.length) * 50;
    }
    return { ...r, score };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

  results.push({
    seedId,
    provider,
    directHit: directHit != null,
    lookupId: lookupId !== seedId ? lookupId : null,
    candidates: scored,
  });
});

// Print results grouped by status
console.log("=== DIRECT HITS (no mapping needed) ===\n");
results.filter(r => r.directHit).forEach(r => {
  console.log(`  ${r.seedId}`);
});

console.log("\n=== ALIAS HIT (existing mapping works) ===\n");
results.filter(r => !r.directHit && r.candidates.length === 0).forEach(r => {
  console.log(`  ${r.seedId}  →  ${r.lookupId}  (already in aliases)`);
});

console.log("\n=== NEED MAPPING (top candidates) ===\n");
results.filter(r => !r.directHit && r.candidates.length > 0).forEach(r => {
  console.log(`  seed: ${r.seedId}`);
  r.candidates.forEach(c => {
    const flag = c.normalized_id === r.seedId ? " ★EXACT" : "";
    console.log(`    → ${c.normalized_id.padEnd(52)} "${c.name}" score=${c.score}${flag}`);
  });
  console.log("");
});

console.log("\n=== NO CANDIDATES AT ALL ===\n");
results.filter(r => !r.directHit && r.candidates.length === 0 && !r.lookupId).forEach(r => {
  console.log(`  ${r.seedId} (org: ${r.provider})`);
});

// Summary stats
const direct = results.filter(r => r.directHit).length;
const aliasOk = results.filter(r => !r.directHit && r.lookupId && r.candidates.length === 0).length;
const needMapping = results.filter(r => !r.directHit && r.candidates.length > 0).length;
const noCandidates = results.filter(r => !r.directHit && r.lookupId && r.candidates.length === 0).length + results.filter(r => !r.directHit && r.candidates.length === 0 && !r.lookupId).length;
console.log(`\nSummary: direct=${direct}, aliasOK=${aliasOk}, needMapping=${needMapping}, noCandidates=${results.filter(r => !r.directHit && r.candidates.length === 0 && !r.lookupId).length}`);
