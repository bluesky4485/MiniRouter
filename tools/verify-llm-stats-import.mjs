import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const db = new Database(join(homedir(), ".minirouter", "minirouter.db"));

console.log("model_scores", db.prepare("select count(*) as n from model_scores").get());
console.log("llm_stats_models", db.prepare("select count(*) as n from llm_stats_models").get());
console.log(
  "zhipu summaries",
  db
    .prepare(
      "select id, provider, display_name, price_input, price_output, score_reasoning, score_coding from model_scores where id like 'zhipu/%' order by display_name limit 8",
    )
    .all(),
);
console.log(
  "full domestic",
  db
    .prepare(
      "select organization_id, count(*) as n from llm_stats_models where organization_id in ('qwen','deepseek','zai-org','moonshotai','minimax') group by organization_id order by n desc",
    )
    .all(),
);
