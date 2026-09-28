// utils/gameSources.js
//
// Everything the game page pulls from outside our own database, one function
// per source, each cached (utils/pageCache.js) for as long as that data
// realistically stays fresh. Every function returns null rather than throwing
// when the source has nothing, so the page simply leaves that section out.
//
//   Steam store      appdetails: price, media, requirements, languages ...   6h
//   Steam reviews    appreviews summary ("Very Positive", counts)            6h
//   Steam players    players in-game right now                               5m
//   Steam news       latest news / patch notes                               1h
//   Steam achievements  schema (names, icons) + global unlock %              24h
//   SteamSpy         owners estimate, playtime, tags with votes              24h
//   RAWG             full record, store links, DLC, parents, series, shots   7d

import { cached } from "./pageCache.js";

const TIMEOUT_MS = 8000;
const UA = { "User-Agent": "GameSocial/1.0", Accept: "application/json" };

const H = 60 * 60;
const TTL = {
  store: 6 * H,
  reviews: 6 * H,
  players: 5 * 60,
  news: H,
  achievements: 24 * H,
  steamspy: 24 * H,
  rawg: 7 * 24 * H,
};

async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

/* ── small text helpers ── */

const stripTags = (s) =>
  String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

// "English<strong>*</strong>, French<br><strong>*</strong>languages with full
// audio support" -> [{ name: "English", audio: true }, { name: "French", ... }]
function parseLanguages(html) {
  if (!html) return [];
  const list = String(html).split(/<br\s*\/?>/i)[0];
  return list
    .split(",")
    .map((part) => ({
      name: stripTags(part).replace(/\*/g, "").trim(),
      audio: /\*/.test(part),
    }))
    .filter((l) => l.name);
}

/* ── Steam ── */

export function steamStore(appId) {
  return cached(`steam:store:${appId}`, TTL.store, async () => {
    const j = await getJson(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`
    );
    const d = j?.[appId]?.success ? j[appId].data : null;
    if (!d) return null;

    const ratings = {};
    for (const [board, r] of Object.entries(d.ratings ?? {})) {
      if (!r?.rating) continue;
      ratings[board] = {
        rating: r.rating,
        descriptors: r.descriptors ? stripTags(r.descriptors).trim() : null,
      };
    }

    return {
      appId: d.steam_appid,
      type: d.type,
      name: d.name,
      isFree: Boolean(d.is_free),
      requiredAge: Number(d.required_age) || 0,
      shortDescription: stripTags(d.short_description).trim() || null,
      detailedDescription: d.detailed_description || null,
      headerImage: d.header_image || null,
      background: d.background_raw || d.background || null,
      website: d.website || null,
      developers: d.developers ?? [],
      publishers: d.publishers ?? [],
      releaseDate: d.release_date ?? null, // { coming_soon, date }
      price: d.price_overview
        ? {
            currency: d.price_overview.currency,
            initial: d.price_overview.initial,
            final: d.price_overview.final,
            discountPercent: d.price_overview.discount_percent,
            initialFormatted: d.price_overview.initial_formatted || null,
            finalFormatted: d.price_overview.final_formatted,
          }
        : null,
      platforms: d.platforms ?? null, // { windows, mac, linux }
      categories: (d.categories ?? []).map((c) => c.description),
      genres: (d.genres ?? []).map((g) => g.description),
      screenshots: (d.screenshots ?? []).map((s) => ({
        thumb: s.path_thumbnail,
        full: s.path_full,
      })),
      trailers: (d.movies ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        thumb: m.thumbnail,
        hls: m.hls_h264 || null,
        dash: m.dash_h264 || null,
        mp4: m.mp4?.max || m.mp4?.["480"] || null, // older apps still have mp4
        highlight: Boolean(m.highlight),
      })),
      metacritic: d.metacritic ?? null, // { score, url }
      recommendations: d.recommendations?.total ?? null,
      achievementsTotal: d.achievements?.total ?? null,
      dlcCount: (d.dlc ?? []).length,
      controllerSupport: d.controller_support ?? null, // "full" | "partial"
      languages: parseLanguages(d.supported_languages),
      requirements: {
        pc: pickReq(d.pc_requirements),
        mac: d.platforms?.mac ? pickReq(d.mac_requirements) : null,
        linux: d.platforms?.linux ? pickReq(d.linux_requirements) : null,
      },
      ageRatings: ratings,
      contentNotes: d.content_descriptors?.notes
        ? stripTags(d.content_descriptors.notes).trim()
        : null,
      supportUrl: d.support_info?.url || null,
      legalNotice: d.legal_notice ? stripTags(d.legal_notice).trim() : null,
    };
  });
}

// Steam sends [] instead of {} when an OS has no requirements.
function pickReq(r) {
  if (!r || Array.isArray(r)) return null;
  if (!r.minimum && !r.recommended) return null;
  return { minimum: r.minimum || null, recommended: r.recommended || null };
}

export function steamReviews(appId) {
  return cached(`steam:reviews:${appId}`, TTL.reviews, async () => {
    const j = await getJson(
      `https://store.steampowered.com/appreviews/${appId}?json=1&num_per_page=0&language=all&purchase_type=all`
    );
    const q = j?.query_summary;
    if (!q?.total_reviews) return null;
    return {
      desc: q.review_score_desc,
      score: q.review_score, // 1..9
      positive: q.total_positive,
      negative: q.total_negative,
      total: q.total_reviews,
      percent: Math.round((q.total_positive / q.total_reviews) * 100),
    };
  });
}

export function steamPlayers(appId) {
  return cached(`steam:players:${appId}`, TTL.players, async () => {
    const j = await getJson(
      `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appId}`
    );
    return j?.response?.result === 1 ? j.response.player_count : null;
  });
}

/* ── Steam news ──
   Three tabs for the game page: "updates" and "patches" come from the
   developer's own Steam announcements (split by Steam's patchnotes tag, or
   a title like "Patch 2.31" / "Hotfix", since not every patch is tagged),
   "press" from everything else Steam collects, kept to Latin-script items
   so one foreign-language outlet can't fill the list. Official posts get
   their banner from the game's Steam RSS feed (the API's text has none);
   otherwise a post's first image, or its YouTube video's thumbnail. */
const NEWS_PAGE = 6;       // items per tab per page
const NEWS_BATCH = 40;     // items asked of Steam at a time
const NEWS_MAX_BATCHES = 3;
const PATCH_TITLE = /\b(patch(es)?|hot-?fix(es)?)\b/i;

/* A post's whole text for reading on the page: paragraphs and list items
   as line breaks and bullets, headings on their own lines, everything else
   (formatting, images, videos, bare links) dropped. Capped, for the odd
   enormous patch note. */
const NEWS_BODY_MAX = 20000;
function newsBody(contents) {
  let t = String(contents ?? "")
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, "")
    .replace(/\[(img|previewyoutube|video)[^\]]*\][\s\S]*?\[\/\1\]/gi, "")
    .replace(/\[\*\]/g, "\n• ")
    .replace(/\[\/?(p|h1|h2|h3|list|olist|quote|table|tr)[^\]]*\]/gi, "\n")
    .replace(/\[\/?[^\]]+\]/g, "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/?(p|div|h\d|ul|ol|blockquote|tr)[^>]*>/gi, "\n")
    .replace(/<img[^>]*>/gi, "");
  t = stripTags(t)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/•\s*\n+/g, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > NEWS_BODY_MAX ? t.slice(0, NEWS_BODY_MAX).replace(/\s+\S*$/, "") + "…" : t;
}

function newsImage(contents) {
  const c = String(contents ?? "");
  const img = c.match(/<img[^>]+src="(https:\/\/[^"]+)"/i) || c.match(/\[img\](https:\/\/[^\[\s]+)\[\/img\]/i);
  if (img) return img[1];
  const clan = c.match(/\{STEAM_CLAN_IMAGE\}(\/[^\s"\[\]]+)/);
  if (clan) return `https://clan.fastly.steamstatic.com/images${clan[1]}`;
  const yt = c.match(/\[previewyoutube="([\w-]{6,})/);
  if (yt) return `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`;
  return null;
}

// Mostly Latin letters (English and most European languages).
function isLatin(text) {
  const letters = String(text).match(/\p{L}/gu) ?? [];
  if (!letters.length) return true;
  const latin = letters.filter((ch) => /[A-Za-z\u00C0-\u024F]/.test(ch)).length;
  return latin / letters.length >= 0.8;
}

function shapeNews(n) {
  const official = n.feed_type === 1;
  const body = newsBody(n.contents);
  return {
    id: n.gid,
    title: n.title,
    url: n.url,
    source: official ? null : n.feedlabel || n.author || null,
    official,
    patch: official && ((n.tags ?? []).includes("patchnotes") || PATCH_TITLE.test(n.title)),
    date: n.date ? n.date * 1000 : null,
    body,
    image: newsImage(n.contents),
    latin: isLatin(`${n.title} ${body.slice(0, 400)}`),
  };
}

/** Banner images of the latest official posts, by post date (seconds). */
function steamNewsImages(appId) {
  return cached(`steam:newsimg:${appId}`, TTL.news, async () => {
    const r = await fetch(`https://store.steampowered.com/feeds/news/app/${appId}/?cc=US&l=english`, {
      headers: UA,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`steam rss ${r.status}`);
    const xml = await r.text();
    const out = {};
    for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
      const img = item.match(/<enclosure[^>]+url="([^"]+)"/);
      const when = item.match(/<pubDate>([^<]+)<\/pubDate>/);
      if (img && when) out[Math.floor(Date.parse(when[1]) / 1000)] = img[1];
    }
    return Object.keys(out).length ? out : null;
  });
}

/** One batch of the feed ("official" or "all"), older than `before` (ms). */
function steamNewsBatch(appId, feed, before) {
  const end = before ? Math.floor(before / 1000) - 1 : 0;
  // (v2: items carry the whole text, `body`; a new key so older cached
  // batches, which don't, aren't served)
  return cached(`steam:news2:${appId}:${feed}:${end}`, TTL.news, async () => {
    const u = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
    u.searchParams.set("appid", appId);
    u.searchParams.set("count", NEWS_BATCH);
    u.searchParams.set("maxlength", "0");
    u.searchParams.set("format", "json");
    if (feed === "official") u.searchParams.set("feeds", "steam_community_announcements");
    if (end) u.searchParams.set("enddate", end);
    const j = await getJson(u.toString());
    const items = j?.appnews?.newsitems ?? [];
    return { items: items.map(shapeNews), full: items.length >= NEWS_BATCH };
  });
}

/**
 * A tab's news ("updates" | "patches" | "press"), NEWS_PAGE items older than
 * `before` (ms, or none for the latest): { items, more }.
 */
export async function steamNewsTab(appId, tab, before = null) {
  const feed = tab === "press" ? "all" : "official";
  const keep =
    tab === "press" ? (n) => !n.official && n.latin
    : tab === "patches" ? (n) => n.patch
    : (n) => n.official && !n.patch;
  const items = [];
  let cursor = before;
  let more = false;
  for (let i = 0; i < NEWS_MAX_BATCHES && items.length <= NEWS_PAGE; i++) {
    const batch = await steamNewsBatch(appId, feed, cursor);
    if (!batch?.items.length) { more = false; break; }
    items.push(...batch.items.filter(keep));
    cursor = batch.items[batch.items.length - 1].date;
    more = batch.full;
    if (!batch.full) break;
  }
  const page = items.slice(0, NEWS_PAGE);
  if (feed === "official" && page.some((n) => !n.image)) {
    const images = await steamNewsImages(appId).catch(() => null);
    for (const n of page) n.image = images?.[Math.floor(n.date / 1000)] ?? n.image;
  }
  return { items: page.map(({ latin, ...n }) => n), more: items.length > NEWS_PAGE || more };
}

/** All three tabs' first page, for the game page; null when there's none. */
export async function steamNews(appId) {
  const [updates, patches, press] = await Promise.all(
    ["updates", "patches", "press"].map((tab) => steamNewsTab(appId, tab).catch(() => ({ items: [], more: false })))
  );
  if (!updates.items.length && !patches.items.length && !press.items.length) return null;
  return { updates, patches, press };
}

/**
 * Every achievement with its display name, icons and the share of all
 * players who have it, most common first. The schema needs the API key;
 * the percentages don't, so without a key the list still comes back with
 * internal names only.
 */
export function steamAchievements(appId) {
  return cached(`steam:ach:${appId}`, TTL.achievements, async () => {
    const key = process.env.STEAM_API_KEY;
    const [schema, global] = await Promise.all([
      key
        ? getJson(
            `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${key}&appid=${appId}&l=english`
          ).catch(() => null)
        : null,
      getJson(
        `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}`
      ).catch(() => null),
    ]);

    const defs = schema?.game?.availableGameStats?.achievements ?? [];
    const pct = new Map(
      (global?.achievementpercentages?.achievements ?? []).map((a) => [
        a.name,
        Number(a.percent),
      ])
    );
    if (!defs.length && !pct.size) return null;

    const list = defs.length
      ? defs.map((a) => ({
          name: a.name,
          displayName: a.displayName || a.name,
          description: a.description || null,
          hidden: a.hidden === 1,
          icon: a.icon || null,
          iconGray: a.icongray || null,
          percent: pct.has(a.name) ? pct.get(a.name) : null,
        }))
      : [...pct].map(([name, percent]) => ({
          name,
          displayName: name,
          description: null,
          hidden: false,
          icon: null,
          iconGray: null,
          percent,
        }));

    list.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
    return { total: list.length, list };
  });
}

/* ── SteamSpy (estimates; owners is a range, playtimes are minutes) ── */

export function steamSpy(appId) {
  return cached(`steamspy:${appId}`, TTL.steamspy, async () => {
    const d = await getJson(`https://steamspy.com/api.php?request=appdetails&appid=${appId}`);
    if (!d?.appid || !d.name) return null;
    const tags = Object.entries(d.tags && !Array.isArray(d.tags) ? d.tags : {})
      .map(([name, votes]) => ({ name, votes }))
      .sort((a, b) => b.votes - a.votes);
    return {
      owners: d.owners || null,
      positive: d.positive ?? null,
      negative: d.negative ?? null,
      peakYesterday: d.ccu ?? null,
      averageForever: d.average_forever || null,
      average2Weeks: d.average_2weeks || null,
      medianForever: d.median_forever || null,
      median2Weeks: d.median_2weeks || null,
      tags,
    };
  });
}

/* ── RAWG ── */

function rawgUrl(path, params = {}) {
  const u = new URL(`https://api.rawg.io/api/${path}`);
  u.searchParams.set("key", process.env.RAWG_API_KEY ?? "");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

const rawgCard = (g) => ({
  id: g.id,
  name: g.name,
  background_image: g.background_image || null,
  released: g.released || null,
  genres: (g.genres ?? []).map((x) => x.name),
  platforms: (g.platforms ?? []).map((p) => p.platform?.name).filter(Boolean),
  metacritic: g.metacritic ?? null,
  rating: g.rating ?? null,
});

/** The full RAWG record, trimmed to what the page uses. */
export function rawgDetail(rawgId) {
  if (!process.env.RAWG_API_KEY) return Promise.resolve(null);
  return cached(`rawg:detail:${rawgId}`, TTL.rawg, async () => {
    const g = await getJson(rawgUrl(`games/${rawgId}`));
    if (!g?.id) return null;
    const pcReq = (g.platforms ?? []).find((p) => p.platform?.slug === "pc")?.requirements;
    return {
      id: g.id,
      slug: g.slug,
      name: g.name,
      description: g.description || null,
      released: g.released || null,
      tba: Boolean(g.tba),
      background_image: g.background_image || null,
      background_image_additional: g.background_image_additional || null,
      website: g.website || null,
      rating: g.rating ?? null,
      rating_top: g.rating_top ?? null,
      ratings: (g.ratings ?? []).map((r) => ({ title: r.title, count: r.count, percent: r.percent })),
      ratings_count: g.ratings_count ?? null,
      metacritic: g.metacritic ?? null,
      metacritic_url: g.metacritic_url || null,
      metacritic_platforms: (g.metacritic_platforms ?? []).map((m) => ({
        platform: m.platform?.name,
        score: m.metascore,
        url: m.url,
      })),
      playtime: g.playtime || null, // average hours
      added: g.added ?? null,
      added_by_status: g.added_by_status ?? null,
      reddit_url: g.reddit_url || null,
      reddit_name: g.reddit_name || null,
      esrb: g.esrb_rating?.name ?? null,
      platforms: (g.platforms ?? []).map((p) => ({
        name: p.platform?.name,
        released: p.released_at || null,
      })),
      pc_requirements: pcReq && (pcReq.minimum || pcReq.recommended) ? pcReq : null,
      developers: (g.developers ?? []).map((x) => x.name),
      publishers: (g.publishers ?? []).map((x) => x.name),
      genres: (g.genres ?? []).map((x) => x.name),
      tags: (g.tags ?? []).filter((t) => t.language === "eng").map((t) => t.name),
      alternative_names: g.alternative_names ?? [],
      screenshots_count: g.screenshots_count ?? 0,
      achievements_count: g.achievements_count ?? 0,
      additions_count: g.additions_count ?? 0,
      parents_count: g.parents_count ?? 0,
      game_series_count: g.game_series_count ?? 0,
      updated: g.updated || null,
    };
  });
}

// store_id -> name, so the store links endpoint (which only sends ids and
// urls) doesn't need the detail call to label its links.
const RAWG_STORES = {
  1: "Steam", 2: "Xbox Store", 3: "PlayStation Store", 4: "App Store",
  5: "GOG", 6: "Nintendo Store", 7: "Xbox 360 Store", 8: "Google Play",
  9: "itch.io", 11: "Epic Games",
};

export function rawgStores(rawgId) {
  if (!process.env.RAWG_API_KEY) return Promise.resolve(null);
  return cached(`rawg:stores:${rawgId}`, TTL.rawg, async () => {
    const j = await getJson(rawgUrl(`games/${rawgId}/stores`));
    const list = (j?.results ?? [])
      .filter((s) => s.url)
      .map((s) => ({ storeId: s.store_id, name: RAWG_STORES[s.store_id] ?? "Store", url: s.url }));
    return list.length ? list : null;
  });
}

function rawgList(kind, rawgId, pageSize = 20) {
  if (!process.env.RAWG_API_KEY) return Promise.resolve(null);
  return cached(`rawg:${kind}:${rawgId}`, TTL.rawg, async () => {
    const j = await getJson(rawgUrl(`games/${rawgId}/${kind}`, { page_size: pageSize }));
    const list = (j?.results ?? []).map(rawgCard);
    return list.length ? list : null;
  });
}

export const rawgAdditions = (id) => rawgList("additions", id);
export const rawgParents = (id) => rawgList("parent-games", id, 10);
export const rawgSeries = (id) => rawgList("game-series", id, 20);

export function rawgScreenshots(rawgId) {
  if (!process.env.RAWG_API_KEY) return Promise.resolve(null);
  return cached(`rawg:screens:${rawgId}`, TTL.rawg, async () => {
    const j = await getJson(rawgUrl(`games/${rawgId}/screenshots`, { page_size: 40 }));
    const list = (j?.results ?? [])
      .filter((s) => s.image && !s.is_deleted)
      .map((s) => ({ thumb: s.image, full: s.image }));
    return list.length ? list : null;
  });
}
