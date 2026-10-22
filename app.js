// URL van de Cloudflare Worker. Leeg laten = het bestand data/news.json uit de repo.
const NEWS_API_URL = "";

const state = { articles: [], topic: "Alles", query: "" };

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
  topicsEl.replaceChildren(
    ...topics.map((topic) => {
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

function render() {
  renderTopics();

  const query = state.query.toLowerCase();
  const visible = state.articles.filter(
    (a) =>
      (state.topic === "Alles" || a.topic === state.topic) &&
      (!query || a.title.toLowerCase().includes(query) || a.summary.toLowerCase().includes(query)),
  );

  statusEl.textContent = `${visible.length} artikelen`;

  listEl.replaceChildren(
    ...visible.map((a) => {
      const item = document.createElement("li");

      const link = document.createElement("a");
      link.href = a.link;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = a.title;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${a.source} · ${timeAgo(a.published)}`;

      if (a.image) {
        const img = document.createElement("img");
        img.className = "thumb";
        img.src = a.image;
        img.alt = "";
        img.loading = "lazy";
        item.append(img);
      }

      item.append(link, meta);

      if (a.summary) {
        const summary = document.createElement("p");
        summary.className = "summary";
        summary.textContent = a.summary;
        item.append(summary);
      }
      return item;
    }),
  );
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
