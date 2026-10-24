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
  volgens aldus vooral zeggen zegt zei zeiden gaat gaan ging gingen komt komen kwam kwamen`
    .split(/\s+/),
);

export function tokenize(article) {
  const text = `${article.title} ${article.summary ?? ""}`.toLowerCase();
  const words = text.match(/\p{L}{3,}/gu) ?? [];
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

export function weightsFrom(votes) {
  const weights = new Map();
  for (const { v, tokens } of Object.values(votes)) {
    for (const token of tokens) weights.set(token, (weights.get(token) ?? 0) + v);
  }
  return weights;
}

// Score van een artikel: som van de woordgewichten, gedeeld door de wortel van het aantal woorden.
export function scoreOf(article, weights) {
  const tokens = tokenize(article);
  if (!tokens.length) return 0;
  let sum = 0;
  for (const token of tokens) sum += weights.get(token) ?? 0;
  return sum / Math.sqrt(tokens.length);
}

// Nieuwere artikelen krijgen een bonus, zodat het nieuws van vandaag niet wegzakt.
export function rankOf(article, weights) {
  const hours = article.published ? (Date.now() - new Date(article.published)) / 3600000 : 48;
  return scoreOf(article, weights) + 1.5 * Math.exp(-Math.max(0, hours) / 24);
}
