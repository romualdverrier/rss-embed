/* docs/app.js */
/* RSS Embed (GitHub Pages) - list + carousel
   - whitelist feeds
   - CORS proxies fallback
   - images: from feed, then optional from article page (OG image / first img)
   - If NO images in the whole feed: carousel renders without media area (no empty space)
   - List: one single border per item; no reserved image column when missing
*/

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

  // =========================
  // 3) DOM refs
  // =========================
  const feedTitleEl = document.getElementById("feedTitle");
  const hintEl = document.getElementById("hint");
  const errEl = document.getElementById("err");

  const swiperBox = document.getElementById("swiperBox");
  const slidesEl = document.getElementById("slides");
  const listBox = document.getElementById("listBox");

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
  // 4) Proxies (RAW)
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
        const head = (txt || "").trimStart().slice(0, 350).toLowerCase();
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
    return (forcedSource || text(node, "source") || text(node, "dc\\:creator") || "").trim();
  }

  function pickImageFromFeed(node, type) {
    if (!images) return "";

    const enc = node.querySelector("enclosure[url]");
    if (enc && enc.getAttribute("url")) return enc.getAttribute("url");

    const mc = node.querySelector("media\\:content[url], content[url]");
    if (mc && mc.getAttribute("url")) return mc.getAttribute("url");

    const mt = node.querySelector("media\\:thumbnail[url], thumbnail[url]");
    if (mt && mt.getAttribute("url")) return mt.getAttribute("url");

    const aenc = node.querySelector('link[rel="enclosure"][href]');
    if (aenc && aenc.getAttribute("href")) return aenc.getAttribute("href");

    const html = getSummaryHtml(node, type);
    return firstImgFromHtml(html);
  }

  // =========================
  // 6) Image fallback from article page
  // =========================
  const articleImgCache = new Map(); // link -> imgUrl

  async function pickImageFromArticlePage(link) {
    if (!images || !fetchArticleImages) return "";
    if (!link || link === "#") return "";

    if (articleImgCache.has(link)) return articleImgCache.get(link);

    try {
      const html = await fetchTextWithFallback(link, { expect: "html" });
      const doc = new DOMParser().parseFromString(html, "text/html");

      // OG / Twitter
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

      // first <img> in main content
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
      // silent
    }

    articleImgCache.set(link, "");
    return "";
  }

  // =========================
  // 7) Text cleaning
  // =========================
  function cleanExcerpt(s) {
    let t = String(s || "").trim();
    t = t.replace(/\s+/g, " ").trim();

    // supprime les préfixes "Résumé Résumé en français ..." etc.
    t = t.replace(/^(résumé\s*)+(en\s+(français|anglais)\s*)?/i, "").trim();
    t = t.replace(/^[:\-–—|]\s*/g, "").trim();
    return t;
  }

  // =========================
  // 8) Render helpers
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
    // 1 seul cadre (.item). Si pas d'image: pas de colonne.
    return `
      <a class="item ${img ? "" : "no-media"}" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">
        ${img ? `<div class="media"><img src="${escapeAttr(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>` : ``}
        <div class="body">
          <div class="title">${escapeHtml(title)}</div>
          ${makeMetaLine(src, dateFr)}
          ${excerpt ? `<div class="excerpt">${escapeHtml(excerpt)}</div>` : ``}
        </div>
      </a>
    `;
  }

  function makeCarouselCard({ title, link, src, dateFr, excerpt, img }, { showMediaArea, showPlaceholder }) {
    // Si le flux n'a AUCUNE image: showMediaArea=false => pas de zone média du tout.
    // Si le flux a des images mais l'item n'en a pas:
    // - showPlaceholder=true => placeholder discret
    // - sinon => pas de zone média pour cet item (hauteur variable)
    let media = "";
    if (showMediaArea) {
      if (img) {
        media = `<div class="card-media" style="background-image:url('${escapeAttr(img)}')"></div>`;
      } else if (showPlaceholder) {
        media = `<div class="card-media placeholder"></div>`;
      } else {
        media = ``;
      }
    }

    return `
      <a class="card" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">
        ${media}
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
      const doc = new DOMParser().parseFromString(xmlText, "text/xml");

      const channelTitle = getTitle(doc);
      if (channelTitle) feedTitleEl.textContent = channelTitle;

      const { type, items } = getItems(doc);
      const sliced = items.slice(0, limit);
      if (!sliced.length) throw new Error("Aucun item/entry détecté dans le flux.");

      const entries = [];
      for (const node of sliced) {
        const title = text(node, "title") || "Sans titre";
        const link = getLink(node, type) || "#";

        const pubRaw = getPublishedRaw(node, type);
        const dateFr = formatDateFr(pubRaw);

        const summaryHtml = getSummaryHtml(node, type);
        const excerpt = cleanExcerpt(stripHtml(summaryHtml)).slice(0, 260);

        const src = getSourceLabel(node);

        // image: feed first
        let img = pickImageFromFeed(node, type);
        img = img ? absUrl(img, link) : "";

        // fallback article page (Hypothèses)
        if (!img && images && fetchArticleImages) {
          img = await pickImageFromArticlePage(link);
        }

        entries.push({ title, link, src, dateFr, excerpt, img });
      }

      const hasAnyImage = images && entries.some((e) => !!e.img);

      if (layout === "carousel") {
        swiperBox.style.display = "block";

        // si aucune image dans le flux => pas de zone image du tout
        if (!hasAnyImage) swiperBox.classList.add("no-media-feed");
        else swiperBox.classList.remove("no-media-feed");

        const showMediaArea = hasAnyImage;      // sinon -> aucune zone media
        const showPlaceholder = false;          // mets true si tu veux placeholder pour items sans image

        const cardsHtml = entries
          .map((e) => makeCarouselCard(e, { showMediaArea, showPlaceholder }))
          .join("");

        // wrapper slides
        slidesEl.innerHTML = cardsHtml
          .split("</a>")
          .filter(Boolean)
          .map((chunk) => `<div class="swiper-slide">${chunk}</a></div>`)
          .join("");

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
