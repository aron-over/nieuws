// Haalt de RSS-feeds uit feeds.json op en schrijft ze naar data/news.json.
// Gebruik: node scripts/fetch-news.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArticles } from "../lib/news.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const config = JSON.parse(await readFile(join(root, "feeds.json"), "utf8"));
const articles = await loadArticles(config.feeds, config.maxPerFeed);

await mkdir(join(root, "data"), { recursive: true });
await writeFile(
  join(root, "data", "news.json"),
  JSON.stringify({ updatedAt: new Date().toISOString(), articles }, null, 2),
);
console.log(`${articles.length} artikelen opgeslagen in data/news.json`);
