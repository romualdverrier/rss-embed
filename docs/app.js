/* docs/app.js */
/* RSS Embed (GitHub Pages) - list + carousel
   - whitelist
   - source clean (strip <a href=...>)
   - excerpt clean + ellipsis
   - image fallback: og:image / twitter:image / first img (src, data-src, srcset)
   - if no images at all -> compact carousel (no image area)
*/

(() => {
  // =========================
  // 1) Whitelist
  // =========================
const ALLOWED_FEEDS = [
  "https://edunumrech.hypotheses.org/feed",
  "https://edunumrech.hypotheses.org/feed/",
  "https://muse.pleiade.education.fr/rss/dcaf719f-f512-4e26-94b0-7f2bc15d0e74/",
];

// Normalise : enlève le slash final (sauf "https://")
function normalizeUrl(u){
  try{
    const url = new URL(u);
    // garde l'origine + pathname sans slash final
    url.pathname = url.pathname.replace(/\/+$/, "");
    // mais si pathname vide => "/"
    if (url.pathname === "") url.pathname = "/";
    url.hash = "";
    // on garde la query car ton feed n'en a pas, mais ce n'est pas grave
    return url.toString().replace(/\/$/, ""); // normalise encore un peu
  } catch {
    return String(u || "").replace(/\/+$/, "");
  }
}

const feedNorm = normalizeUrl(feed);
const allowedNorm = new Set(ALLOWED_FEEDS.map(normalizeUrl));

if (!feed) {
  showError("Paramètre manquant : ?feed=https://...");
  return;
}

// Sécurité : refuse tout flux non whitelisté (avec tolérance / final)
if (!allowedNorm.has(feedNorm)) {
  showError(
    "Flux non autorisé.\n\nFlux autorisés :\n- " +
    Array.from(allowedNorm).join("\n- ")
  );
  return;
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
  const fetchArticleImages = qs.get("fetchArticleImages") !== "0"; // ON by default
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

  // IMPORTANT : certains flux (MUSE) mettent du HTML dans dc:creator/source => on nettoie
  function cleanSourceLabel(raw, linkForHostname = "") {
    let s = String(raw || "").trim();
    if (!s) return "";

    // si ça contient du HTML, on garde seulement le texte
    if (s.includes("<") && s.includes(">")) s = stripHtml(s);

    // si c'est une URL, on réduit au hostname
    if (/^https?:\/\//i.test(s)) {
      try {
        s = new URL(s).hostname.replace(/^www\./, "");
      } catch {}
    }

    // parfois on récupère un truc du genre "<a href='...'>Label</a>" -> maintenant ok.
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function getSourceLabel(node, linkForHostname) {
    const raw =
      forcedSource ||
      text(node, "source") ||
      text(node, "dc\\:creator") ||
      text(node, "author") ||
      "";
    return cleanSourceLabel(raw, linkForHostname);
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
  // 6) Image fallback from article page (Hypothèses)
  // =========================
  const articleImgCache = new Map(); // link -> imgUrl

  function pickBestImgUrlFromElement(imgEl, baseLink) {
    if (!imgEl) return "";
    const candidates = [];

    const attrs = ["src", "data-src", "data-lazy-src", "data-original", "data-orig-file"];
    for (const a of attrs) {
      const v = imgEl.getAttribute(a);
      if (v) candidates.push(v);
    }

    // srcset: on prend le dernier (souvent le plus grand)
    const srcset = imgEl.getAttribute("srcset") || imgEl.getAttribute("data-srcset");
    if (srcset) {
      const parts = srcset.split(",").map((p) => p.trim().split(" ")[0]).filter(Boolean);
      if (parts.length) candidates.push(parts[parts.length - 1]);
    }

    for (const c of candidates) {
      const u = absUrl(c, baseLink);
      if (u) return u;
    }
    return "";
  }

  async function pickImageFromArticlePage(link) {
    if (!images || !fetchArticleImages) return "";
    if (!link || link === "#") return "";
    if (articleImgCache.has(link)) return articleImgCache.get(link);

    try {
      const html = await fetchTextWithFallback(link, { expect: "html" });
      const doc = new DOMParser().parseFromString(html, "text/html");

      // 1) OG/Twitter
      const og =
        doc.querySelector('meta[property="og:image"][content]') ||
        doc.querySelector('meta[name="twitter:image"][content]') ||
        doc.querySelector('meta[name="twitter:image:src"][content]');
      if (og && og.getAttribute("content")) {
        const u = absUrl(og.getAttribute("content"), link);
        if (u) return (articleImgCache.set(link, u), u);
      }

      // 2) WordPress/Hypothèses content
      const content =
        doc.querySelector(".entry-content") ||
        doc.querySelector("article") ||
        doc.querySelector("main") ||
        doc.body;

      if (content) {
        // d'abord figure img, souvent l'image “mise en avant”
        let img = content.querySelector("figure img, .wp-post-image, img");
        const u = pickBestImgUrlFromElement(img, link);
        if (u) return (articleImgCache.set(link, u), u);
      }
    } catch {
      // silent
    }

    articleImgCache.set(link, "");
    return "";
  }

  // =========================
  // 7) Excerpt clean + ellipsis
  // =========================
  function cleanExcerpt(s) {
    let t = String(s || "").trim();
    t = t.replace(/\s+/g, " ").trim();

    // supprime préfixes moches (edunumrech)
    // "Résumé Résumé en français ..." / "Résumé en français ..." / "Résumé en anglais ..."
    t = t.replace(/^(résumé\s*)+(en\s+(français|anglais|espagnol)\s*)?/i, "").trim();

    // supprime "En anglais," "En français," au début (souvent redondant)
    t = t.replace(/^(en\s+(anglais|français|espagnol)\s*[,:\-–—]?\s*)/i, "").trim();

    // supprime séparateurs au début
    t = t.replace(/^[:\-–—|]\s*/g, "").trim();

    return t;
  }

  function truncateWithEllipsis(s, max) {
    const t = String(s || "");
    if (t.length <= max) return t;
    return t.slice(0, max).replace(/\s+\S*$/, "").trim() + "…";
  }

  // =========================
  // 8) Render
  // =========================
  function metaLine(src, dateFr) {
    if (!src && !dateFr) return "";
    return `
      <div class="meta-line">
        ${src ? `<span class="source">${escapeHtml(src)}</span>` : ``}
        ${dateFr ? `<span class="meta">${escapeHtml(dateFr)}</span>` : ``}
      </div>
    `;
  }

  function listItem({ title, link, src, dateFr, excerpt, img }) {
    const imgHtml = img
      ? `<div class="media"><img src="${escapeAttr(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`
      : ``;

    return `
      <a class="item ${img ? "" : "no-media"}" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">
        ${imgHtml}
        <div class="body">
          <div class="title">${escapeHtml(title)}</div>
          ${metaLine(src, dateFr)}
          ${excerpt ? `<div class="excerpt">${escapeHtml(excerpt)}</div>` : ``}
        </div>
      </a>
    `;
  }

  function carouselCard({ title, link, src, dateFr, excerpt, img }, compactNoMedia) {
    const media = compactNoMedia
      ? ``
      : (img
          ? `<div class="card-media" style="background-image:url('${escapeAttr(img)}')"></div>`
          : `<div class="card-media placeholder"></div>`);

    return `
      <a class="card ${compactNoMedia ? "compact" : ""}" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">
        ${media}
        <div class="card-body">
          <div class="card-title">${escapeHtml(title)}</div>
          ${metaLine(src, dateFr)}
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

        const dateFr = formatDateFr(getPublishedRaw(node, type));

        const summaryHtml = getSummaryHtml(node, type);
        const excerpt = truncateWithEllipsis(cleanExcerpt(stripHtml(summaryHtml)), 260);

        const src = getSourceLabel(node, link);

        // image from feed
        let img = pickImageFromFeed(node, type);
        img = img ? absUrl(img, link) : "";

        // fallback from article page
        if (!img && images && fetchArticleImages) {
          img = await pickImageFromArticlePage(link);
        }

        entries.push({ title, link, src, dateFr, excerpt, img });
      }

      if (layout === "carousel") {
        swiperBox.style.display = "block";

        const hasAnyImage = entries.some((e) => !!e.img);
        const compactNoMedia = !hasAnyImage; // si aucune image dans tout le flux, on enlève la zone image

        slidesEl.innerHTML = entries
          .map((e) => `<div class="swiper-slide">${carouselCard(e, compactNoMedia)}</div>`)
          .join("");

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
        listBox.innerHTML = entries.map(listItem).join("");
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
