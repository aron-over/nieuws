// Haalt de RSS-feeds uit feeds.json op en schrijft ze naar data/news.json.
// Gebruik: node scripts/fetch-news.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const config = JSON.parse(await readFile(join(root, "feeds.json"), "utf8"));
const maxPerFeed = config.maxPerFeed ?? 25;

function decode(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decode(match[1]) : "";
}

function parseItems(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return blocks.map((block) => {
    const link = tag(block, "link") || (block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "");
    const date = tag(block, "pubDate") || tag(block, "dc:date");
    return {
      title: tag(block, "title"),
      link,
      summary: tag(block, "description").slice(0, 300),
      published: date ? new Date(date).toISOString() : null,
    };
  });
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseItems(await res.text()).slice(0, maxPerFeed);
    console.log(`✓ ${feed.name}: ${items.length} items`);
    return items.map((item) => ({ ...item, source: feed.name, topic: feed.topic }));
  } catch (error) {
    console.warn(`✗ ${feed.name}: ${error.message}`);
    return [];
  }
}

const results = await Promise.all(config.feeds.map(fetchFeed));
const articles = results
  .flat()
  .filter((a) => a.title && a.link)
  .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));

await mkdir(join(root, "data"), { recursive: true });
await writeFile(
  join(root, "data", "news.json"),
  JSON.stringify({ updatedAt: new Date().toISOString(), articles }, null, 2),
);
console.log(`\n${articles.length} artikelen opgeslagen in data/news.json`);
