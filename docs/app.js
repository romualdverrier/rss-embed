/* docs/app.js */
/* RSS Embed (GitHub Pages) - list + carousel, with optional "fetch image from article page" fallback */

(() => {
  // =========================
  // 1) Whitelist
  // =========================
  const ALLOWED_FEEDS = [
    "https://edunumrech.hypotheses.org/feed",
    "https://muse.pleiade.education.fr/rss/dcaf719f-f512-4e26-94b0-7f2bc15d0e74/"
  ];

  // =========================
  // 2) Params
  // =========================
  const qs = new URLSearchParams(location.search);
  const feed = qs.get("feed");
  const limit = clampInt(qs.get("limit"), 1, 50, 20);
  const layout = (qs.get("layout") || "list").toLowerCase(); // list | carousel
  const header = qs.get("header") !== "0"; // visible by default
  const images = qs.get("images") !== "0"; // images on by default
  const fetchArticleImages = qs.get("fetchArticleImages") !== "0"; // ON by default
  const forcedSource = (qs.get("source") || "").trim(); // optional

  const feedTitleEl = document.getElementById("feedTitle");
  const hintEl = document.getElementById("hint");
  const errEl = document.getElementById("err");

  const swiperBox = document.getElementById("swiperBox");
  const slidesEl = document.getElementById("slides");
  const listBox = document.getElementById("listBox");

  // =========================
  // 3) UI helpers
  // =========================
  function showError(msg) {
    errEl.style.display = "block";
    errEl.textContent = msg;
  }

  if (!feed) {
    showError("Paramètre manquant : ?feed=https://...");
    return;
  }

  if (!ALLOWED_FEEDS.includes(feed)) {
    showError(
      "Flux non autorisé.\n\nFlux autorisés :\n- " + ALLOWED_FEEDS.join("\n- ")
    );
    return;
  }

  if (!header) {
    feedTitleEl.style.display = "none";
    hintEl.style.display = "none";
  } else {
    hintEl.textContent = `limit: ${limit} | layout: ${layout} | images: ${images ? "on" : "off"}`;
  }

  // =========================
  // 4) Proxies (RAW)
  // =========================
  // NOTE: Les proxys gratuits peuvent être instables. On en met plusieurs.
  const PROXIES = [
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    (u) => "https://corsproxy.io/?" + encodeURIComponent(u),
    (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
  ];

  async function fetchTextWithFallback(url, { expect = "xml" } = {}) {
    let lastErr = null;

    for (const mk of PROXIES) {
      const target = mk(url);
      try {
        const r = await fetch(target, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);

        const txt = await r.text();
        const head = (txt || "").trimStart().slice(0, 300).toLowerCase();

        if (!txt) throw new Error("Réponse vide");

        if (expect === "xml") {
          const looksXml =
            head.startsWith("<?xml") ||
            head.startsWith("<rss") ||
            head.startsWith("<feed") ||
            head.includes("<channel") ||
            head.includes("<rss") ||
            head.includes("<feed");
          const looksHtml =
            head.startsWith("<!doctype") ||
            head.startsWith("<html") ||
            head.includes("<body");

          if (!looksXml || looksHtml) throw new Error("Réponse non RSS/Atom");
        }

        // expect html: pas de contrainte, on accepte HTML
        return txt;
      } catch (e) {
        lastErr = new Error(`${e.message} via ${target}`);
      }
    }

    throw lastErr || new Error("Impossible de récupérer la ressource via les proxys.");
  }

  // =========================
  // 5) Parsing helpers
  // =========================
  function text(el, sel) {
    const n = el.querySelector(sel);
    return n ? (n.textContent || "").trim() : "";
  }

  function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || "").replace(/\s+/g, " ").trim();
  }

  function firstImgFromHtml(html) {
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || "");
    return m ? m[1] : "";
  }

  function absUrl(maybeUrl, baseUrl) {
    try {
      return new URL(maybeUrl, baseUrl).toString();
    } catch {
      return "";
    }
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
    if (atomTitle && atomTitle.textContent) return atomTitle.textContent.trim();
    return "";
  }

  function getLink(node, type) {
    if (type === "rss") return text(node, "link") || "#";
    const alt =
      node.querySelector('link[rel="alternate"][href]') ||
      node.querySelector("link[href]");
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
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  }

  function getSummaryHtml(node, type) {
    if (type === "rss") return text(node, "content\\:encoded") || text(node, "description");
    return text(node, "content") || text(node, "summary");
  }

  function getSourceLabel(node) {
    // RSS standard: pas toujours “source” utilisable.
    // Muse / ta veille : si tu as un tag <source> ou <dc:creator> on tente.
    return (
      forcedSource ||
      text(node, "source") ||
      text(node, "dc\\:creator") ||
      ""
    ).trim();
  }

  function pickImageFromFeed(node, type) {
    if (!images) return "";

    // RSS enclosure
    const enc = node.querySelector("enclosure[url]");
    if (enc && enc.getAttribute("url")) return enc.getAttribute("url");

    // media:content / media:thumbnail
    const mc = node.querySelector("media\\:content[url], content[url]");
    if (mc && mc.getAttribute("url")) return mc.getAttribute("url");

    const mt = node.querySelector("media\\:thumbnail[url], thumbnail[url]");
    if (mt && mt.getAttribute("url")) return mt.getAttribute("url");

    // Atom enclosure
    const aenc = node.querySelector('link[rel="enclosure"][href]');
    if (aenc && aenc.getAttribute("href")) return aenc.getAttribute("href");

    // Try content/description embedded <img>
    const html = getSummaryHtml(node, type);
    return firstImgFromHtml(html);
  }

  // =========================
  // 6) Image fallback from article page (Hypothèses)
  // =========================
  const articleImgCache = new Map(); // link -> imgUrl

  async function pickImageFromArticlePage(link) {
    if (!images || !fetchArticleImages) return "";
    if (!link || link === "#") return "";

    if (articleImgCache.has(link)) return articleImgCache.get(link);

    try {
      const html = await fetchTextWithFallback(link, { expect: "html" });
      const doc = new DOMParser().parseFromString(html, "text/html");

      // 1) OG image / Twitter image
      const og =
        doc.querySelector('meta[property="og:image"][content]') ||
        doc.querySelector('meta[name="twitter:image"][content]') ||
        doc.querySelector('meta[name="twitter:image:src"][content]');
      if (og && og.getAttribute("content")) {
        const u = absUrl(og.getAttribute("content"), link);
        if (u) {
          articleImgCache.set(link, u);
          return u;
        }
      }

      // 2) WordPress/Hypothèses typical content area
      const content =
        doc.querySelector(".entry-content") ||
        doc.querySelector("article") ||
        doc.querySelector("main") ||
        doc.body;

      // 3) First <img> in content
      if (content) {
        const img = content.querySelector("img[src]");
        if (img && img.getAttribute("src")) {
          const u = absUrl(img.getAttribute("src"), link);
          if (u) {
            articleImgCache.set(link, u);
            return u;
          }
        }
      }
    } catch (e) {
      // silent fail: we'll just have no image
    }

    articleImgCache.set(link, "");
    return "";
  }

  // =========================
  // 7) Render (single border per item)
  // =========================
  function makeMetaLine(src, dateFr) {
    if (!src && !dateFr) return "";
    // Source = texte simple, pas de badge, pas de bordure
    return `
      <div class="meta-line">
        ${src ? `<span class="source">${escapeHtml(src)}</span>` : ``}
        ${dateFr ? `<span class="date">${escapeHtml(dateFr)}</span>` : ``}
      </div>
    `;
  }

  function makeListItem({ title, link, src, dateFr, excerpt, img }) {
    // Un SEUL cadre : .item
    // Image optionnelle : aucune bordure/mini-cadre interne.
    const imgHtml = img
      ? `<div class="media"><img src="${escapeAttr(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`
      : ``;

    return `
      <a class="item" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">
        ${imgHtml}
        <div class="body">
          <div class="title">${escapeHtml(title)}</div>
          ${makeMetaLine(src, dateFr)}
          ${excerpt ? `<div class="excerpt">${escapeHtml(excerpt)}</div>` : ``}
        </div>
      </a>
    `;
  }

  function makeCarouselCard({ title, link, src, dateFr, excerpt, img }) {
    const thumb = img
      ? `<div class="card-media" style="background-image:url('${escapeAttr(img)}')"></div>`
      : `<div class="card-media placeholder"></div>`;

    return `
      <a class="card" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">
        ${thumb}
        <div class="card-body">
          <div class="card-title">${escapeHtml(title)}</div>
          ${makeMetaLine(src, dateFr)}
          ${excerpt ? `<div class="card-excerpt">${escapeHtml(excerpt)}</div>` : ``}
        </div>
      </a>
    `;
  }

  // =========================
  // 8) Main
  // =========================
  (async () => {
    try {
      const xmlText = await fetchTextWithFallback(feed, { expect: "xml" });
      const doc = new DOMParser().parseFromString(xmlText, "text/xml");

      const channelTitle = getTitle(doc);
      if (channelTitle) feedTitleEl.textContent = channelTitle;

      const { type, items } = getItems(doc);
      const sliced = items.slice(0, limit);
      if (!sliced.length) throw new Error("Aucun item/entry détecté dans le flux.");

      // Build entries
      const entries = [];
      for (const node of sliced) {
        const title = text(node, "title") || "Sans titre";
        const link = getLink(node, type) || "#";

        const pubRaw = getPublishedRaw(node, type);
        const dateFr = formatDateFr(pubRaw);

        const summaryHtml = getSummaryHtml(node, type);
        const excerpt = stripHtml(summaryHtml).slice(0, 260);

        let src = getSourceLabel(node);

        // Image from feed first
        let img = pickImageFromFeed(node, type);
        img = img ? absUrl(img, link) : "";

        // If none, try from article page (Hypothèses mainly)
        if (!img && images && fetchArticleImages) {
          img = await pickImageFromArticlePage(link);
        }

        entries.push({ title, link, src, dateFr, excerpt, img });
      }

      if (layout === "carousel") {
        // Render carousel
        swiperBox.style.display = "block";

        const cardsHtml = entries.map(makeCarouselCard).join("");
        slidesEl.innerHTML = cardsHtml
          .split("</a>")
          .filter(Boolean)
          .map((chunk) => `<div class="swiper-slide">${chunk}</a></div>`)
          .join("");

        // Swiper init (big arrows in CSS)
        // eslint-disable-next-line no-undef
        new Swiper(".swiper", {
          slidesPerView: 1,
          spaceBetween: 18,
          loop: false,
          pagination: { el: ".swiper-pagination", clickable: true },
          navigation: { nextEl: ".swiper-button-next", prevEl: ".swiper-button-prev" },
          breakpoints: {
            760: { slidesPerView: 2 },
            1120: { slidesPerView: 3 },
          },
        });
      } else {
        // Render list
        listBox.style.display = "block";
        listBox.innerHTML = entries.map(makeListItem).join("");
      }
    } catch (e) {
      showError("Erreur : " + (e && e.message ? e.message : String(e)));
    }
  })();

  // =========================
  // utils
  // =========================
  function clampInt(v, min, max, def) {
    const n = parseInt(v || "", 10);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replaceAll("`", "&#096;");
  }
})();
