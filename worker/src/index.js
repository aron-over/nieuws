// Cloudflare Worker: haalt het nieuws op bij een verzoek en bewaart het 30 minuten in de cache.
// Geen cron en geen AI: de feeds worden pas opgehaald als iemand de pagina opent.

import config from "../../feeds.json";
import { loadArticles } from "../../lib/news.mjs";

const CACHE_SECONDS = 1800;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

export default {
  async fetch(request, env, ctx) {
    const cache = caches.default;
    const cacheKey = new Request("https://nieuws-cache.internal/news-v3");

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const articles = await loadArticles(config.feeds, config.maxPerFeed);
    const body = JSON.stringify({ updatedAt: new Date().toISOString(), articles });

    const response = new Response(body, {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      },
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
