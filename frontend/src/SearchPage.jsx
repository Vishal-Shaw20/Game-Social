import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import GameSearch from "./components/GameSearch";
import GameCard from "./components/GameCard";
import PlatformIcon from "./components/PlatformIcon";
import Footer from "./components/Footer";
import { toPlatformFamilies } from "./utils/normalizeGames";
import styles from "./SearchPage.module.css";
import { useQuickLook } from "./components/quicklook/quickLookContext";

const API_URL = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 40;

const PLATFORM_LABELS = {
  pc: "PC",
  playstation: "PlayStation",
  xbox: "Xbox",
  nintendo: "Nintendo",
  mobile: "Mobile",
};

const splitList = (v) => (v ? v.split(",").filter(Boolean) : []);

// /api/search/games rows -> the shape GameCard expects.
function toCard(g) {
  return {
    id: String(g.id),
    rawgId: g.id,
    title: g.name,
    cover: g.background_image || "",
    year: g.year ?? null,
    genres: g.genres ?? [],
    platforms: toPlatformFamilies(g.platforms),
    metacritic: g.metacritic ?? null,
    rating: g.rating ?? null,
  };
}

/**
 * Full results for a search: everything /api/search/games matches, as game
 * cards, loaded a page at a time as you scroll. Reached by pressing Enter in
 * the search bar or picking one of its suggestions. The query lives in the
 * URL (?q, &genres, &platforms), so results can be linked, reloaded and
 * walked with Back/Forward.
 */
export default function SearchPage() {
  const quickLook = useQuickLook();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const genresParam = params.get("genres") ?? "";
  const platformsParam = params.get("platforms") ?? "";
  const genres = splitList(genresParam);
  const platforms = splitList(platformsParam);
  const valid = q.trim().length > 0 || genres.length > 0;

  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);

  // Bumped on every new search; a response for an older one is dropped.
  const searchId = useRef(0);
  const sentinelRef = useRef(null);

  async function loadPage(offset, id) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        q,
        genres: genresParam,
        platforms: platformsParam,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await fetch(`${API_URL}/api/search/games?${qs}`);
      if (id !== searchId.current) return;
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Too many searches, please slow down.");
        setHasMore(false);
        return;
      }
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const { total: count, results: rows } = await res.json();
      if (id !== searchId.current) return;
      // The total comes with the first page; later pages keep it.
      if (offset === 0) setTotal(count);
      const known = offset === 0 ? count : total;
      setItems((prev) => {
        const next = [...prev, ...rows.map(toCard)];
        setHasMore(rows.length > 0 && next.length < known);
        return next;
      });
    } catch (e) {
      if (id === searchId.current) setError(e.message);
    } finally {
      if (id === searchId.current) setLoading(false);
    }
  }

  // New search whenever the URL's query changes.
  useEffect(() => {
    const id = ++searchId.current;
    setItems([]);
    setHasMore(false);
    setTotal(0);
    setError("");
    if (valid) loadPage(0, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, genresParam, platformsParam]);

  // Next page when the bottom of the grid comes into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadPage(items.length, searchId.current);
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, items.length]);

  // Same as the homepage: the dock gets out of the way once the page is
  // scrolled all the way down to the footer.
  const endRef = useRef(null);
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setAtEnd(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // With no text in the bar, the heading points at the bar rather than
  // listing every selected genre (which could run to a dozen words); the
  // genres show as tags below, as they do for a text search.
  const heading = q.trim()
    ? <>Results for <span className={styles.query}>“{q.trim()}”</span></>
    : "Search for a game";
  const hint = q.trim()
    ? null
    : genres.length
      ? "Type a name in the search bar below to narrow these down."
      : "Type a name in the search bar below, or pick a genre.";

  const genreTags = genres;
  // Platform filter keys (?platforms=pc,mobile) as logos, the same icons the
  // game cards use. Unknown keys are dropped, as the backend ignores them.
  const platformIcons = platforms
    .filter((k) => PLATFORM_LABELS[k])
    .map((k) => ({ key: k, label: PLATFORM_LABELS[k] }));

  return (
    <div className={styles.page}>
      <main className={styles.results}>
        <header className={styles.header}>
          <h1 className={styles.title}>{heading}</h1>
          {hint && <p className={styles.hint}>{hint}</p>}
          <div className={styles.meta}>
            {genreTags.map((f) => (
              <span key={f} className={styles.filterTag}>{f}</span>
            ))}
            {valid && total > 0 && (
              <span className={styles.count}>
                {total.toLocaleString()} {total === 1 ? "result matches" : "results match"} your search
              </span>
            )}
          </div>
          {platformIcons.length > 0 && (
            <ul
              className={styles.platforms}
              aria-label={`Platforms: ${platformIcons.map((p) => p.label).join(", ")}`}
            >
              {platformIcons.map((p) => (
                <li key={p.key} title={p.label}>
                  <PlatformIcon platform={p.key} size={16} />
                </li>
              ))}
            </ul>
          )}
        </header>

        {valid && !loading && !error && items.length === 0 && (
          <p className={styles.empty}>No games match this search. Try fewer filters or a shorter name.</p>
        )}

        {error && <p className={`${styles.empty} ${styles.error}`}>{error}</p>}

        {items.length > 0 && (
          <div className={styles.grid}>
            {items.map((g) => (
              <GameCard key={g.id} game={g} onOpen={() => quickLook(g, { list: items })} />
            ))}
          </div>
        )}

        {loading && <p className={styles.loading}>Loading…</p>}
        <div ref={sentinelRef} aria-hidden="true" />
      </main>

      <Footer />
      <div ref={endRef} className={styles.endMarker} aria-hidden="true" />

      {/* Not keyed by the search: remounting on every URL change closed the
          filter menu and dropped focus mid-edit. GameSearch follows URL
          changes (Back/Forward) itself. */}
      <GameSearch
        hidden={atEnd}
        live
        suggestions={false}
        initialQuery={q}
        initialGenres={genres}
        initialPlatforms={platforms}
      />
    </div>
  );
}
