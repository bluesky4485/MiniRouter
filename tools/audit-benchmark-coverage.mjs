import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const db = new Database(join(homedir(), ".minirouter", "minirouter.db"), { readonly: true });

function print(title, rows) {
  console.log(`\n## ${title}`);
  console.table(rows);
}

print(
  "coverage by type",
  db
    .prepare(
      `
      select
        ms.type,
        count(*) as models,
        sum(case when raw.model_id is not null then 1 else 0 end) as direct_raw_matches,
        sum(case when raw.swe_bench_verified_score is not null or raw.swe_bench_pro_score is not null or raw.scicode_score is not null or raw.coding_arena_score is not null or raw.index_code is not null then 1 else 0 end) as has_code_signal,
        sum(case when raw.gpqa_score is not null or raw.aime_2025_score is not null or raw.hle_score is not null or raw.frontiermath_score is not null or raw.index_reasoning is not null or raw.index_math is not null then 1 else 0 end) as has_reasoning_signal,
        sum(case when raw.mmmlu_score is not null then 1 else 0 end) as has_multilingual_signal
      from model_scores ms
      left join llm_stats_models raw on raw.normalized_id = ms.id
      group by ms.type
      order by models desc
    `,
    )
    .all(),
);

print(
  "domestic models without direct raw match",
  db
    .prepare(
      `
      select ms.id, ms.provider, ms.display_name, ms.notes
      from model_scores ms
      left join llm_stats_models raw on raw.normalized_id = ms.id
      where ms.type = 'domestic' and raw.model_id is null
      order by ms.provider, ms.display_name
      limit 80
    `,
    )
    .all(),
);

print(
  "candidate raw matches for unmatched seed ids",
  db
    .prepare(
      `
      select normalized_id, name, organization_id,
        swe_bench_verified_score, swe_bench_pro_score, scicode_score, coding_arena_score,
        gpqa_score, aime_2025_score, hle_score, mmmlu_score
      from llm_stats_models
      where organization_id in ('qwen', 'zai-org', 'zai', 'deepseek', 'moonshotai', 'minimax')
      order by organization_id, name
      limit 120
    `,
    )
    .all(),
);
