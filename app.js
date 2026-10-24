import { loadVotes, saveVotes, castVote, weightsFrom, scoreOf, rankedList } from "./learn.js";

// URL van de Cloudflare Worker. Lukt die niet, dan valt de pagina terug op data/news.json uit de repo.
const NEWS_API_URL = "https://nieuws-api.aron-over.workers.dev/";

const TOPICS = ["Alles", "Tech", "Pretparken", "Algemeen"];
const HIDE_BELOW = -1; // artikelen met een lagere score worden niet getoond
const SEEN_KEY = "nieuws.seen.v1";
const MAX_SEEN = 1000;
const REFRESH_AFTER_MS = 10 * 60 * 1000; // opnieuw laden als de app zo lang op de achtergrond stond
const UNDO_MS = 6000;

function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // opslag geblokkeerd: werkt dan alleen tot de pagina sluit
  }
}

async function loadJson(path, fallback) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return fallback;
  }
}

const state = {
  articles: [],
  topic: "Alles",
  query: "",
  openLink: null, // het ene artikel dat openstaat
  order: [], // links in de getoonde volgorde
  seenFrom: -1, // vanaf welke plek in order de al gezien artikelen staan
  orderKey: "", // voor welk filter de volgorde berekend is
  loadId: 0,
  loadedAt: 0,
};

// Startstemmen en interesses staan in de repo; ontbreken ze, dan leert de pagina alleen van jouw duimpjes.
const seedVotes = await loadJson("seed-votes.json", {});
const interests = (await loadJson("interests.json", { groups: [] })).groups;

let votes = loadVotes();
let weights = weightsFrom(votes, seedVotes);
let seen = readStored(SEEN_KEY, {}); // link -> tijdstip waarop je het opende

const listEl = document.getElementById("list");
const topicsEl = document.getElementById("topics");
const statusEl = document.getElementById("status");
const updatedEl = document.getElementById("updated");
const searchEl = document.getElementById("search");
const refreshEl = document.getElementById("refresh");
const toastEl = document.getElementById("toast");

function timeAgo(iso) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} u geleden`;
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

// Gezien = geopend, of een duimpje omhoog gegeven. Die artikelen zakken naar onder.
function isSeen(article) {
  return article.link in seen || votes[article.link]?.v === 1;
}

function markSeen(article) {
  if (article.link in seen) return;
  seen[article.link] = Date.now();
  const links = Object.keys(seen);
  if (links.length > MAX_SEEN) {
    links.sort((a, b) => seen[a] - seen[b]);
    for (const link of links.slice(0, links.length - MAX_SEEN)) delete seen[link];
  }
  writeStored(SEEN_KEY, seen);
}

function renderTopics() {
  topicsEl.replaceChildren(
    ...TOPICS.map((topic) => {
      const button = document.createElement("button");
      button.textContent = topic;
      button.setAttribute("aria-pressed", String(topic === state.topic));
      button.addEventListener("click", () => {
        state.topic = topic;
        render();
      });
      return button;
    }),
  );
}

// Bepaalt wat je ziet en in welke volgorde: relevant nieuws eerst, al gezien nieuws onderaan.
// Bij zoeken zie je alles wat past, ook wat je eerder weg hebt gedaan.
function computeOrder() {
  const query = state.query.trim().toLowerCase();
  const matching = state.articles.filter(
    (a) =>
      (state.topic === "Alles" || a.topic === state.topic) &&
      (!query || a.title.toLowerCase().includes(query) || a.summary.toLowerCase().includes(query)),
  );
  const wanted = query
    ? matching
    : matching.filter((a) => votes[a.link]?.v !== -1 && scoreOf(a, weights, interests) > HIDE_BELOW);

  const fresh = wanted.filter((a) => !isSeen(a));
  const read = wanted
    .filter(isSeen)
    .sort((x, y) => (y.published ?? "").localeCompare(x.published ?? ""));

  state.order = [...rankedList(fresh, weights, interests), ...read].map((a) => a.link);
  state.seenFrom = read.length ? fresh.length : -1;
}

// keepOrder: bij een duimpje of openen blijft alles op zijn plek staan tot je ververst of een filter kiest.
function render({ keepOrder = false } = {}) {
  renderTopics();

  const key = `${state.topic}|${state.query}|${state.loadId}`;
  if (!keepOrder || key !== state.orderKey) {
    computeOrder();
    state.orderKey = key;
  }

  const byLink = new Map(state.articles.map((a) => [a.link, a]));
  const cards = [];
  state.order.forEach((link, index) => {
    const article = byLink.get(link);
    if (!article) return;
    if (index === state.seenFrom) cards.push(renderDivider());
    cards.push(renderCard(article));
  });

  if (state.articles.length) statusEl.textContent = cards.length ? "" : "Niets gevonden.";
  listEl.replaceChildren(...cards);
}

function renderDivider() {
  const divider = document.createElement("li");
  divider.className = "divider";
  divider.textContent = "Al gezien";
  return divider;
}

// Er staat maximaal één artikel open: een ander artikel openen klapt het vorige in.
function toggleOpen(article) {
  const opening = state.openLink !== article.link;
  state.openLink = opening ? article.link : null;
  if (opening) markSeen(article);
  render({ keepOrder: true });
  if (opening) listEl.children[cardIndex(article.link)]?.scrollIntoView({ block: "nearest" });
}

function cardIndex(link) {
  const index = state.order.indexOf(link);
  return state.seenFrom !== -1 && index >= state.seenFrom ? index + 1 : index;
}

function removeFromOrder(link) {
  const index = state.order.indexOf(link);
  if (index === -1) return -1;
  state.order.splice(index, 1);
  if (state.seenFrom !== -1 && index < state.seenFrom) state.seenFrom--;
  return index;
}

function restoreInOrder(link, index) {
  state.order.splice(index, 0, link);
  if (state.seenFrom !== -1 && index < state.seenFrom) state.seenFrom++;
}

function applyVotes(next) {
  votes = next;
  weights = weightsFrom(votes, seedVotes);
  saveVotes(votes);
}

// 👍 telt mee voor het leren maar verplaatst niets. 👎 laat de kaart verdwijnen, met ongedaan maken.
function vote(article, value) {
  const previous = votes[article.link]?.v;
  applyVotes(castVote(votes, article, value));

  if (value === -1 && votes[article.link]?.v === -1) {
    const index = removeFromOrder(article.link);
    if (state.openLink === article.link) state.openLink = null;
    showToast("Weg. Je krijgt minder van dit soort nieuws.", () => {
      applyVotes(castVote(votes, article, previous ?? -1));
      if (index !== -1) restoreInOrder(article.link, index);
      render({ keepOrder: true });
    });
  }
  render({ keepOrder: true });
}

let toastTimer;
function showToast(text, onUndo) {
  clearTimeout(toastTimer);
  const message = document.createElement("span");
  message.textContent = text;
  const undo = document.createElement("button");
  undo.textContent = "Ongedaan maken";
  undo.addEventListener("click", () => {
    hideToast();
    onUndo();
  });
  toastEl.replaceChildren(message, undo);
  toastEl.hidden = false;
  toastTimer = setTimeout(hideToast, UNDO_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
}

function renderCard(a) {
  const item = document.createElement("li");
  const isOpen = state.openLink === a.link;
  item.classList.toggle("open", isOpen);
  item.classList.toggle("seen", !isOpen && isSeen(a));

  if (a.image) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = a.image;
    img.alt = "";
    img.loading = "lazy";
    item.append(img);
  }

  const title = document.createElement("h2");
  title.className = "title";
  title.textContent = a.title;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${a.source} · ${timeAgo(a.published)}`;

  item.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "actions";
  const current = votes[a.link]?.v;
  for (const [value, symbol, label] of [[1, "👍", "Interessant"], [-1, "👎", "Niet interessant"]]) {
    const button = document.createElement("button");
    button.className = "vote";
    button.textContent = symbol;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(current === value));
    button.addEventListener("click", () => vote(a, value));
    actions.append(button);
  }
  item.append(actions);

  if (isOpen) {
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = a.summary || "Geen samenvatting beschikbaar.";

    const source = document.createElement("a");
    source.className = "source";
    source.href = a.link;
    source.target = "_blank";
    source.rel = "noopener";
    source.textContent = `Lees het artikel bij ${a.source} →`;

    item.append(summary, source);
  }

  // Tik op de kaart (afbeelding, titel of tekst) om te openen of te sluiten; knoppen en links doen hun eigen ding.
  item.setAttribute("aria-expanded", String(isOpen));
  item.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    toggleOpen(a);
  });
  title.tabIndex = 0;
  title.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleOpen(a);
    }
  });
  return item;
}

async function loadNews({ fresh = false } = {}) {
  refreshEl.disabled = true;
  refreshEl.classList.add("spin");
  updatedEl.textContent = "Bijwerken…";

  let data = null;
  for (const url of [NEWS_API_URL, "data/news.json"]) {
    try {
      const res = await fetch(url, fresh ? { cache: "no-store" } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      break;
    } catch {
      // volgende bron proberen
    }
  }

  refreshEl.disabled = false;
  refreshEl.classList.remove("spin");

  if (!data) {
    updatedEl.textContent = "";
    if (!state.articles.length) statusEl.textContent = "Kon het nieuws niet laden. Controleer je verbinding en tik op ↻.";
    return;
  }

  state.articles = data.articles;
  state.loadId++;
  state.loadedAt = Date.now();
  state.openLink = null;
  updatedEl.textContent = `Bijgewerkt ${timeAgo(data.updatedAt)}`;
  render();
}

searchEl.addEventListener("input", () => {
  state.query = searchEl.value;
  render();
});

refreshEl.addEventListener("click", () => loadNews({ fresh: true }));

// Een geïnstalleerde app heeft geen verversknop van de browser: laad zelf opnieuw na een tijdje op de achtergrond.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - state.loadedAt > REFRESH_AFTER_MS) loadNews();
});

await loadNews();
