import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import GameSearch from "./components/GameSearch";
import NewReleases from "./components/NewReleases";
import GameSocialRecommended from "./components/GSReccomended";
export default function HomePage() {
  const navigate = useNavigate();
  const carouselRef = useRef(null);
  const rafRef = useRef(null);
  const scrollSpeed = useRef(0);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const TRENDING_LIMIT = 25;
  const GAMES_LIMIT = 10;

  function normalizeList(list) {
    return list.map(g => {
      const mapping = g.mapping ?? null;
      const rawgId =
        mapping?.rawg_id ?? g.id ?? g.steam_id ?? null;

      return {
        id: String(rawgId ?? g.slug ?? g.id),
        rawgId,
        title: g.title || g.name || "Unknown",
        cover: g.background_image,
        players: g.players ?? null
      };
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(
          `${import.meta.env.VITE_API_URL}/api/trending?debug=1&limit=${TRENDING_LIMIT}&gamesLimit=${GAMES_LIMIT}`
        );
        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
        const json = await resp.json();
        if (cancelled) return;

        const list = Array.isArray(json)
          ? json
          : Array.isArray(json.data)
          ? json.data
          : [];

        setItems(normalizeList(list));
      } catch (err) {
        if (!cancelled) setError(err.message || "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleOpenGame = item => {
    const id = item.rawgId ?? item.id;
    if (!id) return;
    navigate(`/game/${id}`);
  };

  /* ───────── SMOOTH EDGE AUTO-SCROLL ───────── */

  const animateScroll = () => {
    if (!carouselRef.current) return;
    carouselRef.current.scrollLeft += scrollSpeed.current;
    rafRef.current = requestAnimationFrame(animateScroll);
  };

  const handleMouseMove = e => {
    const el = carouselRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const edge = 120;

    if (x < edge) {
      scrollSpeed.current = -((edge - x) / edge) * 18;
    } else if (x > rect.width - edge) {
      scrollSpeed.current = ((x - (rect.width - edge)) / edge) * 18;
    } else {
      scrollSpeed.current = 0;
    }

    if (!rafRef.current && scrollSpeed.current !== 0) {
      rafRef.current = requestAnimationFrame(animateScroll);
    }
  };

  const handleMouseLeave = () => {
    scrollSpeed.current = 0;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  return (
    <div className="homepage">
      <header className="hp-header">
        <GameSearch />
      </header>

        <GameSocialRecommended />
        <NewReleases />
      <section className="section">
        <h2 className="section-title"><br></br>Trending</h2>

        {loading && <div className="muted">Loading…</div>}
        {error && <div className="error">{error}</div>}

        <div
          className="carousel"
          ref={carouselRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {items.map(item => (
            <div
              key={item.id}
              className="tile glass"
              onClick={() => handleOpenGame(item)}
            >
              <div className="thumb">
                {item.cover ? (
                  <img src={item.cover} alt={item.title} />
                ) : (
                  <div className="noimg">No image</div>
                )}
              </div>

              <div className="meta">
                <div className="title">{item.title}</div>
                <div className="sub muted">
                  {item.players
                    ? `${item.players} playing`
                    : "Players: N/A"}
                </div>
              </div>
            </div>
          ))}
        </div>

      </section>

      <style jsx>{`
        .homepage {
          padding: 75px;
          padding-top:0px;
          color: #e5e7eb;
          background: transparent;
        }

        .hp-header {
          display: flex;
          justify-content: center;
          margin-bottom: 30px;
        }

        .section {
          margin-bottom: 48px;
        }

        .section-title {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 18px;
        }

        /* ───────── CLEAN CAROUSEL (NO CUTOFF) ───────── */
        .carousel {
          display: flex;
          gap: 18px;
          overflow-x: auto;
          scrollbar-width: none;
          padding-bottom: 4px; /* avoids shadow clipping only */
          will-change: scroll-position;
        }

        .carousel::-webkit-scrollbar {
          display: none;
        }

        .tile {
          min-width: 220px;
          max-width: 220px;
          border-radius: 18px;
          overflow: hidden;
          cursor: pointer;
          flex-shrink: 0;
        }

        .glass {
          background: rgba(15,23,42,0.6);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(148,163,184,0.15);
        }

        .thumb {
          height: 140px;
          background: #020617;
        }

        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .meta {
          padding: 16px;
        }

        .title {
          font-size: 15px;
          font-weight: 600;
        }

        .muted {
          color: #9ca3af;
          font-size: 13px;
        }

        .error {
          color: #f87171;
        }
      `}</style>
    </div>
  );
}
