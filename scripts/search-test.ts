// Quick retrieval check:  npx tsx scripts/search-test.ts "quanti anni di esperienza servono?"
import fs from "node:fs";
import { searchBandi } from "../src/lib/search";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

async function main() {
  const query = process.argv[2] ?? "requisiti di esperienza";
  const results = await searchBandi(query, process.argv[3]);
  for (const r of results) {
    console.log(`[${r.score.toFixed(4)}] ${r.document_slug} p.${r.page}: ${r.content.slice(0, 140).replace(/\n/g, " ")}`);
  }
}

main();
