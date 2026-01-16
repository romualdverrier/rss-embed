/* docs/app.js */
/* RSS Embed (GitHub Pages) - FAST rendering + background images + cache 7 days */

(() => {
  // =========================
  // 1) Whitelist (tolère / final)
  // =========================
  const ALLOWED_FEEDS = [
    "https://edunumrech.hypotheses.org/feed",
    "https://edunumrech.hypotheses.org/feed/",
    "https://muse.pleiade.education.fr/rss/dcaf719f-f512-4e26-94b0-7f2bc15d0e74/",
  ];

  function normalizeUrl(u) {
    try {
      const url = new URL(u);
      url.hash = "";
      url.pathname = url.pathname.replace(/\/+$/, "");
      return url.toString().replace(/\/$/, "");
    } catch {
      return String(u || "").replace(/\/+$/, "");
    }
  }

  // =========================
  // 2) Params
  // =========================
  const qs = new URLSearchParams(location.search);
  const feed = qs.get("feed");
  const limit = clampInt(qs.get("limit"), 1, 50, 20);
  const layout = (qs.get("layout") || "list").toLowerCase(); // list | carousel
  const header = qs.get("header") !== "0";

  const images = qs.get("images") !== "0";
  const fetchArticleImages = qs.get("fetchArticleImages") !== "0";

  // FAST defaults (can be overridden in URL)
  const imgMax = clampInt(qs.get("imgMax"), 0, 50, 6); // <= 6 by default
  const imgConcurrency = clampInt(qs.get("imgConcurrency"), 1, 8, 3);
  const imgTimeoutMs = clampInt(qs.get("imgTimeoutMs"), 500, 15000, 3000);

  const forcedSource = (qs.get("source") || "").trim();

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

  const feedNorm = normalizeUrl(feed);
  const allowedNorm = new Set(ALLOWED_FEEDS.map(normalizeUrl));
  if (!allowedNorm.has(feedNorm)) {
    showError(
      "Flux non autorisé.\n\nFlux autorisés :\n- " +
        Array.from(allowedNorm).join("\n- ")
    );
    return;
  }

  if (!header) {
    feedTitleEl.style.display = "none";
    hintEl.style.display = "none";
  } else {
    hintEl.textContent =
      `limit: ${limit} | layout: ${layout} | images: ${images ? "on" : "off"}` +
      (images && fetchArticleImages ? ` | imgMax: ${imgMax}` : "");
  }

  // =========================
  // 4) Proxies (RAW)
  // =========================
  const PROXIES = [
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    (u) => "https://corsproxy.io/?" + encodeURIComponent(u),
    (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
  ];

  async function fetchTextWithFallback(url, { expect = "xml", timeoutMs = 8000 } = {}) {
    let lastErr = null;

    for (const mk of PROXIES) {
      const target = mk(url);
      try {
        const txt = await fetchWithTimeout(target, timeoutMs);
        const head = (txt || "").trimStart().slice(0, 350).toLowerCase();
        if (!txt) throw new Error("Réponse vide");

        if (expect === "xml") {
          const looksXml =
            head.startsWith("<?xml") ||
            head.startsWith("<rss") ||
            head.startsWith("<feed") ||
            head.includes("<channel") ||
            head.includes("<rss") ||
            head.includes("<feed") ||
            head.includes("<entry") ||
            head.includes("<item");
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

  async function fetchWithTimeout(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } finally {
      clearTimeout(t);
    }
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

  function cleanSourceLabel(raw) {
    const s = stripHtml(String(raw || "")).trim();
    if (/^https?:\/\/\S+$/i.test(s)) return "";
    return s;
  }

  function getSourceLabel(node) {
    const s =
      forcedSource ||
      text(node, "source") ||
      text(node, "dc\\:creator") ||
      "";
    return cleanSourceLabel(s);
  }

  // =========================
  // 6) Text cleaning
  // =========================
  function cleanExcerpt(s) {
    let t = String(s || "").trim();
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/^(résumé\s*)+(en\s+(français|anglais|espagnol)\s*)?/i, "").trim();
    t = t.replace(/^[:\-–—|]\s*/g, "").trim();
    return t;
  }

  function truncateWithEllipsis(s, max) {
    const t = String(s || "").trim();
    if (!t) return "";
    if (t.length <= max) return t;
    return t.slice(0, max).replace(/\s+\S*$/, "").trim() + "…";
  }

  // =========================
  // 7) Image picking (skip logos)
  // =========================
  function looksLikeLogoUrl(u) {
    const s = String(u || "").toLowerCase();
    if (s.includes("favicon")) return true;
    if (s.includes("logo")) return true;
    if (s.includes("site-icon")) return true;
    if (s.includes("apple-touch-icon")) return true;
    if (s.includes("avatar")) return true;
    if (s.includes("/wp-content/themes/")) return true;
    return false;
  }

  function looksLikeContentImage(u) {
    const s = String(u || "").toLowerCase();
    if (s.includes("/wp-content/uploads/")) return true;
    if (s.includes("/files/")) return true; // Hypothèses
    return false;
  }

  function pickImageFromFeed(node, type, baseLink) {
    if (!images) return "";

    const candidates = [];

    const enc = node.querySelector("enclosure[url]");
    if (enc && enc.getAttribute("url")) candidates.push(enc.getAttribute("url"));

    const mc = node.querySelector("media\\:content[url], content[url]");
    if (mc && mc.getAttribute("url")) candidates.push(mc.getAttribute("url"));

    const mt = node.querySelector("media\\:thumbnail[url], thumbnail[url]");
    if (mt && mt.getAttribute("url")) candidates.push(mt.getAttribute("url"));

    const aenc = node.querySelector('link[rel="enclosure"][href]');
    if (aenc && aenc.getAttribute("href")) candidates.push(aenc.getAttribute("href"));

    const html = getSummaryHtml(node, type);
    const imgInHtml = firstImgFromHtml(html);
    if (imgInHtml) candidates.push(imgInHtml);

    for (const c of candidates) {
      const u = absUrl(c, baseLink);
      if (!u) continue;
      if (looksLikeLogoUrl(u)) continue;
      return u;
    }
    return "";
  }

  // =========================
  // 8) Cache images (7 days) + background fetch queue
  // =========================
  const CACHE_KEY = "rss_embed_imgcache_v1";
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }

  function saveCache(cacheObj) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheObj));
    } catch {
      // ignore quota errors
    }
  }

  const imgCache = loadCache();

  function cacheGet(link) {
    const k = String(link || "");
    const e = imgCache[k];
    if (!e || typeof e !== "object") return "";
    if (Date.now() > (e.expires || 0)) return "";
    return String(e.url || "");
  }

  function cacheSet(link, url) {
    const k = String(link || "");
    imgCache[k] = { url, expires: Date.now() + CACHE_TTL_MS };
    saveCache(imgCache);
  }

  async function pickImageFromArticlePage(link) {
    if (!images || !fetchArticleImages) return "";
    if (!link || link === "#") return "";

    const cached = cacheGet(link);
    if (cached) return cached;

    try {
      const html = await fetchTextWithFallback(link, { expect: "html", timeoutMs: imgTimeoutMs });
      const doc = new DOMParser().parseFromString(html, "text/html");

      // OG image
      const og =
        doc.querySelector('meta[property="og:image"][content]') ||
        doc.querySelector('meta[name="twitter:image"][content]') ||
        doc.querySelector('meta[name="twitter:image:src"][content]');

      const ogUrl = og ? absUrl(og.getAttribute("content") || "", link) : "";
      if (ogUrl && !looksLikeLogoUrl(ogUrl) && looksLikeContentImage(ogUrl)) {
        cacheSet(link, ogUrl);
        return ogUrl;
      }

      // Content area
      const content =
        doc.querySelector(".entry-content") ||
        doc.querySelector("article .entry-content") ||
        doc.querySelector("article") ||
        doc.querySelector("main") ||
        doc.body;

      if (content) {
        const imgs = Array.from(content.querySelectorAll("img[src]"));
        for (const img of imgs) {
          const src = img.getAttribute("src");
          if (!src) continue;
          const u = absUrl(src, link);
          if (!u) continue;
          if (looksLikeLogoUrl(u)) continue;

          // évite thèmes
          if (!looksLikeContentImage(u) && u.includes("/wp-content/themes/")) continue;

          // évite icônes minuscules si dimensions connues
          const w = parseInt(img.getAttribute("width") || "", 10);
          const h = parseInt(img.getAttribute("height") || "", 10);
          if (!Number.isNaN(w) && !Number.isNaN(h)) {
            if (w < 120 || h < 90) continue;
          }

          cacheSet(link, u);
          return u;
        }
      }

      // fallback og non-logo
      if (ogUrl && !looksLikeLogoUrl(ogUrl)) {
        cacheSet(link, ogUrl);
        return ogUrl;
      }
    } catch {
      // ignore
    }

    cacheSet(link, "");
    return "";
  }

  // simple queue with concurrency
  function runQueue(tasks, concurrency) {
    let i = 0;
    let active = 0;

    return new Promise((resolve) => {
      const next = () => {
        if (i >= tasks.length && active === 0) return resolve();
        while (active < concurrency && i < tasks.length) {
          const t = tasks[i++];
          active++;
          Promise.resolve()
            .then(t)
            .catch(() => {})
            .finally(() => {
              active--;
              next();
            });
        }
      };
      next();
    });
  }

  // =========================
  // 9) Render helpers (compatible index.html)
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

  function makeListItem(entry, idx) {
    const hasImg = Boolean(entry.img);
    return `
      <a class="item ${hasImg ? "" : "no-media"}" data-idx="${idx}"
         href="${escapeAttr(entry.link)}" target="_blank" rel="noopener noreferrer">
        ${hasImg ? `<div class="media"><img src="${escapeAttr(entry.img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>` : ``}
        <div class="body">
          <div class="title">${escapeHtml(entry.title)}</div>
          ${makeMetaLine(entry.src, entry.dateFr)}
          ${entry.excerpt ? `<div class="excerpt">${escapeHtml(entry.excerpt)}</div>` : ``}
        </div>
      </a>
    `;
  }

  function makeCarouselCard(entry, idx) {
    const hasImg = Boolean(entry.img);
    return `
      <a class="card" data-idx="${idx}"
         href="${escapeAttr(entry.link)}" target="_blank" rel="noopener noreferrer">
        ${
          hasImg
            ? `<div class="card-media" style="background-image:url('${escapeAttr(entry.img)}')"></div>`
            : `<div class="card-media placeholder"></div>`
        }
        <div class="card-body">
          <div class="card-title">${escapeHtml(entry.title)}</div>
          ${makeMetaLine(entry.src, entry.dateFr)}
          ${entry.excerpt ? `<div class="card-excerpt">${escapeHtml(entry.excerpt)}</div>` : ``}
        </div>
      </a>
    `;
  }

  function updateImageInDOM(layout, idx, imgUrl) {
    if (!imgUrl) return;

    if (layout === "carousel") {
      const card = slidesEl.querySelector(`.card[data-idx="${idx}"]`);
      if (!card) return;
      const media = card.querySelector(".card-media");
      if (!media) return;
      media.classList.remove("placeholder");
      media.style.backgroundImage = `url('${imgUrl.replaceAll("'", "\\'")}')`;
    } else {
      const item = listBox.querySelector(`.item[data-idx="${idx}"]`);
      if (!item) return;

      // si déjà une image, ne change pas
      if (item.querySelector(".media img")) return;

      const media = document.createElement("div");
      media.className = "media";
      media.innerHTML = `<img src="${escapeAttr(imgUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;

      // insère avant .body
      const body = item.querySelector(".body");
      if (body) item.insertBefore(media, body);

      item.classList.remove("no-media");
    }
  }

  // =========================
  // 10) Main
  // =========================
  (async () => {
    try {
      let xmlText;
      try {
        xmlText = await fetchTextWithFallback(feed, { expect: "xml", timeoutMs: 8000 });
      } catch {
        const alt = feed.endsWith("/") ? feed.slice(0, -1) : feed + "/";
        xmlText = await fetchTextWithFallback(alt, { expect: "xml", timeoutMs: 8000 });
      }

      const doc = new DOMParser().parseFromString(xmlText, "text/xml");

      const channelTitle = getTitle(doc);
      if (channelTitle) feedTitleEl.textContent = channelTitle;

      const { type, items } = getItems(doc);
      const sliced = items.slice(0, limit);
      if (!sliced.length) throw new Error("Aucun item/entry détecté dans le flux.");

      // 1) Build entries quickly (NO article-image fetching here)
      const entries = sliced.map((node) => {
        const title = text(node, "title") || "Sans titre";
        const link = getLink(node, type) || "#";
        const dateFr = formatDateFr(getPublishedRaw(node, type));
        const excerpt = truncateWithEllipsis(cleanExcerpt(stripHtml(getSummaryHtml(node, type))), 260);
        const src = getSourceLabel(node);

        let img = "";
        if (images) {
          img = pickImageFromFeed(node, type, link);
          if (img && looksLikeLogoUrl(img)) img = "";
        }

        return { title, link, src, dateFr, excerpt, img };
      });

      // 2) Render immediately
      if (layout === "carousel") {
        swiperBox.style.display = "block";

        const anyImgNow = entries.some((e) => Boolean(e.img));
        if (!anyImgNow) swiperBox.classList.add("no-media-feed");
        else swiperBox.classList.remove("no-media-feed");

        slidesEl.innerHTML = entries
          .map((e, idx) => `<div class="swiper-slide">${makeCarouselCard(e, idx)}</div>`)
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
        listBox.innerHTML = entries.map((e, idx) => makeListItem(e, idx)).join("");
      }

      // 3) Background enrich images (FAST) on first imgMax items only
      if (images && fetchArticleImages && imgMax > 0) {
        const tasks = [];
        for (let idx = 0; idx < Math.min(imgMax, entries.length); idx++) {
          // already has an image from feed
          if (entries[idx].img) continue;

          const link = entries[idx].link;
          tasks.push(async () => {
            const imgUrl = await pickImageFromArticlePage(link);
            if (!imgUrl) return;
            if (looksLikeLogoUrl(imgUrl)) return;

            // if we had "no-media-feed" and we found first image, remove class
            if (layout === "carousel") {
              if (swiperBox.classList.contains("no-media-feed")) {
                swiperBox.classList.remove("no-media-feed");
              }
            }

            updateImageInDOM(layout, idx, imgUrl);
          });
        }

        // Run with concurrency
        runQueue(tasks, imgConcurrency);
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
