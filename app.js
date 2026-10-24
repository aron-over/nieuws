import { loadVotes, saveVotes, castVote, weightsFrom, scoreOf, rankOf, diversify, tokenize } from "./learn.js";
import { buildStories, publisherOf, IMPORTANT_PUBLISHERS } from "./stories.js";

// URL van de Cloudflare Worker. Lukt die niet, dan valt de pagina terug op data/news.json uit de repo.
const NEWS_API_URL = "https://nieuws-api.aron-over.workers.dev/";

const TOPICS = ["Alles", "Tech", "Pretparken", "Algemeen"];
const HIDE_BELOW = -1; // verhalen met een lagere score worden niet getoond
const MAX_IMPORTANT = 3; // zoveel grote verhalen staan maximaal onder "Belangrijk nu"
const SEEN_KEY = "nieuws.seen.v1";
const LAST_VISIT_KEY = "nieuws.lastVisit";
const MAX_SEEN = 1500;
const REFRESH_AFTER_MS = 10 * 60 * 1000; // opnieuw laden als de app zo lang op de achtergrond stond
const UNDO_MS = 6000;
const SWIPE_DISMISS_PX = 110;

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
  stories: [],
  storyById: new Map(),
  topic: "Alles",
  query: "",
  slots: [], // wat er in de lijst staat: { kind: "label", text } of { kind: "story", id, hero }
  slotsKey: "", // voor welk filter en welke lading die slots berekend zijn
  loadId: 0,
  loadedAt: 0,
  readerId: null, // verhaal dat in het leesscherm openstaat
  since: Number(readStored(LAST_VISIT_KEY, 0)) || Date.now(), // alles daarna is "nieuw"
};

// Startstemmen en interesses staan in de repo; ontbreken ze, dan leert de pagina alleen van jouw duimpjes.
const seedVotes = await loadJson("seed-votes.json", {});
const interestsConfig = await loadJson("interests.json", { groups: [] });
const interests = interestsConfig.groups;
const spread = { topicWindow: interestsConfig.topicWindow, topicLimits: interestsConfig.topicLimits };

let votes = loadVotes();
let weights = weightsFrom(votes, seedVotes);
let seen = readStored(SEEN_KEY, {}); // link -> tijdstip waarop je het las

const $ = (id) => document.getElementById(id);
const listEl = $("list");
const topicsEl = $("topics");
const statusEl = $("status");
const updatedEl = $("updated");
const searchEl = $("search");
const searchToggleEl = $("search-toggle");
const refreshEl = $("refresh");
const toastEl = $("toast");
const readerEl = $("reader");
const readerBodyEl = $("reader-body");
const readerPosEl = $("reader-pos");
const readerNextEl = $("reader-next");

$("today").textContent = new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });

function shortAgo(iso) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (minutes < 1) return "zojuist";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} u`;
  if (hours < 48) return "gisteren";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

const byNewest = (a, b) => (b.published ?? "").localeCompare(a.published ?? "");

// ---------- Verhalen: wat is gezien, gewenst, nieuw of belangrijk ----------

const isDisliked = (story) => story.articles.some((a) => votes[a.link]?.v === -1);
const isLiked = (story) => votes[story.primary.link]?.v === 1;
// Gezien = gelezen, of een duimpje omhoog gegeven. Die verhalen zakken naar "Al gezien".
const isSeen = (story) => story.articles.some((a) => a.link in seen || votes[a.link]?.v === 1);
const isNew = (story) => !isSeen(story) && !!story.published && new Date(story.published).getTime() > state.since;
const isImportant = (story) => story.publishers >= IMPORTANT_PUBLISHERS;
const inTopic = (story) => state.topic === "Alles" || story.articles.some((a) => a.topic === state.topic);
const storyScore = (story) => Math.max(...story.articles.map((a) => scoreOf(a, weights, interests)));
const storyRank = (story) => Math.max(...story.articles.map((a) => rankOf(a, weights, interests)));

function markSeen(story) {
  const now = Date.now();
  for (const article of story.articles) if (!(article.link in seen)) seen[article.link] = now;
  const links = Object.keys(seen);
  if (links.length > MAX_SEEN) {
    links.sort((a, b) => seen[a] - seen[b]);
    for (const link of links.slice(0, links.length - MAX_SEEN)) delete seen[link];
  }
  writeStored(SEEN_KEY, seen);
}

function applyVotes(next) {
  votes = next;
  weights = weightsFrom(votes, seedVotes);
  saveVotes(votes);
}

// ---------- De lijst ----------

// Bepaalt wat je ziet: groot nieuws bovenaan (ook buiten je interesses, zodat je het niet mist),
// dan wat bij je past, en onderaan wat je al gezien hebt. Zoeken toont alles wat past, nieuwste eerst.
function computeSlots() {
  const stories = state.stories.filter(inTopic);
  const query = state.query.trim().toLowerCase();

  if (query) {
    return stories
      .filter((s) => s.articles.some((a) => `${a.title} ${a.summary}`.toLowerCase().includes(query)))
      .sort(byNewest)
      .map((s) => ({ kind: "story", id: s.id }));
  }

  const candidates = stories.filter((s) => !isDisliked(s));
  const important = candidates
    .filter((s) => isImportant(s) && !isSeen(s))
    .sort((a, b) => b.publishers - a.publishers || byNewest(a, b))
    .slice(0, MAX_IMPORTANT);
  const importantIds = new Set(important.map((s) => s.id));
  const forYou = diversify(
    candidates
      .filter((s) => !importantIds.has(s.id) && !isSeen(s) && storyScore(s) > HIDE_BELOW)
      .map((s) => ({ story: s, rank: storyRank(s), tokens: new Set(tokenize(s.primary)), topic: s.topic })),
    spread,
  ).map((entry) => entry.story);
  const read = candidates.filter(isSeen).sort(byNewest);

  const slots = [];
  const add = (list, withHero) =>
    list.forEach((s, i) => slots.push({ kind: "story", id: s.id, hero: withHero && i === 0 }));

  if (important.length) {
    slots.push({ kind: "label", text: "Belangrijk nu" });
    add(important, true);
    if (forYou.length) slots.push({ kind: "label", text: "Voor jou" });
    add(forYou, false);
  } else {
    add(forYou, true);
  }
  if (read.length) {
    slots.push({ kind: "label", text: "Al gezien" });
    add(read, false);
  }
  return slots;
}

// keepOrder: na lezen, een duimpje of wegvegen blijft alles op zijn plek tot je ververst of een filter kiest.
function render({ keepOrder = false } = {}) {
  renderTopics();

  const key = `${state.topic}|${state.query}|${state.loadId}`;
  if (!keepOrder || key !== state.slotsKey) {
    state.slots = computeSlots();
    state.slotsKey = key;
  }

  const items = [];
  state.slots.forEach((slot, i) => {
    if (slot.kind === "label") {
      // Een kopje zonder verhalen eronder (bijvoorbeeld na wegvegen) laten we weg.
      if (state.slots[i + 1]?.kind === "story") items.push(renderLabel(slot.text));
    } else {
      const story = state.storyById.get(slot.id);
      if (story) items.push(renderStory(story, slot.hero));
    }
  });

  if (state.articles.length) {
    const any = items.some((el) => el.classList.contains("story"));
    statusEl.textContent = any ? "" : state.query ? "Niets gevonden." : "Je bent helemaal bij.";
  }
  listEl.replaceChildren(...items);
}

function renderTopics() {
  topicsEl.replaceChildren(
    ...TOPICS.map((topic) => {
      const button = document.createElement("button");
      button.textContent = topic;
      button.setAttribute("aria-pressed", String(topic === state.topic));
      button.addEventListener("click", () => {
        if (state.topic === topic) return;
        state.topic = topic;
        render();
        window.scrollTo({ top: 0 });
      });
      return button;
    }),
  );
}

function renderLabel(text) {
  const li = document.createElement("li");
  li.className = "section-label";
  li.textContent = text;
  return li;
}

function topicClass(topic) {
  return `topic-${topic.toLowerCase()}`;
}

function renderMeta(story) {
  const meta = document.createElement("div");
  meta.className = "meta";
  if (isNew(story)) {
    const badge = document.createElement("span");
    badge.className = "new";
    badge.textContent = "Nieuw";
    meta.append(badge);
  }
  if (state.topic === "Alles") {
    const topic = document.createElement("span");
    topic.className = `topic ${topicClass(story.topic)}`;
    topic.textContent = story.topic;
    meta.append(topic);
  }
  const sources = story.publishers > 1 ? ` · ${story.publishers} bronnen` : "";
  meta.append(`${publisherOf(story.primary)} · ${shortAgo(story.published)}${sources}`);
  return meta;
}

function renderImage(src, className) {
  const img = document.createElement("img");
  img.className = className;
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => img.remove()); // kapotte afbeelding: gewoon geen afbeelding
  return img;
}

function renderStory(story, hero) {
  const a = story.primary;
  const item = document.createElement("li");
  item.className = hero ? "story hero" : "story row";
  item.classList.toggle("seen", isSeen(story));
  item.dataset.id = story.id;
  item.tabIndex = 0;

  const title = document.createElement("h2");
  title.className = "title";
  title.textContent = a.title;

  if (hero) {
    if (a.image) item.append(renderImage(a.image, "hero-img"));
    item.append(renderMeta(story), title);
    if (a.summary) {
      const summary = document.createElement("p");
      summary.className = "hero-summary";
      summary.textContent = a.summary;
      item.append(summary);
    }
  } else {
    const text = document.createElement("div");
    text.className = "row-text";
    text.append(renderMeta(story), title);
    item.append(text);
    if (a.image) item.append(renderImage(a.image, "row-img"));
  }

  item.addEventListener("click", () => {
    if (item.dataset.swiped) return;
    openReader(story.id);
  });
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter") openReader(story.id);
  });
  enableSwipe(item, () => dismiss(story));
  return item;
}

// Veeg een verhaal naar links om het weg te doen. Verticaal scrollen blijft gewoon werken.
function enableSwipe(item, onDismiss) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let tracking = false;
  let horizontal = false;

  item.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    tracking = true;
    horizontal = false;
    dx = 0;
    startX = event.clientX;
    startY = event.clientY;
  });

  item.addEventListener("pointermove", (event) => {
    if (!tracking) return;
    const mx = event.clientX - startX;
    const my = event.clientY - startY;
    if (!horizontal) {
      if (Math.abs(mx) < 12 && Math.abs(my) < 12) return;
      if (Math.abs(my) >= Math.abs(mx) || mx > 0) {
        tracking = false;
        return;
      }
      horizontal = true;
      item.setPointerCapture(event.pointerId);
      item.classList.add("dragging");
    }
    dx = Math.min(0, mx);
    item.style.transform = `translateX(${dx}px)`;
    item.style.opacity = String(Math.max(0.3, 1 + dx / 300));
  });

  const reset = () => {
    item.classList.remove("dragging");
    item.style.transform = "";
    item.style.opacity = "";
  };

  item.addEventListener("pointerup", () => {
    if (!tracking) return;
    tracking = false;
    if (!horizontal) return;
    item.dataset.swiped = "1"; // voorkomt dat de klik na het vegen het artikel opent
    if (dx < -SWIPE_DISMISS_PX) {
      item.classList.remove("dragging");
      item.style.transform = "translateX(-110%)";
      item.style.opacity = "0";
      setTimeout(onDismiss, 160);
    } else {
      reset();
      setTimeout(() => delete item.dataset.swiped, 50);
    }
  });

  item.addEventListener("pointercancel", () => {
    tracking = false;
    reset();
  });
}

// "Minder hiervan" of wegvegen: weg uit de lijst, met ongedaan maken.
function dismiss(story) {
  const previous = votes[story.primary.link]?.v;
  if (previous !== -1) applyVotes(castVote(votes, story.primary, -1));

  const index = state.slots.findIndex((s) => s.kind === "story" && s.id === story.id);
  const [slot] = index >= 0 ? state.slots.splice(index, 1) : [];
  const promoted = slot?.hero && state.slots[index]?.kind === "story" ? state.slots[index] : null;
  if (promoted) promoted.hero = true;
  render({ keepOrder: true });

  showToast("Weg. Je krijgt minder van dit soort nieuws.", () => {
    if (previous !== -1) applyVotes(castVote(votes, story.primary, previous ?? -1));
    if (promoted) promoted.hero = false;
    if (slot) state.slots.splice(index, 0, slot);
    render({ keepOrder: true });
  });
}

// ---------- Leesscherm ----------

const readerIds = () => state.slots.filter((s) => s.kind === "story").map((s) => s.id);

function openReader(id) {
  if (readerEl.hidden) {
    history.pushState({ reader: true }, ""); // zo sluit de terugknop of -veeg alleen het leesscherm
    readerEl.hidden = false;
    document.body.classList.add("reading");
  }
  showInReader(id);
}

function showInReader(id) {
  const story = state.storyById.get(id);
  if (!story) return;
  state.readerId = id;
  markSeen(story);
  renderReader(story);
  readerEl.scrollTop = 0;
}

function step(delta) {
  const ids = readerIds();
  const next = ids[ids.indexOf(state.readerId) + delta];
  if (next) showInReader(next);
}

function closeReader() {
  if (!readerEl.hidden) history.back();
}

function hideReader() {
  readerEl.hidden = true;
  document.body.classList.remove("reading");
  const id = state.readerId;
  state.readerId = null;
  render({ keepOrder: true });
  if (id) listEl.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
}

function renderReader(story) {
  const a = story.primary;
  const ids = readerIds();
  const pos = ids.indexOf(story.id);
  readerPosEl.textContent = pos >= 0 ? `${pos + 1} van ${ids.length}` : "";
  readerNextEl.disabled = pos < 0 || pos >= ids.length - 1;

  const parts = [];
  if (a.image) parts.push(renderImage(a.image, "reader-img"));

  const meta = document.createElement("div");
  meta.className = "meta";
  const topic = document.createElement("span");
  topic.className = `topic ${topicClass(story.topic)}`;
  topic.textContent = story.topic;
  meta.append(topic, `${publisherOf(a)} · ${shortAgo(story.published)}`);

  const title = document.createElement("h1");
  title.id = "reader-title";
  title.className = "reader-title";
  title.textContent = a.title;

  const summary = document.createElement("p");
  summary.className = "reader-summary";
  summary.textContent = a.summary || "Deze bron geeft geen samenvatting mee. Lees het hele artikel via de link hieronder.";

  const full = document.createElement("a");
  full.className = "read-full";
  full.href = a.link;
  full.target = "_blank";
  full.rel = "noopener";
  full.textContent = `Lees het hele artikel bij ${publisherOf(a)}`;

  parts.push(meta, title, summary, full);

  const others = story.articles.filter((other) => other !== a);
  if (others.length) {
    const also = document.createElement("section");
    also.className = "also";
    const heading = document.createElement("h2");
    heading.textContent = "Ook bij";
    const list = document.createElement("ul");
    for (const other of others) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = other.link;
      link.target = "_blank";
      link.rel = "noopener";
      const publisher = document.createElement("span");
      publisher.className = "also-source";
      publisher.textContent = publisherOf(other);
      link.append(publisher, other.title);
      li.append(link);
      list.append(li);
    }
    also.append(heading, list);
    parts.push(also);
  }

  const actions = document.createElement("div");
  actions.className = "reader-actions";
  const more = document.createElement("button");
  more.className = "pill";
  more.setAttribute("aria-pressed", String(isLiked(story)));
  more.textContent = "👍 Meer hiervan";
  more.addEventListener("click", () => {
    applyVotes(castVote(votes, a, 1));
    renderReader(story);
    if (isLiked(story)) showToast("Genoteerd: meer van dit soort nieuws.");
  });
  const less = document.createElement("button");
  less.className = "pill";
  less.textContent = "👎 Minder hiervan";
  less.addEventListener("click", () => {
    const ids = readerIds();
    const next = ids[ids.indexOf(story.id) + 1];
    dismiss(story);
    if (next) showInReader(next);
    else closeReader();
  });
  actions.append(more, less);
  parts.push(actions);

  const nav = document.createElement("div");
  nav.className = "reader-nav";
  const prev = document.createElement("button");
  prev.className = "pill";
  prev.textContent = "← Vorige";
  prev.disabled = pos <= 0;
  prev.addEventListener("click", () => step(-1));
  const next = document.createElement("button");
  next.className = "pill";
  next.textContent = "Volgende →";
  next.disabled = pos < 0 || pos >= ids.length - 1;
  next.addEventListener("click", () => step(1));
  nav.append(prev, next);
  parts.push(nav);

  readerBodyEl.replaceChildren(...parts);
}

$("reader-close").addEventListener("click", closeReader);
readerNextEl.addEventListener("click", () => step(1));
window.addEventListener("popstate", () => {
  if (!readerEl.hidden) hideReader();
});

// Vegen in het leesscherm: naar links = volgende, naar rechts = vorige.
let touchStart = null;
readerBodyEl.addEventListener(
  "touchstart",
  (event) => {
    const t = event.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  },
  { passive: true },
);
readerBodyEl.addEventListener(
  "touchend",
  (event) => {
    if (!touchStart) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) step(dx < 0 ? 1 : -1);
  },
  { passive: true },
);

document.addEventListener("keydown", (event) => {
  if (readerEl.hidden) return;
  if (event.key === "Escape") closeReader();
  if (event.key === "ArrowRight") step(1);
  if (event.key === "ArrowLeft") step(-1);
});

// ---------- Melding met ongedaan maken ----------

let toastTimer;
function showToast(text, onUndo) {
  clearTimeout(toastTimer);
  const message = document.createElement("span");
  message.textContent = text;
  const parts = [message];
  if (onUndo) {
    const undo = document.createElement("button");
    undo.textContent = "Ongedaan maken";
    undo.addEventListener("click", () => {
      hideToast();
      onUndo();
    });
    parts.push(undo);
  }
  toastEl.replaceChildren(...parts);
  toastEl.hidden = false;
  toastTimer = setTimeout(hideToast, onUndo ? UNDO_MS : 2500);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
}

// ---------- Laden en verversen ----------

async function loadNews({ fresh = false } = {}) {
  refreshEl.disabled = true;
  refreshEl.classList.add("spin");
  updatedEl.textContent = "bijwerken…";

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
    updatedEl.textContent = "offline";
    if (!state.articles.length) statusEl.textContent = "Kon het nieuws niet laden. Controleer je verbinding en probeer het opnieuw.";
    return;
  }

  state.articles = data.articles;
  state.stories = buildStories(state.articles);
  state.storyById = new Map(state.stories.map((s) => [s.id, s]));
  state.loadId++;
  state.loadedAt = Date.now();
  updatedEl.textContent = `bijgewerkt ${shortAgo(data.updatedAt)}`.replace("bijgewerkt zojuist", "zojuist bijgewerkt");
  render();
}

searchToggleEl.addEventListener("click", () => {
  const show = searchEl.hidden;
  searchEl.hidden = !show;
  searchToggleEl.setAttribute("aria-expanded", String(show));
  if (show) {
    searchEl.focus();
  } else if (state.query) {
    searchEl.value = "";
    state.query = "";
    render();
  }
});

searchEl.addEventListener("input", () => {
  state.query = searchEl.value;
  render();
});

refreshEl.addEventListener("click", async () => {
  await loadNews({ fresh: true });
  window.scrollTo({ top: 0 });
});

// Een geïnstalleerde app heeft geen verversknop van de browser: laad zelf opnieuw na een tijdje op de achtergrond.
// Wat je bij weggaan nog niet gezien had, telt bij terugkomst als "nieuw".
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    writeStored(LAST_VISIT_KEY, Date.now());
  } else if (Date.now() - state.loadedAt > REFRESH_AFTER_MS && readerEl.hidden) {
    state.since = Number(readStored(LAST_VISIT_KEY, state.since)) || state.since;
    loadNews();
  }
});

await loadNews();
writeStored(LAST_VISIT_KEY, Date.now());
