import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { abilityScoresFromLlmStats, averageScore } from "./score-utils.mjs";
import { benchmarkLookupId } from "./model-benchmark-aliases.mjs";

const db = new Database(join(homedir(), ".minirouter", "minirouter.db"));
const seedModels = JSON.parse(readFileSync("models/seed-data.json", "utf8"));
const seedIds = new Set(seedModels.map((model) => model.id));
const now = new Date().toISOString();

function cleanScore(value) {
  return value === 0 || value == null ? null : value;
}

function snapshot(label) {
  console.log(`\n## ${label}`);
  console.table(
    db
      .prepare(
        `
        select
          type,
          count(*) as n,
          sum(case when notes like 'Imported from LLM Stats%' then 1 else 0 end) as imported
        from model_scores
        group by type
        order by n desc
      `,
      )
      .all(),
  );
}

const updateSeed = db.prepare(
  `
  update model_scores
  set
    provider = @provider,
    display_name = @display_name,
    type = @type,
    price_input = @price_input,
    price_output = @price_output,
    price_cache_hit = @price_cache_hit,
    score_coding = @score_coding,
    score_reasoning = @score_reasoning,
    score_chinese = @score_chinese,
    score_creative = @score_creative,
    score_speed = @score_speed,
    score_overall = @score_overall,
    has_vision = @has_vision,
    has_video = @has_video,
    has_audio = @has_audio,
    context_window = @context_window,
    max_output = @max_output,
    supports_tools = @supports_tools,
    supports_json = @supports_json,
    is_active = @is_active,
    release_date = @release_date,
    notes = @notes,
    verified = @verified,
    updated_at = @updated_at
  where id = @id
`,
);

const insertSeed = db.prepare(
  `
  insert into model_scores (
    id, provider, display_name, type,
    price_input, price_output, price_cache_hit,
    score_coding, score_reasoning, score_chinese, score_creative, score_speed, score_overall,
    has_vision, has_video, has_audio,
    context_window, max_output, supports_tools, supports_json,
    is_active, priority, release_date, notes, verified, created_at, updated_at
  ) values (
    @id, @provider, @display_name, @type,
    @price_input, @price_output, @price_cache_hit,
    @score_coding, @score_reasoning, @score_chinese, @score_creative, @score_speed, @score_overall,
    @has_vision, @has_video, @has_audio,
    @context_window, @max_output, @supports_tools, @supports_json,
    @is_active, @priority, @release_date, @notes, @verified, @created_at, @updated_at
  )
`,
);

const exists = db.prepare("select 1 from model_scores where id = ? limit 1");
const rawById = db.prepare("select * from llm_stats_models where normalized_id = ? limit 1");

function seedValues(model) {
  const benchmarkId = benchmarkLookupId(model.id);
  const raw = rawById.get(benchmarkId);
  const ability = raw ? abilityScoresFromLlmStats(raw) : {
    coding: cleanScore(model.scores?.coding),
    reasoning: cleanScore(model.scores?.reasoning),
    chinese: cleanScore(model.scores?.chinese),
    overall: null,
  };
  const creative = cleanScore(model.scores?.creative);
  const speed = cleanScore(model.scores?.speed);
  const overall = ability.overall ?? averageScore([ability.coding, ability.reasoning, ability.chinese, creative]);

  return {
    id: model.id,
    provider: model.provider,
    display_name: model.displayName,
    type: model.type,
    price_input: model.pricing?.input ?? null,
    price_output: model.pricing?.output ?? null,
    price_cache_hit: model.pricing?.cacheHit ?? null,
    score_coding: ability.coding,
    score_reasoning: ability.reasoning,
    score_chinese: ability.chinese,
    score_creative: creative,
    score_speed: speed,
    score_overall: overall,
    has_vision: model.multimodal?.vision ? 1 : 0,
    has_video: model.multimodal?.video ? 1 : 0,
    has_audio: model.multimodal?.audio ? 1 : 0,
    context_window: model.specs?.contextWindow ?? null,
    max_output: model.specs?.maxOutput ?? null,
    supports_tools: model.specs?.supportsTools ? 1 : 0,
    supports_json: model.specs?.supportsJson ? 1 : 0,
    is_active: model.isActive ? 1 : 0,
    priority: model.priority ?? 0,
    release_date: model.releaseDate ?? null,
    notes: raw
      ? `${model.notes ?? ""} Benchmark enriched from LLM Stats targeted source: ${benchmarkId}.`.trim()
      : (model.notes ?? null),
    verified: model.verified ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
}

snapshot("before");

const tx = db.transaction(() => {
  db
    .prepare(
      `
      delete from model_scores
      where notes like 'Imported from LLM Stats%'
        and id not in (${[...seedIds].map(() => "?").join(",")})
    `,
    )
    .run([...seedIds]);

  for (const model of seedModels) {
    const values = seedValues(model);
    if (exists.get(model.id)) updateSeed.run(values);
    else insertSeed.run(values);
  }
});

tx();

snapshot("after");

console.log("\n## selected rows");
console.table(
  db
    .prepare(
      `
      select id, provider, display_name, type, score_coding, score_reasoning, score_overall, notes
      from model_scores
      where id in (
        'alibaba/qwen3-coder-plus',
        'zhipu/glm-4.7-flash',
        'zhipu/glm-4.5',
        'deepseek/deepseek-r1-0528',
        'openai/gpt-5.5',
        'anthropic/claude-opus-4.8',
        'google/gemini-3-flash'
      )
      order by type, provider, display_name
    `,
    )
    .all(),
);
