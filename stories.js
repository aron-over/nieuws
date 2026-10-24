// Voegt artikelen over hetzelfde verhaal samen tot één "verhaal", en herkent groot nieuws:
// een verhaal dat door meerdere uitgevers wordt gebracht. Geen AI: alleen woordvergelijking.

import { tokenize } from "./learn.js";

// Twee artikelen zijn hetzelfde verhaal bij een sterke overeenkomst in titel of tekst, of bij een
// redelijke overeenkomst in allebei als ze van verschillende uitgevers komen. Getest op echte data:
// lager geeft valse koppels (bv. twee losse Disneyland-artikelen van Looopings).
const STRONG = 0.3;
const MODERATE = 0.17;
export const IMPORTANT_PUBLISHERS = 3; // vanaf zoveel verschillende uitgevers telt iets als groot nieuws

// "NU.nl Algemeen" en "NU.nl Tech" zijn dezelfde uitgever.
export function publisherOf(article) {
  return article.source.replace(/\s+(Algemeen|Tech)$/, "");
}

// Gewogen overeenkomst: zeldzame woorden (bv. "Adelaarsnest") tellen zwaarder dan veelvoorkomende.
function vectorize(sets) {
  const df = new Map();
  for (const set of sets) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map([...df].map(([t, n]) => [t, Math.log((sets.length + 1) / n)]));
  return sets.map((set) => ({
    set,
    idf,
    norm: [...set].reduce((sum, t) => sum + idf.get(t) ** 2, 0) || 1,
  }));
}

function similarity(a, b) {
  let shared = 0;
  for (const t of a.set) if (b.set.has(t)) shared += a.idf.get(t) ** 2;
  return shared / Math.sqrt(a.norm * b.norm);
}

export function buildStories(articles) {
  const titles = vectorize(articles.map((a) => new Set(tokenize({ title: a.title, summary: "" }))));
  const texts = vectorize(articles.map((a) => new Set(tokenize(a))));
  const publishers = articles.map(publisherOf);

  // Union-find: losse paren worden zo één verhaal (A lijkt op B, B op C → A, B en C samen).
  const parent = articles.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const title = similarity(titles[i], titles[j]);
      const text = similarity(texts[i], texts[j]);
      const same =
        title >= STRONG ||
        text >= STRONG ||
        (title >= MODERATE && text >= MODERATE && publishers[i] !== publishers[j]);
      if (same) parent[find(i)] = find(j);
    }
  }

  const groups = new Map();
  articles.forEach((article, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(article);
  });

  return [...groups.values()].map((members) => {
    // Hoofdartikel: met afbeelding en de langste samenvatting.
    const primary = [...members].sort(
      (x, y) => Number(!!y.image) - Number(!!x.image) || (y.summary?.length ?? 0) - (x.summary?.length ?? 0),
    )[0];
    const newest = members.reduce((max, a) => ((a.published ?? "") > max ? a.published : max), "");
    return {
      id: primary.link,
      primary,
      articles: members,
      publishers: new Set(members.map(publisherOf)).size,
      published: newest || null,
      topic: primary.topic,
    };
  });
}
