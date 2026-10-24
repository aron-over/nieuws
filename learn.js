// Leert van duimpjes: elk woord uit titel en samenvatting krijgt een gewicht.
// Bron en categorie doen bewust niet mee; alleen de inhoud van het artikel telt.
// Alles staat in de localStorage van de browser en er is geen AI of server bij nodig.

const VOTES_KEY = "nieuws.votes.v1";
const MAX_VOTES = 500;
const MAX_TOKENS = 40;

const STOPWORDS = new Set(
  `aan als bij dan dat dit die dus een eens echter niet nog naar nadat omdat onder ook over per tot toen uit van veel voor want waar wat weer wel werd werden wordt worden zal zich zijn zou zonder
  de het een en of maar want dus ik je jij hij zij ze wij we jullie u mij me hem haar ons hun ze
  met op te in is er zo na al nu hoe wie wel heeft hebben had hadden was waren ben bent kan kunnen kon konden moet moeten mag mogen
  meer meest minder alle alles andere ander eerste tweede laatste nieuwe nieuw jaar jaren week weken dag dagen
  volgens aldus vooral zeggen zegt zei zeiden gaat gaan ging gingen komt komen kwam kwamen
  om ja ge ga ie uw nl bij`
    .split(/\s+/),
);

export function tokenize(article) {
  const text = `${article.title} ${article.summary ?? ""}`.toLowerCase();
  const words = text.match(/\p{L}{2,}/gu) ?? [];
  return [...new Set(words.filter((word) => !STOPWORDS.has(word)))].slice(0, MAX_TOKENS);
}

export function loadVotes() {
  try {
    return JSON.parse(localStorage.getItem(VOTES_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveVotes(votes) {
  try {
    localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
  } catch {
    // opslag geblokkeerd: de duimpjes werken dan alleen tot de pagina sluit
  }
}

// Zet of verwijdert een duimpje (+1 of -1) voor een artikel en geeft de nieuwe stemmen terug.
export function castVote(votes, article, value) {
  const next = { ...votes };
  const current = next[article.link]?.v;
  delete next[article.link];
  if (current !== value) next[article.link] = { v: value, tokens: tokenize(article) };

  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_VOTES))) delete next[key];
  return next;
}

// Startstemmen (seed-votes.json) wegen half zo zwaar als eigen duimpjes, zodat jouw smaak wint.
const SEED_FACTOR = 0.5;
const MAX_PRIOR = 3;

export function weightsFrom(votes, seedVotes = {}) {
  const weights = new Map();
  for (const [set, factor] of [[seedVotes, SEED_FACTOR], [votes, 1]]) {
    for (const { v, tokens } of Object.values(set)) {
      for (const token of tokens) weights.set(token, (weights.get(token) ?? 0) + v * factor);
    }
  }
  return weights;
}

// Startgewicht uit interests.json: elke groep telt één keer mee, het totaal is begrensd.
export function priorOf(article, tokens, groups) {
  let sum = 0;
  for (const group of groups) {
    const hit =
      tokens.some((t) => group.exact?.includes(t) || group.prefix?.some((p) => t.startsWith(p))) ||
      (group.titlePattern && new RegExp(group.titlePattern).test(article.title));
    if (hit) sum += group.weight;
  }
  return Math.max(-MAX_PRIOR, Math.min(MAX_PRIOR, sum));
}

// Score van een artikel: geleerd deel (gedeeld door de wortel van het aantal woorden) plus startgewicht.
export function scoreOf(article, weights, groups = []) {
  const tokens = tokenize(article);
  if (!tokens.length) return 0;
  let sum = 0;
  for (const token of tokens) sum += weights.get(token) ?? 0;
  return sum / Math.sqrt(tokens.length) + priorOf(article, tokens, groups);
}

// Sorteert op rang, maar zet artikelen over hetzelfde verhaal (minstens 2 gedeelde woorden met een
// al gekozen artikel) lager, zodat bijvoorbeeld één groot verhaal niet de hele lijst vult.
export function rankedList(articles, weights, groups = []) {
  const pool = articles.map((article) => ({
    article,
    tokens: new Set(tokenize(article)),
    rank: rankOf(article, weights, groups),
    similar: 0,
  }));
  const result = [];
  while (pool.length) {
    let best = 0;
    for (let i = 1; i < pool.length; i++) {
      const value = pool[i].rank - Math.min(9, 2 * pool[i].similar);
      if (value > pool[best].rank - Math.min(9, 2 * pool[best].similar)) best = i;
    }
    const [chosen] = pool.splice(best, 1);
    result.push(chosen.article);
    for (const other of pool) {
      let shared = 0;
      for (const token of other.tokens) if (chosen.tokens.has(token)) shared++;
      if (shared >= 2) other.similar++;
    }
  }
  return result;
}

// Nieuwere artikelen krijgen een bonus, zodat het nieuws van vandaag niet wegzakt.
export function rankOf(article, weights, groups = []) {
  const hours = article.published ? (Date.now() - new Date(article.published)) / 3600000 : 48;
  return scoreOf(article, weights, groups) + 1.5 * Math.exp(-Math.max(0, hours) / 24);
}
