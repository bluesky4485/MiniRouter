import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const db = new Database(join(homedir(), ".minirouter", "minirouter.db"), { readonly: true });

console.log("raw llm_stats coder-like rows");
console.table(
  db
    .prepare(
      `
      select model_id, normalized_id, name, organization_id,
        swe_bench_verified_score, swe_bench_pro_score, scicode_score,
        gpqa_score, aime_2025_score, index_code, index_reasoning, coding_arena_score
      from llm_stats_models
      where lower(model_id) like '%coder%' or lower(name) like '%coder%'
      order by organization_id, name
      limit 80
    `,
    )
    .all(),
);

console.log("dashboard model_scores coder-like rows");
console.table(
  db
    .prepare(
      `
      select id, provider, display_name, score_coding, score_reasoning, score_overall, notes
      from model_scores
      where lower(id) like '%coder%' or lower(display_name) like '%coder%'
      order by provider, display_name
      limit 80
    `,
    )
    .all(),
);
