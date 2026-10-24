import { loadVotes, saveVotes, castVote, weightsFrom, scoreOf, rankedList } from "./learn.js";

// URL van de Cloudflare Worker. Leeg laten = het bestand data/news.json uit de repo.
const NEWS_API_URL = "https://nieuws-api.aron-over.workers.dev/";

const FOR_YOU_KEY = "nieuws.foryou";
const HIDE_BELOW = -1; // artikelen met een lagere score verdwijnen bij "Voor jou"

function readFlag() {
  try {
    return localStorage.getItem(FOR_YOU_KEY) === "1";
  } catch {
    return false;
  }
}

const state = { articles: [], topic: "Alles", query: "", forYou: readFlag() };
const openArticles = new Set(); // links van artikelen waarvan "Lees meer" openstaat

async function loadJson(path, fallback) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return fallback;
  }
}

// Startstemmen en interesses staan in de repo; ontbreken ze, dan leert de pagina alleen van jouw duimpjes.
const seedVotes = await loadJson("seed-votes.json", {});
const interests = (await loadJson("interests.json", { groups: [] })).groups;

let votes = loadVotes();
let weights = weightsFrom(votes, seedVotes);

const listEl = document.getElementById("list");
const topicsEl = document.getElementById("topics");
const statusEl = document.getElementById("status");
const updatedEl = document.getElementById("updated");
const searchEl = document.getElementById("search");

function timeAgo(iso) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} u geleden`;
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function renderTopics() {
  const topics = ["Alles", "Tech", "Pretparken", "Algemeen"];
  const buttons = topics.map((topic) => {
    const button = document.createElement("button");
    button.textContent = topic;
    button.setAttribute("aria-pressed", String(topic === state.topic));
    button.addEventListener("click", () => {
      state.topic = topic;
      render();
    });
    return button;
  });

  const forYou = document.createElement("button");
  forYou.className = "for-you";
  forYou.textContent = "★ Voor jou";
  forYou.setAttribute("aria-pressed", String(state.forYou));
  forYou.addEventListener("click", () => {
    state.forYou = !state.forYou;
    try {
      localStorage.setItem(FOR_YOU_KEY, state.forYou ? "1" : "0");
    } catch {
      // opslag geblokkeerd: de keuze geldt dan alleen voor nu
    }
    render();
  });

  topicsEl.replaceChildren(...buttons, forYou);
}

function vote(article, value) {
  votes = castVote(votes, article, value);
  weights = weightsFrom(votes, seedVotes);
  saveVotes(votes);
  render();
}

function render() {
  renderTopics();

  const query = state.query.toLowerCase();
  let visible = state.articles.filter(
    (a) =>
      (state.topic === "Alles" || a.topic === state.topic) &&
      (!query || a.title.toLowerCase().includes(query) || a.summary.toLowerCase().includes(query)),
  );

  let hidden = 0;

  if (state.forYou) {
    const total = visible.length;
    visible = rankedList(
      visible.filter((a) => votes[a.link]?.v !== -1 && scoreOf(a, weights, interests) > HIDE_BELOW),
      weights,
      interests,
    );
    hidden = total - visible.length;
  }

  statusEl.textContent = `${visible.length} artikelen${hidden ? ` · ${hidden} verborgen` : ""}`;

  listEl.replaceChildren(...visible.map(renderCard));
}

function renderCard(a) {
  const item = document.createElement("li");
  const isOpen = openArticles.has(a.link);
  item.classList.toggle("open", isOpen);

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

  if (a.summary) {
    const toggle = document.createElement("button");
    toggle.className = "more";
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.textContent = isOpen ? "Minder" : "Lees meer";
    toggle.addEventListener("click", () => {
      if (openArticles.has(a.link)) openArticles.delete(a.link);
      else openArticles.add(a.link);
      render();
    });
    actions.append(toggle);
  }

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

  if (isOpen && a.summary) {
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = a.summary;

    const source = document.createElement("a");
    source.className = "source";
    source.href = a.link;
    source.target = "_blank";
    source.rel = "noopener";
    source.textContent = `Lees het artikel bij ${a.source} →`;

    item.append(summary, source);
  }
  return item;
}

searchEl.addEventListener("input", () => {
  state.query = searchEl.value;
  render();
});

try {
  const res = await fetch(NEWS_API_URL || "data/news.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  state.articles = data.articles;
  updatedEl.textContent = `Bijgewerkt ${timeAgo(data.updatedAt)}`;
  render();
} catch (error) {
  statusEl.textContent = `Kon het nieuws niet laden (${error.message}). Draai eerst: node scripts/fetch-news.mjs`;
}
