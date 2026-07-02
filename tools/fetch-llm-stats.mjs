import { mkdirSync, writeFileSync } from "node:fs";

const url = "https://llm-stats.com/leaderboards/llm-leaderboard";
const res = await fetch(url);
if (!res.ok) {
  throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
}

const html = await res.text();
mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/llm-stats.html", html);

const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) => m[0]);
writeFileSync("tmp/llm-stats-chunks.txt", [...new Set(chunks)].join("\n"));

console.log(`Saved tmp/llm-stats.html (${html.length} chars)`);
console.log(`Found ${new Set(chunks).size} JS chunks`);
