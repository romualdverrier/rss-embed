/* docs/app.js */
/* RSS Embed (GitHub Pages) - list + carousel + robust RSS/Atom + better image picking (skip logos) */

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
      // enlève les / finaux du pathname
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
  const header = qs.get("header") !== "0"; // visible by default

  // images=0 pour couper totalement
  const images = qs.get("images") !== "0";
  // fetchArticleImages=0 pour empêcher le fallback (page article)
  const fetchArticleImages = qs.get("fetchArticleImages") !== "0";

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
    hintEl.textContent = `limit: ${limit} | layout: ${layout} | images: ${
      images ? "on" : "off"
    }`;
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
    // évite d’afficher une URL entière comme “source”
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
  // 6) Image picking (skip logos)
  // =========================

  // Heuristique “ça ressemble à un logo / icône”
  function looksLikeLogoUrl(u) {
    const s = String(u || "").toLowerCase();

    // classiques
    if (s.includes("favicon")) return true;
    if (s.includes("logo")) return true;
    if (s.includes("site-icon")) return true;
    if (s.includes("apple-touch-icon")) return true;
    if (s.includes("avatar")) return true;

    // thèmes WP / Hypothèses : images dans themes / assets (souvent logo)
    if (s.includes("/wp-content/themes/")) return true;
    if (s.includes("/themes/")) return true;

    return false;
  }

  // Préfère les images “contenu” WP : uploads
  function looksLikeContentImage(u) {
    const s = String(u || "").toLowerCase();
    if (s.includes("/wp-content/uploads/")) return true;
    if (s.includes("/files/")) return true; // Hypothèses utilise parfois /files/
    return false;
  }

  function pickImageFromFeed(node, type, baseLink) {
    if (!images) return "";

    const candidates = [];

    // RSS enclosure
    const enc = node.querySelector("enclosure[url]");
    if (enc && enc.getAttribute("url")) candidates.push(enc.getAttribute("url"));

    // media:content / media:thumbnail
    const mc = node.querySelector("media\\:content[url], content[url]");
    if (mc && mc.getAttribute("url")) candidates.push(mc.getAttribute("url"));

    const mt = node.querySelector("media\\:thumbnail[url], thumbnail[url]");
    if (mt && mt.getAttribute("url")) candidates.push(mt.getAttribute("url"));

    // Atom enclosure
    const aenc = node.querySelector('link[rel="enclosure"][href]');
    if (aenc && aenc.getAttribute("href")) candidates.push(aenc.getAttribute("href"));

    // content/description embedded <img>
    const html = getSummaryHtml(node, type);
    const imgInHtml = firstImgFromHtml(html);
    if (imgInHtml) candidates.push(imgInHtml);

    // normalisation + filtrage logo
    for (const c of candidates) {
      const u = absUrl(c, baseLink);
      if (!u) continue;
      if (looksLikeLogoUrl(u)) continue;
      return u;
    }
    return "";
  }

  const articleImgCache = new Map(); // link -> imgUrl

  async function pickImageFromArticlePage(link) {
    if (!images || !fetchArticleImages) return "";
    if (!link || link === "#") return "";

    if (articleImgCache.has(link)) return articleImgCache.get(link);

    try {
      const html = await fetchTextWithFallback(link, { expect: "html" });
      const doc = new DOMParser().parseFromString(html, "text/html");

      // (1) og:image / twitter:image — mais on filtre les logos
      const og =
        doc.querySelector('meta[property="og:image"][content]') ||
        doc.querySelector('meta[name="twitter:image"][content]') ||
        doc.querySelector('meta[name="twitter:image:src"][content]');

      if (og && og.getAttribute("content")) {
        const u = absUrl(og.getAttribute("content"), link);
        if (u && !looksLikeLogoUrl(u)) {
          // si c'est une image “contenu”, on prend direct
          if (looksLikeContentImage(u)) {
            articleImgCache.set(link, u);
            return u;
          }
          // sinon on garde comme candidate, mais on essaie d’abord la vraie image de contenu
        }
      }

      // (2) zone contenu
      const content =
        doc.querySelector(".entry-content") ||
        doc.querySelector("article .entry-content") ||
        doc.querySelector("article") ||
        doc.querySelector("main") ||
        doc.body;

      if (content) {
        const imgs = Array.from(content.querySelectorAll("img[src]"));

        // stratégie : prend la première image “contenu” (uploads/files) non-logo
        for (const img of imgs) {
          const src = img.getAttribute("src");
          if (!src) continue;
          const u = absUrl(src, link);
          if (!u) continue;
          if (looksLikeLogoUrl(u)) continue;

          // si on voit clairement que c'est une image de thème, skip
          if (!looksLikeContentImage(u) && u.includes("/wp-content/themes/")) continue;

          // bonus : évite les toutes petites images (icônes) si width/height sont donnés
          const w = parseInt(img.getAttribute("width") || "", 10);
          const h = parseInt(img.getAttribute("height") || "", 10);
          if (!Number.isNaN(w) && !Number.isNaN(h)) {
            if (w < 120 || h < 90) continue;
          }

          articleImgCache.set(link, u);
          return u;
        }
      }

      // si rien, on tente quand même og:image même si pas “uploads”, tant que ce n’est pas logo
      if (og && og.getAttribute("content")) {
        const u = absUrl(og.getAttribute("content"), link);
        if (u && !looksLikeLogoUrl(u)) {
          articleImgCache.set(link, u);
          return u;
        }
      }
    } catch {
      // silent fail
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

    // supprime les préfixes moches fréquents (Edunumrech)
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
  // 8) Render (classes compatibles avec ton index.html actuel)
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
    const hasImg = Boolean(img);

    return `
      <a class="item ${hasImg ? "" : "no-media"}" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">
        ${
          hasImg
            ? `<div class="media"><img src="${escapeAttr(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`
            : ``
        }
        <div class="body">
          <div class="title">${escapeHtml(title)}</div>
          ${makeMetaLine(src, dateFr)}
          ${excerpt ? `<div class="excerpt">${escapeHtml(excerpt)}</div>` : ``}
        </div>
      </a>
    `;
  }

  function makeCarouselCard({ title, link, src, dateFr, excerpt, img }) {
    const hasImg = Boolean(img);

    return `
      <a class="card" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">
        ${
          hasImg
            ? `<div class="card-media" style="background-image:url('${escapeAttr(img)}')"></div>`
            : `<div class="card-media placeholder"></div>`
        }
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
      // RSS fetch (tolère / final)
      let xmlText;
      try {
        xmlText = await fetchTextWithFallback(feed, { expect: "xml" });
      } catch {
        const alt = feed.endsWith("/") ? feed.slice(0, -1) : feed + "/";
        xmlText = await fetchTextWithFallback(alt, { expect: "xml" });
      }

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
        const excerpt = truncateWithEllipsis(cleanExcerpt(stripHtml(summaryHtml)), 260);

        const src = getSourceLabel(node);

        // image from feed first
        let img = pickImageFromFeed(node, type, link);

        // fallback from article page
        if (!img && images && fetchArticleImages) {
          img = await pickImageFromArticlePage(link);
        }

        // dernier filtre anti-logo (au cas où)
        if (img && looksLikeLogoUrl(img)) img = "";

        entries.push({ title, link, src, dateFr, excerpt, img });
      }

      if (layout === "carousel") {
        swiperBox.style.display = "block";

        // si vraiment aucune image sur tout le flux => on retire l’espace image (CSS index.html)
        const anyImg = entries.some((e) => Boolean(e.img));
        if (!anyImg) swiperBox.classList.add("no-media-feed");
        else swiperBox.classList.remove("no-media-feed");

        slidesEl.innerHTML = entries
          .map((e) => `<div class="swiper-slide">${makeCarouselCard(e)}</div>`)
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
