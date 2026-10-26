// Cloudflare Worker: haalt het nieuws op bij een verzoek en bewaart het 30 minuten in de cache.
// Geen cron en geen AI: de feeds worden pas opgehaald als iemand de pagina opent.

import config from "../../feeds.json";
import { loadArticles } from "../../lib/news.mjs";

const CACHE_SECONDS = 1800;
const RETRY_SECONDS = 120; // faalde er een feed, dan snel opnieuw proberen
const FEED_BACKUP_SECONDS = 6 * 3600; // laatste goede versie per feed, voor als een bron even weigert
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

const feedKey = (feed) => new Request(`https://nieuws-cache.internal/feed/${encodeURIComponent(feed.url)}`);

export default {
  async fetch(request, env, ctx) {
    const cache = caches.default;
    const cacheKey = new Request("https://nieuws-cache.internal/news-v8");

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    // NU.nl weigert Cloudflare soms; dan gebruiken we de laatste goede versie van die feed.
    let incomplete = false;
    const articles = await loadArticles(config.feeds, config.maxPerFeed, config.maxAgeDays, {
      onSuccess: (feed, items) =>
        cache.put(
          feedKey(feed),
          new Response(JSON.stringify(items), {
            headers: { "Cache-Control": `public, max-age=${FEED_BACKUP_SECONDS}` },
          }),
        ),
      fallback: async (feed) => {
        incomplete = true;
        const backup = await cache.match(feedKey(feed));
        return backup ? backup.json() : [];
      },
    });
    const body = JSON.stringify({ updatedAt: new Date().toISOString(), articles });

    const response = new Response(body, {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": `public, max-age=${incomplete ? RETRY_SECONDS : CACHE_SECONDS}`,
      },
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
