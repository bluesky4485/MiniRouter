import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const db = new Database(join(homedir(), ".minirouter", "minirouter.db"), { readonly: true });

function print(title, rows) {
  console.log(`\n## ${title}`);
  console.table(rows);
}

print(
  "model_scores summary",
  db
    .prepare(
      `
      select
        count(*) as rows,
        sum(case when score_coding = 0 then 1 else 0 end) as coding_zero,
        sum(case when score_reasoning = 0 then 1 else 0 end) as reasoning_zero,
        sum(case when score_overall = 0 then 1 else 0 end) as overall_zero,
        sum(case when notes like 'Imported from LLM Stats%' then 1 else 0 end) as imported_rows,
        sum(case when notes not like 'Imported from LLM Stats%' or notes is null then 1 else 0 end) as curated_rows
      from model_scores
    `,
    )
    .all(),
);

print(
  "domestic imported top reasoning",
  db
    .prepare(
      `
      select id, display_name, provider, score_reasoning, score_coding, score_overall, notes
      from model_scores
      where type = 'domestic' and notes like 'Imported from LLM Stats%'
      order by score_reasoning desc, score_coding desc
      limit 15
    `,
    )
    .all(),
);

print(
  "selected common-sense check",
  db
    .prepare(
      `
      select
        ms.id,
        ms.display_name,
        ms.provider,
        ms.score_coding,
        ms.score_reasoning,
        ms.score_chinese,
        ms.score_overall,
        raw.swe_bench_verified_score,
        raw.swe_bench_pro_score,
        raw.scicode_score,
        raw.gpqa_score,
        raw.aime_2025_score,
        raw.hle_score,
        raw.mmmlu_score,
        raw.index_code,
        raw.index_reasoning,
        raw.coding_arena_score
      from model_scores ms
      left join llm_stats_models raw on raw.normalized_id = ms.id
      where ms.id in (
        'zhipu/glm-4.5',
        'zhipu/glm-4.5-air',
        'deepseek/deepseek-r1-0528',
        'deepseek/deepseek-v3.1',
        'alibaba/qwen3-coder-plus',
        'alibaba/qwen3-max',
        'moonshot/kimi-k2',
        'openai/gpt-5',
        'anthropic/claude-sonnet-4.5',
        'google/gemini-2.5-pro'
      )
      order by ms.provider, ms.display_name
    `,
    )
    .all(),
);

print(
  "raw index vs displayed score gaps",
  db
    .prepare(
      `
      select
        ms.id,
        ms.display_name,
        ms.provider,
        ms.score_coding,
        raw.index_code,
        raw.coding_arena_score,
        ms.score_reasoning,
        raw.index_reasoning,
        raw.index_math
      from model_scores ms
      join llm_stats_models raw on raw.normalized_id = ms.id
      where ms.notes like 'Imported from LLM Stats%'
        and (
          (raw.index_code is not null and abs(raw.index_code - ms.score_coding) >= 20)
          or (raw.index_reasoning is not null and abs(raw.index_reasoning - ms.score_reasoning) >= 20)
        )
      order by abs(coalesce(raw.index_code, 0) - ms.score_coding)
        + abs(coalesce(raw.index_reasoning, 0) - ms.score_reasoning) desc
      limit 20
    `,
    )
    .all(),
);

print(
  "duplicate display names/providers",
  db
    .prepare(
      `
      select provider, display_name, count(*) as n, group_concat(id, ', ') as ids
      from model_scores
      group by provider, display_name
      having count(*) > 1
      order by n desc, provider, display_name
      limit 20
    `,
    )
    .all(),
);
