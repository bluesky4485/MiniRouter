import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const chunks = readFileSync("tmp/llm-stats-chunks.txt", "utf-8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

mkdirSync("tmp/llm-stats-chunks", { recursive: true });

for (const chunk of chunks) {
  const url = new URL(chunk, "https://llm-stats.com").toString();
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed ${res.status}: ${url}`);
    continue;
  }
  const text = await res.text();
  writeFileSync(`tmp/llm-stats-chunks/${basename(chunk)}`, text);
}

console.log(`Saved ${chunks.length} chunks`);
