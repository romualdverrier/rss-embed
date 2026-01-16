// ============================
// RSS Embed – app.js consolidé
// ============================

// ---------- CONFIG ----------
const ALLOWED_FEEDS = [
  "https://edunumrech.hypotheses.org/feed",
  "https://muse.pleiade.education.fr/rss/dcaf719f-f512-4e26-94b0-7f2bc15d0e74/"
];

// Proxys CORS (fallback)
const PROXIES = [
  u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  u => "https://corsproxy.io/?" + encodeURIComponent(u),
  u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u)
];

// ---------- PARAMS ----------
const qs = new URLSearchParams(location.search);
const feed = qs.get("feed");
const limit = Math.max(1, Math.min(50, parseInt(qs.get("limit") || "20", 10)));
const layout = (qs.get("layout") || "list").toLowerCase();
const header = qs.get("header") !== "0";

const feedTitleEl = document.getElementById("feedTitle");
const hintEl = document.getElementById("hint");
const errEl = document.getElementById("err");

// ---------- HELPERS ----------
function showError(msg) {
  errEl.style.display = "block";
  errEl.textContent = msg;
}

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
  const m = /<img[^>]+src="([^"]+)"/i.exec(html || "");
  return m ? m[1] : "";
}

function formatDateFr(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d)) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(d);
}

// ---------- FETCH ----------
async function fetchXml(url) {
  let lastErr = null;

  for (const mk of PROXIES) {
    try {
      const target = mk(url);
      const r = await fetch(target, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const txt = await r.text();
      if (!txt.includes("<rss") && !txt.includes("<feed")) {
        throw new Error("not RSS");
      }
      return txt;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Impossible de charger le flux.");
}

// ---------- EXTRACTION ----------
function pickImage(item) {
  // enclosure
  const enc = item.querySelector("enclosure[url]");
  if (enc?.getAttribute("url")) return enc.getAttribute("url");

  // media:content
  const mc = item.querySelector("media\\:content[url]");
  if (mc?.getAttribute("url")) return mc.getAttribute("url");

  // media:thumbnail
  const mt = item.querySelector("media\\:thumbnail[url]");
  if (mt?.getAttribute("url")) return mt.getAttribute("url");

  // content:encoded (WordPress)
  const encoded = text(item, "content\\:encoded");
  const img1 = firstImgFromHtml(encoded);
  if (img1) return img1;

  // description fallback
  const desc = text(item, "description");
  const img2 = firstImgFromHtml(desc);
  if (img2) return img2;

  return "";
}

function getSource(item) {
  return (
    text(item, "source") ||
    text(item, "dc\\:creator") ||
    ""
  );
}

// ---------- RENDER ----------
function buildCard({ title, link, source, date, excerpt, image }) {
  return `
    <a class="card" href="${link}" target="_blank">
      <div class="card-thumb" style="background-image:url('${image || ""}')"></div>
      <div class="content">
        <div class="card-title">${title}</div>
        <div class="meta-line">
          ${source ? `<span class="source">${source}</span>` : ""}
          ${date ? `<span class="meta">${date}</span>` : ""}
        </div>
        <p class="excerpt">${excerpt}</p>
      </div>
    </a>
  `;
}

function buildRow({ title, link, source, date, excerpt, image }) {
  const noThumb = !image;
  return `
    <a class="row ${noThumb ? "no-thumb" : ""}" href="${link}" target="_blank">
      <div class="thumb ${noThumb ? "placeholder" : ""}" style="background-image:url('${image || ""}')"></div>
      <div class="txt">
        <div class="row-title">${title}</div>
        <div class="meta-line">
          ${source ? `<span class="source">${source}</span>` : ""}
          ${date ? `<span class="meta">${date}</span>` : ""}
        </div>
        <p class="excerpt">${excerpt}</p>
      </div>
    </a>
  `;
}

// ---------- MAIN ----------
(async function () {
  if (!feed) return showError("Paramètre manquant : ?feed=https://...");
  if (!ALLOWED_FEEDS.includes(feed)) {
    return showError("Flux non autorisé.");
  }

  if (!header) {
    feedTitleEl.style.display = "none";
    hintEl.style.display = "none";
  }

  try {
    const xml = await fetchXml(feed);
    const doc = new DOMParser().parseFromString(xml, "text/xml");

    const title = doc.querySelector("channel > title, feed > title")?.textContent;
    if (title) feedTitleEl.textContent = title.trim();

    const items = Array.from(doc.querySelectorAll("item, entry")).slice(0, limit);

    if (!items.length) throw new Error("Aucun item détecté");

    const listBox = document.getElementById("listBox");
    const slides = document.getElementById("slides");

    items.forEach(item => {
      const title = text(item, "title") || "Sans titre";
      const link = text(item, "link") || item.querySelector("link")?.getAttribute("href") || "#";
      const rawDate = text(item, "pubDate") || text(item, "updated") || text(item, "dc\\:date");
      const date = formatDateFr(rawDate);
      const source = getSource(item);
      const summary = stripHtml(text(item, "description") || text(item, "summary") || text(item, "content\\:encoded"));
      const excerpt = summary.slice(0, 220) + (summary.length > 220 ? "…" : "");
      const image = pickImage(item);

      const data = { title, link, source, date, excerpt, image };

      if (layout === "carousel") {
        const slide = document.createElement("div");
        slide.className = "swiper-slide";
        slide.innerHTML = buildCard(data);
        slides.appendChild(slide);
      } else {
        listBox.insertAdjacentHTML("beforeend", buildRow(data));
      }
    });

    if (layout === "carousel") {
      document.getElementById("swiperBox").style.display = "block";
      new Swiper(".swiper", {
        slidesPerView: 1,
        spaceBetween: 16,
        pagination: { el: ".swiper-pagination", clickable: true },
        navigation: { nextEl: ".swiper-button-next", prevEl: ".swiper-button-prev" },
        breakpoints: {
          720: { slidesPerView: 2 },
          1060: { slidesPerView: 3 }
        }
      });
    } else {
      listBox.style.display = "flex";
    }

  } catch (e) {
    showError("Erreur : " + e.message);
  }
})();
