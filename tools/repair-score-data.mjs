import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { abilityScoresFromLlmStats, averageScore } from "./score-utils.mjs";

const db = new Database(join(homedir(), ".minirouter", "minirouter.db"));
const now = new Date().toISOString();

function cleanScore(value) {
  return value === 0 || value == null ? null : value;
}

const importedRows = db
  .prepare(
    `
    select
      ms.id,
      raw.swe_bench_verified_score,
      raw.swe_bench_pro_score,
      raw.scicode_score,
      raw.gpqa_score,
      raw.aime_2025_score,
      raw.hle_score,
      raw.mmmlu_score,
      raw.throughput
    from model_scores ms
    join llm_stats_models raw on raw.normalized_id = ms.id
    where ms.notes like 'Imported from LLM Stats%'
  `,
  )
  .all();

const updateImported = db.prepare(
  `
  update model_scores
  set
    score_coding = @coding,
    score_reasoning = @reasoning,
    score_chinese = @chinese,
    score_creative = null,
    score_speed = @speed,
    score_overall = @overall,
    updated_at = @updatedAt
  where id = @id
`,
);

const updateCurated = db.prepare(
  `
  update model_scores
  set
    score_coding = @coding,
    score_reasoning = @reasoning,
    score_chinese = @chinese,
    score_creative = @creative,
    score_speed = @speed,
    score_overall = @overall,
    updated_at = @updatedAt
  where id = @id
`,
);

const tx = db.transaction(() => {
  for (const row of importedRows) {
    const ability = abilityScoresFromLlmStats(row);
    updateImported.run({
      id: row.id,
      coding: ability.coding,
      reasoning: ability.reasoning,
      chinese: ability.chinese,
      speed: row.throughput ? Math.round(Math.min(100, row.throughput / 4)) : null,
      overall: ability.overall,
      updatedAt: now,
    });
  }

  const curatedRows = db
    .prepare(
      `
      select id, score_coding, score_reasoning, score_chinese, score_creative, score_speed
      from model_scores
      where notes not like 'Imported from LLM Stats%' or notes is null
    `,
    )
    .all();

  for (const row of curatedRows) {
    const coding = cleanScore(row.score_coding);
    const reasoning = cleanScore(row.score_reasoning);
    const chinese = cleanScore(row.score_chinese);
    const creative = cleanScore(row.score_creative);
    const speed = cleanScore(row.score_speed);
    updateCurated.run({
      id: row.id,
      coding,
      reasoning,
      chinese,
      creative,
      speed,
      overall: averageScore([coding, reasoning, chinese, creative]),
      updatedAt: now,
    });
  }
});

tx();

console.log(`Repaired imported rows: ${importedRows.length}`);
console.log(
  db
    .prepare(
      `
      select
        count(*) as rows,
        sum(case when score_coding = 0 then 1 else 0 end) as coding_zero,
        sum(case when score_reasoning = 0 then 1 else 0 end) as reasoning_zero,
        sum(case when score_overall = 0 then 1 else 0 end) as overall_zero,
        sum(case when score_coding is null then 1 else 0 end) as coding_null,
        sum(case when score_reasoning is null then 1 else 0 end) as reasoning_null,
        sum(case when score_overall is null then 1 else 0 end) as overall_null
      from model_scores
    `,
    )
    .get(),
);
