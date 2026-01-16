/* RSS Embed - app.js
   Paramètres:
   - feed (obligatoire) : URL du flux
   - layout: list | carousel
   - limit: 1..50
   - header: 0 pour masquer le header
   - images: 0 pour désactiver les images
   - source: libellé de source forcé
   - font: roboto | system | marianne
*/

(() => {
  // =========================
  // Sécurité : flux autorisés (whitelist)
  // =========================
  const ALLOWED_FEEDS = [
    "https://edunumrech.hypotheses.org/feed",
    "https://muse.pleiade.education.fr/rss/dcaf719f-f512-4e26-94b0-7f2bc15d0e74/"
  ];
  // Pour en ajouter un : ajoute une URL exacte dans ce tableau.

  // =========================
  // Params URL
  // =========================
  const qs = new URLSearchParams(location.search);

  const feed = qs.get("feed");
  const limit = Math.max(1, Math.min(50, parseInt(qs.get("limit") || "20", 10)));
  const layout = (qs.get("layout") || "list").toLowerCase(); // list | carousel
  const forcedSource = qs.get("source"); // optionnel
  const header = qs.get("header") !== "0"; // visible par défaut
  const images = qs.get("images") !== "0"; // images par défaut
  const font = (qs.get("font") || "roboto").toLowerCase(); // roboto | system | marianne

  // Police (Marianne si dispo localement)
  const root = document.documentElement;
  if (font === "system") {
    root.style.setProperty("--font", "system-ui, -apple-system, Segoe UI, Arial, sans-serif");
  } else if (font === "marianne") {
    root.style.setProperty("--font", "Marianne, Roboto, system-ui, -apple-system, Segoe UI, Arial, sans-serif");
  } else {
    root.style.setProperty("--font", "Roboto, system-ui, -apple-system, Segoe UI, Arial, sans-serif");
  }

  const hintEl = document.getElementById("hint");
  const feedTitleEl = document.getElementById("feedTitle");

  function showError(msg) {
    const e = document.getElementById("err");
    e.style.display = "block";
    e.textContent = msg;
  }

  if (!feed) {
    showError("Paramètre manquant : ?feed=https://...");
    return;
  }

  if (!ALLOWED_FEEDS.includes(feed)) {
    showError("Flux non autorisé.\n\nFlux autorisés :\n- " + ALLOWED_FEEDS.join("\n- "));
    return;
  }

  if (!header) {
    feedTitleEl.style.display = "none";
    hintEl.style.display = "none";
  } else {
    hintEl.textContent = `limit: ${limit} | layout: ${layout}`;
  }

  // =========================
  // Proxys RAW
  // =========================
  const PROXIES = [
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    (u) => "https://corsproxy.io/?" + encodeURIComponent(u),
    (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
    (u) => "https://thingproxy.freeboard.io/fetch/" + u,
    (u) => "https://cors-proxy.htmldriven.com/?url=" + encodeURIComponent(u),
  ];

  async function fetchXmlWithFallback(url) {
    let lastErr = null;
    for (const mk of PROXIES) {
      const target = mk(url);
      try {
        const r = await fetch(target, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);

        const txt = await r.text();
        const head = (txt || "").trimStart().slice(0, 220);

        const looksLikeXml =
          head.startsWith("<?xml") || head.startsWith("<rss") || head.startsWith("<feed") ||
          head.includes("<rss") || head.includes("<feed") || head.includes("<channel");
        const looksLikeHtml =
          head.startsWith("<!doctype") || head.startsWith("<html") || head.includes("<body");

        if (!txt || !looksLikeXml || looksLikeHtml) throw new Error("Réponse non RSS/Atom");
        return txt;
      } catch (e) {
        lastErr = new Error(`${e.message} via ${target}`);
      }
    }
    throw lastErr || new Error("Impossible de récupérer le flux via les proxys.");
  }

  // =========================
  // Helpers parsing
  // =========================
  function text(el, sel) {
    const n = el.querySelector(sel);
    return n ? (n.textContent || "").trim() : "";
  }

  function cleanLabel(s) {
    if (!s) return "";
    return String(s)
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[\s•·◦○●⚪︎▫️▪️–—\-|:;]+/u, "")
      .trim();
  }

  function normalizeUrl(u) {
    if (!u) return "";
    let s = String(u).trim();
    if (s.startsWith("//")) s = "https:" + s;
    if (s.startsWith("http://")) s = "https://" + s.slice("http://".length);
    return s;
  }

  function firstImgFromHtml(html) {
    const m = /<img[^>]+src="([^"]+)"/i.exec(html || "");
    return m ? m[1] : "";
  }

  function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || "").replace(/\s+/g, " ").trim();
  }

  function getItems(doc) {
    const rssItems = Array.from(doc.querySelectorAll("item"));
    if (rssItems.length) return { type: "rss", items: rssItems };
    const atomEntries = Array.from(doc.querySelectorAll("entry"));
    if (atomEntries.length) return { type: "atom", items: atomEntries };
    return { type: "unknown", items: [] };
  }

  function getTitle(doc) {
    const rssTitle = doc.querySelector("channel > title");
    if (rssTitle && rssTitle.textContent) return rssTitle.textContent.trim();
    const atomTitle = doc.querySelector("feed > title");
    if (atomTitle && rssTitle.textContent) return atomTitle.textContent.trim();
    return "";
  }

  function getLink(node, type) {
    if (type === "rss") return text(node, "link") || "#";
    const alt = node.querySelector('link[rel="alternate"][href]') || node.querySelector('link[href]');
    return alt ? (alt.getAttribute("href") || "#") : "#";
  }

  function getPublishedRaw(node, type) {
    if (type === "rss") return text(node, "pubDate") || text(node, "dc\\:date");
    return text(node, "updated") || text(node, "published");
  }

  function formatDateFr(raw) {
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("fr-FR", { day:"numeric", month:"long", year:"numeric" }).format(d);
  }

  function getSummary(node, type) {
    if (type === "rss") return text(node, "description") || text(node, "content\\:encoded");
    return text(node, "summary") || text(node, "content");
  }

  function getSourceLabel(node) {
    const raw =
      forcedSource ||
      text(node, "source") ||
      text(node, "dc\\:creator") ||
      text(node, "author > name") ||
      "";
    return cleanLabel(raw);
  }

  function pickImage(node, type) {
    if (!images) return "";

    const enc = node.querySelector("enclosure[url]");
    if (enc && enc.getAttribute("url")) return normalizeUrl(enc.getAttribute("url"));

    const mc = node.querySelector("media\\:content[url], content[url]");
    if (mc && mc.getAttribute("url")) return normalizeUrl(mc.getAttribute("url"));

    const mt = node.querySelector("media\\:thumbnail[url], thumbnail[url]");
    if (mt && mt.getAttribute("url")) return normalizeUrl(mt.getAttribute("url"));

    const aenc = node.querySelector('link[rel="enclosure"][href]');
    if (aenc && aenc.getAttribute("href")) return normalizeUrl(aenc.getAttribute("href"));

    const contentEncoded = text(node, "content\\:encoded");
    const imgFromContent = firstImgFromHtml(contentEncoded);
    if (imgFromContent) return normalizeUrl(imgFromContent);

    const raw = getSummary(node, type);
    return normalizeUrl(firstImgFromHtml(raw));
  }

  function buildMetaLine(src, dateFr) {
    src = cleanLabel(src);
    if (!src && !dateFr) return "";
    return `
      <div class="meta-line">
        ${src ? `<span class="source">${src}</span>` : ``}
        ${dateFr ? `<span class="meta">${dateFr}</span>` : ``}
      </div>
    `;
  }

  function renderList(rowNodes) {
    const box = document.getElementById("listBox");
    rowNodes.forEach(r => box.appendChild(r));
    box.style.display = "flex";
  }

  function renderCarousel(cardHtmls) {
    const slides = document.getElementById("slides");
    cardHtmls.forEach(html => {
      const slide = document.createElement("div");
      slide.className = "swiper-slide";
      slide.innerHTML = html;
      slides.appendChild(slide);
    });

    document.getElementById("swiperBox").style.display = "block";

    new Swiper(".swiper", {
      slidesPerView: 1,
      spaceBetween: 16,
      loop: false,
      pagination: { el: ".swiper-pagination", clickable: true },
      navigation: { nextEl: ".swiper-button-next", prevEl: ".swiper-button-prev" },
      breakpoints: { 720: { slidesPerView: 2 }, 1060: { slidesPerView: 3 } }
    });
  }

  // =========================
  // Main
  // =========================
  fetchXmlWithFallback(feed)
    .then(xmlText => new DOMParser().parseFromString(xmlText, "text/xml"))
    .then(doc => {
      const t = getTitle(doc);
      if (t) feedTitleEl.textContent = t;

      const { type, items } = getItems(doc);
      const sliced = items.slice(0, limit);
      if (!sliced.length) throw new Error("Aucun item/entry détecté dans le flux.");

      const cardHtmls = [];
      const rowNodes = [];

      sliced.forEach(node => {
        const title = text(node, "title") || "Sans titre";
        const link = getLink(node, type);

        const dateFr = formatDateFr(getPublishedRaw(node, type));
        const excerpt = stripHtml(getSummary(node, type)).slice(0, 260);

        const src = getSourceLabel(node);
        const img = pickImage(node, type);

        const metaLine = buildMetaLine(src, dateFr);

        // LIST
        const row = document.createElement("a");
        row.href = link;
        row.target = "_blank";
        row.rel = "noopener noreferrer";
        row.className = "row" + (img ? "" : " no-thumb");

        row.innerHTML = `
          <div class="thumb ${img ? "" : "placeholder"}" style="${img ? `background-image:url('${img}')` : ""}"></div>
          <div class="txt">
            <div class="row-title">${title}</div>
            ${metaLine}
            ${excerpt ? `<p class="excerpt">${excerpt}${excerpt.length>=260 ? "…" : ""}</p>` : ``}
          </div>
        `;
        rowNodes.push(row);

        // CAROUSEL
        const card = `
          <a class="card" href="${link}" target="_blank" rel="noopener noreferrer">
            <div class="card-thumb" style="${img ? `background-image:url('${img}')` : ""}"></div>
            <div class="content">
              <div class="card-title">${title}</div>
              ${metaLine}
              ${excerpt ? `<p class="excerpt">${excerpt}${excerpt.length>=260 ? "…" : ""}</p>` : ``}
            </div>
          </a>
        `;
        cardHtmls.push(card);
      });

      if (layout === "carousel") {
        renderCarousel(cardHtmls);
      } else {
        renderList(rowNodes);
      }
    })
    .catch(err => showError("Erreur : " + (err && err.message ? err.message : err)));
})();
