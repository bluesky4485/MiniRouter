import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { abilityScoresFromLlmStats } from "./score-utils.mjs";

const SOURCES = {
  models: "https://api.zeroeval.com/leaderboard/models/list",
  fullModels: "https://api.zeroeval.com/leaderboard/models/full?justCanonicals=true",
  metrics: "https://api.zeroeval.com/v1/models/metrics",
};

function nowIso() {
  return new Date().toISOString();
}

async function fetchJson(name, url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "MiniRouter model registry updater",
    },
  });
  if (!res.ok) {
    throw new Error(`${name} fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function normalizeProvider(org) {
  const map = {
    qwen: "Alibaba / Qwen",
    zai: "Zhipu / ZAI",
    "zai-org": "Zhipu / ZAI",
    deepseek: "DeepSeek",
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    moonshotai: "Moonshot AI",
    minimax: "MiniMax",
    xai: "xAI",
    meta: "Meta",
    mistral: "Mistral",
  };
  return map[org.organization_id] ?? org.name ?? org.organization_id;
}

function normalizeId(orgId, modelId) {
  const providerPrefix = {
    qwen: "alibaba",
    zai: "zhipu",
    "zai-org": "zhipu",
    moonshotai: "moonshot",
    openai: "openai",
    anthropic: "anthropic",
    google: "google",
    deepseek: "deepseek",
    minimax: "minimax",
    xai: "xai",
    meta: "meta",
    mistral: "mistral",
  }[orgId] ?? orgId;
  return `${providerPrefix}/${modelId}`;
}

function modelType(orgId) {
  const domestic = new Set([
    "qwen",
    "zai",
    "zai-org",
    "deepseek",
    "moonshotai",
    "minimax",
    "stepfun",
    "baidu",
  ]);
  const international = new Set(["openai", "anthropic", "google", "meta", "mistral", "xai", "ai21"]);
  if (domestic.has(orgId)) return "domestic";
  if (international.has(orgId)) return "international";
  return "candidate";
}

function nullishObject(obj) {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, value === undefined ? null : value]));
}

const [modelGroups, fullModels, metrics] = await Promise.all([
  fetchJson("models", SOURCES.models),
  fetchJson("fullModels", SOURCES.fullModels),
  fetchJson("metrics", SOURCES.metrics),
]);

mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/llm-stats-models-list.json", JSON.stringify(modelGroups, null, 2));
writeFileSync("tmp/llm-stats-models-full.json", JSON.stringify(fullModels, null, 2));
writeFileSync("tmp/llm-stats-metrics.json", JSON.stringify(metrics, null, 2));

const metricById = new Map(metrics.map((m) => [m.model_id, m]));
const rows = [];
for (const model of fullModels) {
  const metric = metricById.get(model.model_id);
  const ability = abilityScoresFromLlmStats(model);
  rows.push({
    id: normalizeId(model.organization_id, model.model_id),
    provider: model.organization ?? model.organization_id,
    display_name: model.name,
    type: modelType(model.organization_id),
    price_input: model.input_price,
    price_output: model.output_price,
    price_cache_hit: null,
    peak_multiplier: null,
    peak_hours: null,
    token_plan: null,
    score_coding: ability.coding,
    score_reasoning: ability.reasoning,
    score_chinese: ability.chinese,
    score_creative: null,
    score_speed: metric?.avg_throughput ? Math.round(Math.min(100, metric.avg_throughput / 4)) : null,
    score_overall: ability.overall,
    has_vision: model.multimodal ? 1 : 0,
    has_video: 0,
    has_audio: 0,
    context_window: model.context,
    max_output: null,
    supports_tools: model.toolathlon_score != null || model.mcp_atlas_score != null ? 1 : 0,
    supports_json: 0,
    or_rank: null,
    or_weekly_volume: null,
    or_weekly_change: null,
    is_active: 1,
    priority: 0,
    release_date: model.release_date,
    notes: [
      "Imported from LLM Stats full leaderboard.",
      model.license ? `license=${model.license}` : null,
      model.organization_country ? `country=${model.organization_country}` : null,
      metric ? `avg_throughput=${metric.avg_throughput}; p95_latency=${metric.p95_latency}; failure_rate=${metric.failure_rate}` : null,
    ].filter(Boolean).join(" "),
    verified: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
}

writeFileSync("tmp/llm-stats-normalized-models.json", JSON.stringify(rows, null, 2));

const dbPath = join(homedir(), ".minirouter", "minirouter.db");
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS model_scores (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'domestic',
  price_input REAL,
  price_output REAL,
  price_cache_hit REAL,
  peak_multiplier REAL,
  peak_hours TEXT,
  token_plan TEXT,
  score_coding INTEGER DEFAULT 0,
  score_reasoning INTEGER DEFAULT 0,
  score_chinese INTEGER DEFAULT 0,
  score_creative INTEGER DEFAULT 0,
  score_speed INTEGER DEFAULT 0,
  score_overall INTEGER DEFAULT 0,
  has_vision INTEGER DEFAULT 0,
  has_video INTEGER DEFAULT 0,
  has_audio INTEGER DEFAULT 0,
  context_window INTEGER,
  max_output INTEGER,
  supports_tools INTEGER DEFAULT 0,
  supports_json INTEGER DEFAULT 0,
  or_rank INTEGER,
  or_weekly_volume TEXT,
  or_weekly_change TEXT,
  is_active INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  release_date TEXT,
  notes TEXT,
  verified INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_type ON model_scores(type);
CREATE INDEX IF NOT EXISTS idx_model_provider ON model_scores(provider);
CREATE INDEX IF NOT EXISTS idx_model_active ON model_scores(is_active);

CREATE TABLE IF NOT EXISTS llm_stats_models (
  model_id TEXT PRIMARY KEY,
  normalized_id TEXT NOT NULL,
  name TEXT NOT NULL,
  organization TEXT,
  organization_id TEXT,
  organization_country TEXT,
  license TEXT,
  params REAL,
  training_tokens REAL,
  context INTEGER,
  release_date TEXT,
  announcement_date TEXT,
  knowledge_cutoff TEXT,
  multimodal INTEGER DEFAULT 0,
  input_price REAL,
  output_price REAL,
  throughput REAL,
  latency REAL,
  coding_arena_score REAL,
  index_reasoning REAL,
  index_math REAL,
  index_code REAL,
  index_search REAL,
  index_communication REAL,
  index_vision REAL,
  index_tool_calling REAL,
  index_long_context REAL,
  index_finance REAL,
  index_legal REAL,
  index_healthcare REAL,
  gpqa_score REAL,
  aime_2025_score REAL,
  swe_bench_verified_score REAL,
  arc_agi_v2_score REAL,
  mmmlu_score REAL,
  mmmu_score REAL,
  browsecomp_score REAL,
  charxiv_r_score REAL,
  mmmu_pro_score REAL,
  screenspot_pro_score REAL,
  mcp_atlas_score REAL,
  hle_score REAL,
  simpleqa_score REAL,
  osworld_score REAL,
  toolathlon_score REAL,
  terminal_bench_score REAL,
  tau_bench_retail_score REAL,
  frontiermath_score REAL,
  mrcr_v2_score REAL,
  scicode_score REAL,
  apex_agents_score REAL,
  swe_bench_pro_score REAL,
  raw_json TEXT NOT NULL,
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_stats_org ON llm_stats_models(organization_id);
CREATE INDEX IF NOT EXISTS idx_llm_stats_release ON llm_stats_models(release_date);
`);

const columns = Object.keys(rows[0]);
const updateColumns = columns.filter((c) => c !== "id" && c !== "created_at");
const stmt = db.prepare(`
INSERT INTO model_scores (${columns.join(", ")})
VALUES (${columns.map((c) => `@${c}`).join(", ")})
ON CONFLICT(id) DO UPDATE SET
${updateColumns.map((c) => `${c}=excluded.${c}`).join(",\n")}
`);

const tx = db.transaction((items) => {
  db.prepare("DELETE FROM model_scores WHERE notes LIKE 'Imported from LLM Stats%'").run();
  for (const item of items) stmt.run(item);
});
tx(rows);

const fullStmt = db.prepare(`
INSERT INTO llm_stats_models (
  model_id, normalized_id, name, organization, organization_id, organization_country, license,
  params, training_tokens, context, release_date, announcement_date, knowledge_cutoff, multimodal,
  input_price, output_price, throughput, latency, coding_arena_score,
  index_reasoning, index_math, index_code, index_search, index_communication, index_vision,
  index_tool_calling, index_long_context, index_finance, index_legal, index_healthcare,
  gpqa_score, aime_2025_score, swe_bench_verified_score, arc_agi_v2_score, mmmlu_score,
  mmmu_score, browsecomp_score, charxiv_r_score, mmmu_pro_score, screenspot_pro_score,
  mcp_atlas_score, hle_score, simpleqa_score, osworld_score, toolathlon_score,
  terminal_bench_score, tau_bench_retail_score, frontiermath_score, mrcr_v2_score,
  scicode_score, apex_agents_score, swe_bench_pro_score, raw_json, source_url, imported_at
) VALUES (
  @model_id, @normalized_id, @name, @organization, @organization_id, @organization_country, @license,
  @params, @training_tokens, @context, @release_date, @announcement_date, @knowledge_cutoff, @multimodal,
  @input_price, @output_price, @throughput, @latency, @coding_arena_score,
  @index_reasoning, @index_math, @index_code, @index_search, @index_communication, @index_vision,
  @index_tool_calling, @index_long_context, @index_finance, @index_legal, @index_healthcare,
  @gpqa_score, @aime_2025_score, @swe_bench_verified_score, @arc_agi_v2_score, @mmmlu_score,
  @mmmu_score, @browsecomp_score, @charxiv_r_score, @mmmu_pro_score, @screenspot_pro_score,
  @mcp_atlas_score, @hle_score, @simpleqa_score, @osworld_score, @toolathlon_score,
  @terminal_bench_score, @tau_bench_retail_score, @frontiermath_score, @mrcr_v2_score,
  @scicode_score, @apex_agents_score, @swe_bench_pro_score, @raw_json, @source_url, @imported_at
)
ON CONFLICT(model_id) DO UPDATE SET
  normalized_id=excluded.normalized_id,
  name=excluded.name,
  organization=excluded.organization,
  organization_id=excluded.organization_id,
  organization_country=excluded.organization_country,
  license=excluded.license,
  params=excluded.params,
  training_tokens=excluded.training_tokens,
  context=excluded.context,
  release_date=excluded.release_date,
  announcement_date=excluded.announcement_date,
  knowledge_cutoff=excluded.knowledge_cutoff,
  multimodal=excluded.multimodal,
  input_price=excluded.input_price,
  output_price=excluded.output_price,
  throughput=excluded.throughput,
  latency=excluded.latency,
  coding_arena_score=excluded.coding_arena_score,
  index_reasoning=excluded.index_reasoning,
  index_math=excluded.index_math,
  index_code=excluded.index_code,
  index_search=excluded.index_search,
  index_communication=excluded.index_communication,
  index_vision=excluded.index_vision,
  index_tool_calling=excluded.index_tool_calling,
  index_long_context=excluded.index_long_context,
  index_finance=excluded.index_finance,
  index_legal=excluded.index_legal,
  index_healthcare=excluded.index_healthcare,
  gpqa_score=excluded.gpqa_score,
  aime_2025_score=excluded.aime_2025_score,
  swe_bench_verified_score=excluded.swe_bench_verified_score,
  arc_agi_v2_score=excluded.arc_agi_v2_score,
  mmmlu_score=excluded.mmmlu_score,
  mmmu_score=excluded.mmmu_score,
  browsecomp_score=excluded.browsecomp_score,
  charxiv_r_score=excluded.charxiv_r_score,
  mmmu_pro_score=excluded.mmmu_pro_score,
  screenspot_pro_score=excluded.screenspot_pro_score,
  mcp_atlas_score=excluded.mcp_atlas_score,
  hle_score=excluded.hle_score,
  simpleqa_score=excluded.simpleqa_score,
  osworld_score=excluded.osworld_score,
  toolathlon_score=excluded.toolathlon_score,
  terminal_bench_score=excluded.terminal_bench_score,
  tau_bench_retail_score=excluded.tau_bench_retail_score,
  frontiermath_score=excluded.frontiermath_score,
  mrcr_v2_score=excluded.mrcr_v2_score,
  scicode_score=excluded.scicode_score,
  apex_agents_score=excluded.apex_agents_score,
  swe_bench_pro_score=excluded.swe_bench_pro_score,
  raw_json=excluded.raw_json,
  source_url=excluded.source_url,
  imported_at=excluded.imported_at
`);

const fullColumns = [
  "model_id",
  "normalized_id",
  "name",
  "organization",
  "organization_id",
  "organization_country",
  "license",
  "params",
  "training_tokens",
  "context",
  "release_date",
  "announcement_date",
  "knowledge_cutoff",
  "multimodal",
  "input_price",
  "output_price",
  "throughput",
  "latency",
  "coding_arena_score",
  "index_reasoning",
  "index_math",
  "index_code",
  "index_search",
  "index_communication",
  "index_vision",
  "index_tool_calling",
  "index_long_context",
  "index_finance",
  "index_legal",
  "index_healthcare",
  "gpqa_score",
  "aime_2025_score",
  "swe_bench_verified_score",
  "arc_agi_v2_score",
  "mmmlu_score",
  "mmmu_score",
  "browsecomp_score",
  "charxiv_r_score",
  "mmmu_pro_score",
  "screenspot_pro_score",
  "mcp_atlas_score",
  "hle_score",
  "simpleqa_score",
  "osworld_score",
  "toolathlon_score",
  "terminal_bench_score",
  "tau_bench_retail_score",
  "frontiermath_score",
  "mrcr_v2_score",
  "scicode_score",
  "apex_agents_score",
  "swe_bench_pro_score",
  "raw_json",
  "source_url",
  "imported_at",
];

function completeFullRow(row) {
  return Object.fromEntries(fullColumns.map((column) => [column, row[column] ?? null]));
}

const fullTx = db.transaction((items) => {
  for (const model of items) {
    const metric = metricById.get(model.model_id);
    fullStmt.run(
      nullishObject(
        completeFullRow({
          ...model,
          normalized_id: normalizeId(model.organization_id, model.model_id),
          multimodal: model.multimodal ? 1 : 0,
          throughput:
            metric?.avg_throughput && metric.avg_throughput > 0
              ? metric.avg_throughput
              : model.throughput,
          latency: metric?.p95_latency && metric.p95_latency > 0 ? metric.p95_latency : model.latency,
          raw_json: JSON.stringify(model),
          source_url: SOURCES.fullModels,
          imported_at: nowIso(),
        }),
      ),
    );
  }
});
fullTx(fullModels);

console.log(`Fetched organizations: ${modelGroups.length}`);
console.log(`Fetched listed models: ${modelGroups.reduce((sum, org) => sum + (org.models?.length ?? 0), 0)}`);
console.log(`Fetched full leaderboard models: ${fullModels.length}`);
console.log(`Fetched metrics: ${metrics.length}`);
console.log(`Updated database: ${dbPath}`);
