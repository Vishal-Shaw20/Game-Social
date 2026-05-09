import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

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
    <div className="gs-root">
      <div className="gs-container" ref={containerRef}>
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
          className="gs-input"
        />

        {/* LOADER */}
        <div className={`loader-float ${showLoader ? "visible" : ""}`}>
          Searching…
        </div>

        {/* RESULTS */}
        <div className={`results-float ${showResults ? "visible" : ""}`}>
          {results.slice(0, MAX_RECOMMENDATIONS).map(g => (
            <div
              key={g.id}
              className="result-row"
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
        <div className="filter-row">
          <div className="filter-inner">
            <span className="filter-label">Genre</span>
            <div className="pill-group">
              {GENRES.map(g => (
                <button
                  key={g}
                  onClick={() => toggle(genres, g, setGenres)}
                  className={`pill ${genres.includes(g) ? "active" : ""}`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* PLATFORM FILTER */}
        <div className="filter-row">
          <div className="filter-inner">
            <span className="filter-label">Platform</span>
            <div className="pill-group">
              {PLATFORMS.map(p => (
                <button
                  key={p}
                  onClick={() =>
                    toggle(platforms, p.toLowerCase(), setPlatforms)
                  }
                  className={`pill ${
                    platforms.includes(p.toLowerCase()) ? "active" : ""
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .gs-root {
          width: 100%;
          padding: 32px 16px 40px;
          color: var(--color-text-primary);
          display: flex;
          justify-content: center;
        }

        .gs-container {
          position: relative;
          width: 100%;
          max-width: 900px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        /* SEARCH INPUT */
        .gs-input {
          width: 100%;
          max-width: 800px;
          padding: var(--space-4) var(--space-2);
          background: transparent;
          border: none;
          border-bottom: 2px solid rgba(148, 163, 184, 0.35);
          color: var(--color-text-primary);
          font-size: var(--text-xl);
          font-weight: var(--weight-medium);
          outline: none;
          text-align: center;
          z-index: 3;
          caret-color: var(--color-accent-primary);
          transition: border-bottom-color var(--transition-slow);
        }

        .gs-input:focus {
          border-bottom-color: var(--color-accent-primary);
        }

        .gs-input::placeholder {
          color: var(--color-text-muted);
          opacity: 0.7;
        }

        /* LOADER */
        .loader-float {
          position: absolute;
          top: 64px;
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
          opacity: 0;
          transform: translateY(-4px);
          transition:
            opacity var(--transition-slow),
            transform var(--transition-slow);
          pointer-events: none;
          z-index: 5;
          font-weight: var(--weight-medium);
        }

        .loader-float.visible {
          opacity: 1;
          transform: translateY(0);
        }

        /* RESULTS – ENTER SLOW, EXIT FAST */
        .results-float {
          position: absolute;
          top: 88px;
          width: 100%;
          max-width: 800px;
          background: var(--color-bg-elevated);
          backdrop-filter: blur(20px);
          border: 1px solid var(--color-border-primary);
          border-radius: var(--radius-2xl);
          box-shadow: var(--shadow-xl);
          padding: var(--space-2);
          opacity: 0;
          transform: translateY(-4px);
          pointer-events: none;
          z-index: 10;
          transition:
            opacity 0.22s ease-out,
            transform 0.22s ease-out;
        }

        .results-float.visible {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
          transition:
            opacity var(--transition-slow),
            transform var(--transition-slow);
        }

        .result-row {
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-lg);
          cursor: pointer;
          transition: all var(--transition-base);
          font-size: var(--text-sm);
          font-weight: var(--weight-medium);
          color: var(--color-text-primary);
          margin-bottom: var(--space-1);
        }

        .result-row:hover {
          background: rgba(96, 165, 250, 0.15);
          transform: translateX(4px);
        }

        .result-row:active {
          transform: translateX(2px);
        }

        /* FILTERS */
        .filter-row {
          margin-top: var(--space-6);
          width: 100%;
          display: flex;
          justify-content: center;
        }

        .filter-inner {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          flex-wrap: wrap;
          justify-content: center;
          max-width: 800px;
        }

        .filter-label {
          font-size: var(--text-xs);
          font-weight: var(--weight-semibold);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-text-tertiary);
          opacity: 0.9;
          min-width: 70px;
        }

        .pill-group {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        .pill {
          padding: var(--space-2) var(--space-4);
          border-radius: var(--radius-full);
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid transparent;
          color: var(--color-text-secondary);
          font-size: var(--text-sm);
          font-weight: var(--weight-medium);
          cursor: pointer;
          outline: none;
          transition: all var(--transition-base);
        }

        .pill:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: var(--color-border-primary);
          transform: translateY(-1px);
        }

        .pill.active {
          background: rgba(96, 165, 250, 0.22);
          border: 2px solid var(--color-accent-primary);
          color: var(--color-text-primary);
          box-shadow: 0 0 12px rgba(96, 165, 250, 0.2);
        }

        .pill:focus-visible {
          outline: 2px solid var(--color-border-focus);
          outline-offset: 2px;
        }

        .pill:active {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
}
