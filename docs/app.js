/* docs/app.js */
/* RSS Embed (GitHub Pages) - list + carousel */

(() => {
  // =========================
  // 1) Whitelist
  // =========================
  const ALLOWED_FEEDS = [
    "https://edunumrech.hypotheses.org/feed",
    "https://muse.pleiade.education.fr/rss/dcaf719f-f512-4e26-94b0-7f2bc15d0e74/",
  ];

  // =========================
  // 2) Params
  // =========================
  const qs = new URLSearchParams(location.search);
  const feed = qs.get("feed");
  const limit = clampInt(qs.get("limit"), 1, 50, 20);
  const layout = (qs.get("layout") || "list").toLowerCase(); // list | carousel
  const header = qs.get("header") !== "0";
  const images = qs.get("images") !== "0";
  const fetchArticleImages = qs.get("fetchArticleImages") !== "0"; // ON by default
  const forcedSource = (qs.get("source") || "").trim();

  // DOM
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
    showError("Flux non autorisé.\n\nFlux autorisés :\n- " + ALLOWED_FEEDS.join("\n- "));
    return;
  }

  if (!header) {
    feedTitleEl.style.display = "none";
    hintEl.style.display = "none";
  } else {
    hintEl.textContent = `limit: ${limit} | layout: ${layout} | images: ${images ? "on" : "off"}`;
  }

  // =========================
  // 4) Proxies
  // =========================
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
        if (!txt) throw new Error("Réponse vide");

        if (expect === "xml") {
          const head = txt.trimStart().slice(0, 300).toLowerCase();
          const looksXml =
            head.startsWith("<?xml") ||
            head.startsWith("<rss") ||
            head.startsWith("<feed") ||
            head.includes("<channel") ||
            head.includes("<rss") ||
            head.includes("<feed");
          const looksHtml = head.startsWith("<!doctype") || head.startsWith("<html") || head.includes("<body");
          if (!looksXml || looksHtml) throw new Error("Réponse non RSS/Atom");
        }

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
    const alt = node.querySelector('link[rel="alternate"][href]') || node.querySelector("link[href]");
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
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(d);
  }

  function getSummaryHtml(node, type) {
    if (type === "rss") return text(node, "content\\:encoded") || text(node, "description");
    return text(node, "content") || text(node, "summary");
  }

  function getSourceLabel(node) {
    return (forcedSource || text(node, "source") || text(node, "dc\\:creator") || "").trim();
  }

  function pickImageFromFeed(node, type, linkForAbs) {
    if (!images) return "";

    const enc = node.querySelector("enclosure[url]");
    if (enc && enc.getAttribute("url")) return absUrl(enc.getAttribute("url"), linkForAbs);

    const mc = node.querySelector("media\\:content[url], content[url]");
    if (mc && mc.getAttribute("url")) return absUrl(mc.getAttribute("url"), linkForAbs);

    const mt = node.querySelector("media\\:thumbnail[url], thumbnail[url]");
    if (mt && mt.getAttribute("url")) return absUrl(mt.getAttribute("url"), linkForAbs);

    const aenc = node.querySelector('link[rel="enclosure"][href]');
    if (aenc && aenc.getAttribute("href")) return absUrl(aenc.getAttribute("href"), linkForAbs);

    const html = getSummaryHtml(node, type);
    const img = firstImgFromHtml(html);
    return img ? absUrl(img, linkForAbs) : "";
  }

  // =========================
  // 6) Article-page image fallback (Hypothèses)
  // =========================
  const articleImgCache = new Map(); // link -> imgUrl

  async function pickImageFromArticlePage(link) {
    if (!images || !fetchArticleImages) return "";
    if (!link || link === "#") return "";

    if (articleImgCache.has(link)) return articleImgCache.get(link);

    try {
      const html = await fetchTextWithFallback(link, { expect: "html" });
      const doc = new DOMParser().parseFromString(html, "text/html");

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

      const content =
        doc.querySelector(".entry-content") ||
        doc.querySelector("article") ||
        doc.querySelector("main") ||
        doc.body;

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
    } catch {
      // silence
    }

    articleImgCache.set(link, "");
    return "";
  }

  // =========================
  // 7) Text cleaning
  // =========================
  function cleanExcerpt(s) {
    let t = String(s || "").replace(/\s+/g, " ").trim();

    // supprime "Résumé Résumé en français ..." / "Résumé en français ..." etc.
    t = t.replace(/^(résumé\s*)+(en\s+(français|anglais)\s*)?/i, "").trim();
    t = t.replace(/^[:\-–—|]\s*/g, "").trim();

    return t;
  }

  // =========================
  // 8) Render
  // =========================
  function makeMetaLine(src, dateFr) {
    if (!src && !dateFr) return "";
    return `
      <div class="meta-line">
        ${src ? `<span class="source">${escapeHtml(src)}</span>` : ``}
        ${dateFr ? `<span class="date">${escapeHtml(dateFr)}</span>` : ``}
      </div>
    `;
  }

  function makeListItem({ title, link, src, dateFr, excerpt, img }) {
    // Un seul contour = .item
    return `
      <a class="item" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">
        ${img ? `<div class="media"><img src="${escapeAttr(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>` : ``}
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
  // 9) Main
  // =========================
  (async () => {
    try {
      const xmlText = await fetchTextWithFallback(feed, { expect: "xml" });
      const xmlDoc = new DOMParser().parseFromString(xmlText, "text/xml");

      const channelTitle = getTitle(xmlDoc);
      if (channelTitle) feedTitleEl.textContent = channelTitle;

      const { type, items } = getItems(xmlDoc);
      const sliced = items.slice(0, limit);
      if (!sliced.length) throw new Error("Aucun item/entry détecté dans le flux.");

      const entries = [];
      for (const node of sliced) {
        const title = text(node, "title") || "Sans titre";
        const link = getLink(node, type) || "#";
        const dateFr = formatDateFr(getPublishedRaw(node, type));

        const summaryHtml = getSummaryHtml(node, type);
        const excerpt = cleanExcerpt(stripHtml(summaryHtml)).slice(0, 260);

        const src = getSourceLabel(node);

        // image : d'abord flux
        let img = pickImageFromFeed(node, type, link);

        // fallback : page article (Hypothèses surtout)
        if (!img && images && fetchArticleImages) {
          img = await pickImageFromArticlePage(link);
        }

        entries.push({ title, link, src, dateFr, excerpt, img });
      }

      if (layout === "carousel") {
        swiperBox.style.display = "block";
        slidesEl.innerHTML = "";

        for (const e of entries) {
          const slide = document.createElement("div");
          slide.className = "swiper-slide";
          slide.innerHTML = makeCarouselCard(e);
          slidesEl.appendChild(slide);
        }

        // eslint-disable-next-line no-undef
        new Swiper(".swiper", {
          slidesPerView: 1,
          spaceBetween: 18,
          loop: false,
          pagination: { el: ".swiper-pagination", clickable: true },
          navigation: { nextEl: ".swiper-button-next", prevEl: ".swiper-button-prev" },
          breakpoints: { 760: { slidesPerView: 2 }, 1120: { slidesPerView: 3 } },
        });
      } else {
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
