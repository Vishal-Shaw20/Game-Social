import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { scoreColor } from "../utils/scoreColor";
import { searchUrl } from "../utils/searchUrl";
import styles from "./GameSearch.module.css";

/* Every genre in the games table (RAWG's full genre set), alphabetical.
   Values must match games.genres exactly, case aside. */
const GENRES = [
  "Action",
  "Adventure",
  "Arcade",
  "Board Games",
  "Card",
  "Casual",
  "Educational",
  "Family",
  "Fighting",
  "Indie",
  "Massively Multiplayer",
  "Platformer",
  "Puzzle",
  "Racing",
  "RPG",
  "Shooter",
  "Simulation",
  "Sports",
  "Strategy"
];

/* Platform families; the backend expands each to its consoles
   (PLATFORM_FAMILIES in routes/searchRoutes.js). */
const PLATFORMS = ["PC", "PlayStation", "Xbox", "Nintendo", "Mobile"];
/* Suggestions are fetched a page at a time; the list scrolls and asks for
   the next page as it nears the bottom (same paging as the /search page). */
const PAGE_SIZE = 15;
const LOAD_MORE_PX = 80;
const HOVER_CLOSE_DELAY = 180;

/* ───────── HOVER-EXPANDING FILTER ───────── */
function FilterMenu({ label, options, selected, onToggle, onClear, wide = false }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);
  const wrapRef = useRef(null);
  const chipRef = useRef(null);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  function show() {
    clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function hide() {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY);
  }

  function onBlur(e) {
    if (!wrapRef.current?.contains(e.relatedTarget)) setOpen(false);
  }

  return (
    <div
      ref={wrapRef}
      className={styles.filterWrap}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={onBlur}
    >
      <button
        ref={chipRef}
        type="button"
        className={`${styles.filterChip} ${open ? styles.chipOpen : ""} ${
          selected.length ? styles.chipActive : ""
        }`}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span>{label}</span>
        {selected.length > 0 && (
          <span className={styles.chipCount}>{selected.length}</span>
        )}
        <svg
          className={styles.chevron}
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="M1 6.5L5 2.5L9 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className={`${styles.filterPanel} ${wide ? styles.panelWide : ""} ${open ? styles.panelOpen : ""}`}>
        <div className={styles.panelHead}>
          <span className={styles.panelLabel}>{label}</span>
          {/* Always mounted, just hidden when there's nothing to clear.
              Unmounting it on click dropped focus to <body>, which blurred
              the whole bar and closed the panel; instead, focus hands back
              to this menu's chip so the bar stays active. */}
          <button
            type="button"
            className={`${styles.clearBtn} ${selected.length ? "" : styles.clearHidden}`}
            tabIndex={open && selected.length ? 0 : -1}
            aria-hidden={selected.length ? undefined : "true"}
            onClick={() => {
              onClear();
              chipRef.current?.focus();
            }}
          >
            Clear
          </button>
        </div>

        <div className={styles.pillGroup}>
          {options.map(opt => {
            const value = opt.value ?? opt;
            const text = opt.label ?? opt;
            return (
              <button
                key={value}
                type="button"
                tabIndex={open ? 0 : -1}
                onClick={() => onToggle(value)}
                className={`${styles.pill} ${
                  selected.includes(value) ? styles.pillActive : ""
                }`}
              >
                {text}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// hidden: tucked away (hidden at the bottom of the page, over the footer).
// Stays mounted so the query and filters survive.
// initial*: starting values (the /search page passes the current search).
// live: filter changes open the results page straight away (on /search the
// page itself is the results, so there's no need to press Enter).
// suggestions: the as-you-type dropdown. Off on /search, where the page
// already shows the results; typing there searches on Enter.
export default function GameSearch({
  hidden = false,
  initialQuery = "",
  initialGenres = [],
  initialPlatforms = [],
  live = false,
  suggestions = true,
}) {
  const navigate = useNavigate();
  const containerRef = useRef(null);

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rateLimitMsg, setRateLimitMsg] = useState("");
  const [genres, setGenres] = useState(initialGenres);
  const [platforms, setPlatforms] = useState(initialPlatforms);
  const [open, setOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  // Every match, not just the ones loaded ("Showing 15 of 1,408").
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef(null);
  // Bumped per search, so a page that arrives after the query changed is
  // dropped instead of appended to the new results.
  const searchId = useRef(0);

  function searchParams(offset) {
    return new URLSearchParams({
      q: query,
      genres: genres.join(","),
      platforms: platforms.join(","),
      limit: String(PAGE_SIZE),
      offset: String(offset)
    });
  }

  // Only open the dropdown once the user has changed something, so a
  // prefilled bar on /search doesn't pop its suggestions over the page.
  const touched = useRef(false);

  // replace: swap the current history entry instead of adding one. Used
  // for live filter changes, so Back doesn't step through every click.
  function submit(q = query, { replace = false } = {}) {
    const url = searchUrl(q, genres, platforms);
    if (!url) return;
    if (!replace) setOpen(false);
    navigate(url, { replace });
  }

  // On /search, the page follows the bar live: a filter change re-runs the
  // search at once, and typing does after a short pause (so it's one search
  // per word, not per key). History is replaced, not added to. Text of 1-2
  // characters waits, as the dropdown does; the bar stays mounted
  // throughout, so an open filter menu stays open.
  const LIVE_TYPING_DELAY = 400;
  const lastLive = useRef({ query, genres, platforms });
  useEffect(() => {
    if (!live || !touched.current) return;
    const prev = lastLive.current;
    lastLive.current = { query, genres, platforms };
    const text = query.trim();
    if (text.length > 0 && text.length < 3) return;
    const typed = prev.query !== query;
    const id = setTimeout(
      () => submit(query, { replace: true }),
      typed ? LIVE_TYPING_DELAY : 0
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, genres, platforms]);

  // Follow the URL when it changes from outside the bar (Back/Forward, a
  // link). When the bar caused the change the values already match, so this
  // does nothing. Compared as strings: the page passes fresh arrays each
  // render.
  const urlGenres = initialGenres.join(",");
  const urlPlatforms = initialPlatforms.join(",");
  useEffect(() => {
    if (
      initialQuery === query &&
      urlGenres === genres.join(",") &&
      urlPlatforms === platforms.join(",")
    ) return;
    // Not a user edit: don't re-submit or pop the dropdown open.
    touched.current = false;
    setQuery(initialQuery);
    setGenres(urlGenres ? urlGenres.split(",") : []);
    setPlatforms(urlPlatforms ? urlPlatforms.split(",") : []);
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, urlGenres, urlPlatforms]);

  /* ───────── SEARCH FETCH ───────── */
  useEffect(() => {
    // Platform only narrows a search, it isn't one on its own: with no text
    // and no genre, "all PC games" is half the catalogue, so nothing is shown.
    const sid = ++searchId.current;
    if (!suggestions || (query.trim().length < 3 && genres.length === 0)) {
      setResults([]);
      setHasMore(false);
      setTotal(0);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    const id = setTimeout(async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/api/search/games?${searchParams(0)}`,
          { signal: controller.signal }
        );

        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          setRateLimitMsg(data.error || "Too many search requests, please slow down");
          setTimeout(() => setRateLimitMsg(""), 5000);
          return;
        }

        if (!res.ok) return;
        const { total: count, results: rows } = await res.json();
        if (sid !== searchId.current) return;
        setResults(rows);
        setTotal(count);
        setHasMore(rows.length < count);
        if (listRef.current) listRef.current.scrollTop = 0;
        if (touched.current) setOpen(true);
      } catch (e) {
        if (e.name !== "AbortError") console.error(e);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(id);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, genres, platforms]);

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    const sid = searchId.current;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/search/games?${searchParams(results.length)}`
      );
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setRateLimitMsg(data.error || "Too many search requests, please slow down");
        setTimeout(() => setRateLimitMsg(""), 5000);
        return;
      }
      if (!res.ok || sid !== searchId.current) return;
      const { results: rows } = await res.json();
      if (sid !== searchId.current) return;
      setResults(prev => {
        const next = [...prev, ...rows];
        setHasMore(rows.length > 0 && next.length < total);
        return next;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMore(false);
    }
  }

  function onListScroll(e) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_PX) loadMore();
  }

  /* ───────── CLICK OUTSIDE CLOSE ───────── */
  useEffect(() => {
    function onClick(e) {
      if (!containerRef.current?.contains(e.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /* ───────── ESC CLOSE ───────── */
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function toggle(value, set) {
    touched.current = true;
    set(list =>
      list.includes(value)
        ? list.filter(v => v !== value)
        : [...list, value]
    );
  }

  const showResults = open && results.length > 0;
  const showLoader = open && loading;

  return (
    <div
      className={`${styles.dockRoot} ${hidden ? styles.dockHidden : ""}`}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      <div className={styles.dock} ref={containerRef}>
        {/* RESULTS — opens upward, above the bar */}
        <div
          ref={listRef}
          className={`${styles.resultsFloat} ${showResults ? styles.visible : ""}`}
          onScroll={onListScroll}
        >
          {results.map(g => (
            <div
              key={g.id}
              className={styles.resultRow}
              // Opens the results page for that game's name (with the current
              // filters), rather than the game page itself.
              onClick={() => submit(g.name)}
            >
              <span className={styles.resultName}>{g.name}</span>
              {/* Same tags as the card's year and score. */}
              <span className={styles.resultMeta}>
                {g.year && <span className={styles.resultTag}>{g.year}</span>}
                {g.metacritic != null && (
                  <span
                    className={styles.resultTag}
                    style={{ color: scoreColor(g.metacritic) }}
                    title="Metacritic"
                  >
                    {g.metacritic}
                    <span className={styles.resultPct}>%</span>
                  </span>
                )}
              </span>
            </div>
          ))}
          <div className={styles.resultMore}>
            {loadingMore
              ? "Loading more…"
              : `Showing ${results.length.toLocaleString()} of ${total.toLocaleString()} · Enter for all results`}
          </div>
        </div>

        {/* STATUS LINE */}
        {rateLimitMsg ? (
          <div className={`${styles.statusFloat} ${styles.visible} ${styles.statusError}`}>
            {rateLimitMsg}
          </div>
        ) : (
          <div className={`${styles.statusFloat} ${showLoader ? styles.visible : ""}`}>
            Searching…
          </div>
        )}

        {/* BAR */}
        <div className={styles.bar}>
          <svg
            className={styles.searchIcon}
            width="18"
            height="18"
            viewBox="0 0 18 18"
            aria-hidden="true"
          >
            <circle
              cx="7.5"
              cy="7.5"
              r="5.25"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <path
              d="M11.6 11.6L15.75 15.75"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>

          <input
            value={query}
            onChange={e => {
              touched.current = true;
              setQuery(e.target.value);
            }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            onFocus={() => {
              if (results.length && query.trim().length >= 3) {
                setOpen(true);
              }
            }}
            placeholder="Search games by name…"
            className={styles.gsInput}
          />

          <div className={styles.divider} />

          <FilterMenu
            label="Genre"
            wide
            options={GENRES}
            selected={genres}
            onToggle={value => toggle(value, setGenres)}
            onClear={() => {
              touched.current = true;
              setGenres([]);
            }}
          />

          <FilterMenu
            label="Platform"
            options={PLATFORMS.map(p => ({ value: p.toLowerCase(), label: p }))}
            selected={platforms}
            onToggle={value => toggle(value, setPlatforms)}
            onClear={() => {
              touched.current = true;
              setPlatforms([]);
            }}
          />
        </div>
      </div>
    </div>
  );
}
