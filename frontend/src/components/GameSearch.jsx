import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./GameSearch.module.css";

const GENRES = [
  "Action",
  "Adventure",
  "Shooter",
  "Puzzle",
  "Strategy",
  "Sports",
  "Fighting",
  "Racing"
];

const PLATFORMS = ["PC", "PlayStation", "Xbox", "Nintendo"];
const MAX_RECOMMENDATIONS = 5;

export default function GameSearch() {
  const navigate = useNavigate();
  const containerRef = useRef(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rateLimitMsg, setRateLimitMsg] = useState("");
  const [genres, setGenres] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [open, setOpen] = useState(false);

  /* ───────── SEARCH FETCH ───────── */
  useEffect(() => {
     if (
  query.trim().length < 3 &&
  genres.length === 0 &&
  platforms.length === 0
) {
  setResults([]);
  setOpen(false);
  return;
}

    const controller = new AbortController();
    const id = setTimeout(async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          q: query,
          genres: genres.join(","),
          platforms: platforms.join(",")
        });

        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/api/search/games?${params.toString()}`,
          { signal: controller.signal }
        );

        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          setRateLimitMsg(data.error || "Too many search requests, please slow down");
          setTimeout(() => setRateLimitMsg(""), 5000);
          return;
        }

        if (!res.ok) return;
        const data = await res.json();
        setResults(data);
        setOpen(true);
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
  }, [query, genres, platforms]);

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

  function toggle(list, value, set) {
    set(
      list.includes(value)
        ? list.filter(v => v !== value)
        : [...list, value]
    );
  }

  const showResults = open && results.length > 0;
  const showLoader = open && loading;

  return (
    <div className={styles.gsRoot}>
      <div className={styles.gsContainer} ref={containerRef}>
        {/* SEARCH INPUT */}
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length && query.trim().length >= 3) {
              setOpen(true);
            }
          }}
          placeholder="Search games by name…"
          className={styles.gsInput}
        />

        {/* LOADER */}
        <div className={`${styles.loaderFloat} ${showLoader ? styles.visible : ""}`}>
          Searching…
        </div>

        {/* RATE LIMIT */}
        {rateLimitMsg && (
          <div className={`${styles.loaderFloat} ${styles.visible}`} style={{ color: "var(--color-error, #f85149)" }}>
            {rateLimitMsg}
          </div>
        )}

        {/* RESULTS */}
        <div className={`${styles.resultsFloat} ${showResults ? styles.visible : ""}`}>
          {results.slice(0, MAX_RECOMMENDATIONS).map(g => (
            <div
              key={g.id}
              className={styles.resultRow}
              onClick={() => {
                setOpen(false);
                navigate(`/game/${g.id}`);
              }}
            >
              {g.name}
            </div>
          ))}
        </div>

        {/* GENRE FILTER */}
        <div className={styles.filterRow}>
          <div className={styles.filterInner}>
            <span className={styles.filterLabel}>Genre</span>
            <div className={styles.pillGroup}>
              {GENRES.map(g => (
                <button
                  key={g}
                  onClick={() => toggle(genres, g, setGenres)}
                  className={`${styles.pill} ${genres.includes(g) ? styles.active : ""}`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* PLATFORM FILTER */}
        <div className={styles.filterRow}>
          <div className={styles.filterInner}>
            <span className={styles.filterLabel}>Platform</span>
            <div className={styles.pillGroup}>
              {PLATFORMS.map(p => (
                <button
                  key={p}
                  onClick={() =>
                    toggle(platforms, p.toLowerCase(), setPlatforms)
                  }
                  className={`${styles.pill} ${
                    platforms.includes(p.toLowerCase()) ? styles.active : ""
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
