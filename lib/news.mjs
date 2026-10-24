// Gedeelde logica: haalt RSS-feeds op en zet ze om naar artikelen.
// Gebruikt door scripts/fetch-news.mjs (lokaal) en worker/src/index.js (Cloudflare).

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

// Zoekt een afbeelding in de feed: media:content, media:thumbnail of enclosure.
function imageOf(block) {
  const media = block.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i);
  if (media) return media[1];
  const enclosure = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image\/[^"]*"/i);
  if (enclosure) return enclosure[1];
  const img = block.match(/<img[^>]*src="([^"]+)"/i);
  return img ? decode(img[1]) : null;
}

export function parseItems(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return blocks.map((block) => {
    const link = tag(block, "link") || (block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "");
    const date = tag(block, "pubDate") || tag(block, "dc:date");
    return {
      title: tag(block, "title"),
      link,
      summary: tag(block, "description").slice(0, 1000),
      published: date ? new Date(date).toISOString() : null,
      image: imageOf(block),
    };
  });
}

// hooks (optioneel): onSuccess(feed, items) na een gelukte feed, fallback(feed) geeft items als een feed faalt.
async function fetchFeed(feed, maxPerFeed, hooks) {
  try {
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NieuwsBot/1.0; +https://aron-over.github.io/nieuws/)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // excludeLink: ruis van een bron weglaten, bijvoorbeeld de dagelijkse NRC-puzzels.
    const exclude = feed.excludeLink ? new RegExp(feed.excludeLink) : null;
    const items = parseItems(await res.text())
      .filter((item) => !exclude || !exclude.test(item.link))
      .slice(0, maxPerFeed);
    const articles = items.map((item) => ({ ...item, source: feed.name, topic: feed.topic }));
    await hooks.onSuccess?.(feed, articles);
    return articles;
  } catch (error) {
    console.warn(`✗ ${feed.name}: ${error.message}`);
    return (await hooks.fallback?.(feed)) ?? [];
  }
}

// Haalt alle feeds tegelijk op en geeft de artikelen, nieuwste eerst.
// Artikelen ouder dan maxAgeDays vallen af, zodat een verlopen feed geen oud nieuws laat zien.
export async function loadArticles(feeds, maxPerFeed = 25, maxAgeDays = 7, hooks = {}) {
  const oldest = Date.now() - maxAgeDays * 86400000;
  const results = await Promise.all(feeds.map((feed) => fetchFeed(feed, maxPerFeed, hooks)));
  const seenLinks = new Set();
  return results
    .flat()
    .filter((a) => a.title && a.link)
    .filter((a) => !seenLinks.has(a.link) && seenLinks.add(a.link)) // zelfde artikel in twee feeds
    .filter((a) => !a.published || new Date(a.published).getTime() >= oldest)
    .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
}
