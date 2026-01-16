import re
from urllib.parse import urlparse

import feedparser
import httpx
from fastapi import FastAPI, Query, Response
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from starlette.staticfiles import StaticFiles
import time

# --- Réglages simples (tu peux les ajuster) ---
ALLOWED_HOSTS = {
    "edunumrech.hypotheses.org",
    "muse.pleiade.education.fr",
}

CACHE_TTL_SECONDS = 600  # 10 min
MAX_LIMIT = 50

# --- Cache en mémoire (simple + suffisant pour démarrer) ---
_cache: dict[str, tuple[float, bytes]] = {}

templates = Jinja2Templates(directory="templates")

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")


def _is_allowed(rss_url: str) -> bool:
    try:
        host = urlparse(rss_url).hostname
        return bool(host) and host.lower() in ALLOWED_HOSTS
    except Exception:
        return False


def _pick_image(entry: dict) -> str | None:
    # 1) media:content / media:thumbnail (WordPress / certains flux)
    for key in ("media_content", "media_thumbnail"):
        if key in entry and isinstance(entry[key], list) and entry[key]:
            u = entry[key][0].get("url")
            if u:
                return u

    # 2) enclosure (souvent dans entry.links)
    for link in entry.get("links", []) or []:
        if link.get("rel") == "enclosure":
            t = (link.get("type") or "").lower()
            if "image" in t and link.get("href"):
                return link["href"]

    # 3) première image dans le summary (si flux contient du HTML)
    summary = entry.get("summary", "") or ""
    m = re.search(r'<img[^>]+src="([^"]+)"', summary, re.IGNORECASE)
    if m:
        return m.group(1)

    return None


def _clean_text(s: str) -> str:
    # On retire HTML + espaces
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


async def _fetch_bytes(rss_url: str) -> bytes:
    now = time.time()
    cached = _cache.get(rss_url)
    if cached and (now - cached[0] < CACHE_TTL_SECONDS):
        return cached[1]

    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        r = await client.get(rss_url, headers={"User-Agent": "rss-embed/1.0"})
        r.raise_for_status()
        data = r.content

    _cache[rss_url] = (now, data)
    return data


@app.get("/", response_class=PlainTextResponse)
def home():
    return "OK. Use /embed?url=<rss>&limit=20&layout=carousel"


@app.get("/embed", response_class=HTMLResponse)
async def embed(
    request: Request,
    response: Response,
    url: str = Query(..., description="RSS/Atom URL"),
    limit: int = Query(20, ge=1, le=MAX_LIMIT),
    layout: str = Query("carousel", pattern="^(carousel|list)$"),
    images: int = Query(1, ge=0, le=1),
    title: str | None = Query(None),
):
    # Sécurité : on whiteliste les hôtes (simple et robuste)
    if not _is_allowed(url):
        return HTMLResponse(
            content=f"<h3>Flux non autorisé</h3><p>Host autorisés: {', '.join(sorted(ALLOWED_HOSTS))}</p>",
            status_code=400,
        )

    data = await _fetch_bytes(url)
    feed = feedparser.parse(data)

    items = []
    for e in (feed.entries or [])[:limit]:
        img = _pick_image(e) if images == 1 else None
        items.append(
            {
                "title": (e.get("title") or "").strip(),
                "link": (e.get("link") or "").strip(),
                "published": (e.get("published") or e.get("updated") or "").strip(),
                "summary": _clean_text(e.get("summary") or e.get("description") or ""),
                "image": img,
            }
        )

    page_title = title or (feed.feed.get("title") if feed.feed else None) or "Flux RSS"

    # Headers pour autoriser l'embed (Magistère)
    response.headers["X-Frame-Options"] = "ALLOWALL"
    response.headers["Content-Security-Policy"] = "frame-ancestors *;"

    return templates.TemplateResponse(
        "embed.html",
        {
            "request": request,
            "page_title": page_title,
            "items": items,
            "layout": layout,
        },
    )
