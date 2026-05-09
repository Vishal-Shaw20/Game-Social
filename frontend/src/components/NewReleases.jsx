import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const GAMES_LIMIT = 10;
const HERO_HEIGHT = 220;

function normalizeList(list) {
  return list.map(g => {
    const cover = g.cover_image || g.background_image || g.image || "";
    const rawgId = g.id ?? null;
    const title = g.title || g.name || "Unknown";

    return {
      id: String(rawgId ?? g.slug ?? g.id),
      rawgId,
      title,
      cover,
      released: g.released || null
    };
  });
}

export default function NewReleases() {
  const navigate = useNavigate();

  const carouselRef = useRef(null);
  const rafRef = useRef(null);
  const scrollSpeed = useRef(0);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/new-releases?limit=${GAMES_LIMIT}`);
        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
        const json = await resp.json();
        if (cancelled) return;
        setItems(normalizeList(Array.isArray(json) ? json : json.data || []));
      } catch (e) {
        if (!cancelled) setError(e.message);
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

  const openGame = item => {
    const id = item.rawgId ?? item.id;
    if (id) navigate(`/game/${id}`);
  };

  /* ───────── AUTO SCROLL (SAME AS TRENDING) ───────── */

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

  const hero = items[0];
  const rest = items.slice(1);

  return (
    <section className="nr-page">
      {loading && <div className="muted">Loading…</div>}
      {error && <div className="error">{error}</div>}

      {/* ───────── HERO ───────── */}
      {hero && (
        <section className="hero-wrap">
          <div
            className="hero"
            onClick={() => openGame(hero)}
            role="button"
            tabIndex={0}
          >
            <img src={hero.cover} alt={hero.title} className="hero-bg" />
            <div className="hero-overlay" />

            <div className="hero-content">
              <span className="badge">New</span>
              <div className="hero-title">{hero.title}</div>
              <div className="hero-sub muted">
                {hero.released
                  ? `Released ${hero.released}`
                  : "Release date N/A"}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ───────── CAROUSEL ───────── */}
      {rest.length > 0 && (
        <section className="nr-section">
          <h2 className="nr-title">New Releases</h2>

          <div
            className="carousel"
            ref={carouselRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {rest.map(item => (
              <div
                key={item.id}
                className="tile glass"
                onClick={() => openGame(item)}
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
                  {/* <div className="sub muted">
                    {item.released
                      ? `Released ${item.released}`
                      : "Release date N/A"}
                  </div> */}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <style jsx>{`
        .nr-page {
          width: 100%;
        }

        /* ───────── HERO ───────── */
        .hero-wrap {
          padding-bottom: 28px;
        }

        .hero {
          height: ${HERO_HEIGHT}px;
          border-radius: 18px;
          overflow: hidden;
          position: relative;
          cursor: pointer;
          background: #020617;
          box-shadow:
            0 12px 28px rgba(0,0,0,0.4),
            inset 0 0 0 1px rgba(148,163,184,0.12);
        }

        .hero-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;

  image-rendering: auto;
  backface-visibility: hidden;
  transform: translateZ(0);
}


        .hero-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            90deg,
            rgba(2,6,23,0.85),
            rgba(2,6,23,0.35) 60%,
            rgba(2,6,23,0.1)
          );
        }

        .hero-content {
          position: absolute;
          left: 24px;
          top: 50%;
          transform: translateY(-50%);
          max-width: 60%;
        }

        .badge {
          font-size: 11px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(148,163,184,0.18);
          backdrop-filter: blur(6px);
          margin-bottom: 10px;
          display: inline-block;
        }

        .hero-title {
          font-size: 22px;
          font-weight: 700;
          margin-bottom: 6px;
        }

        .hero-sub {
          font-size: 13px;
        }

        /* ───────── CAROUSEL ───────── */
        .nr-section {
          margin-top: 36px;
        }

        .nr-title {
          font-size: 20px;
          margin-bottom: 18px;
        }

        .carousel {
          display: flex;
          gap: 18px;
          overflow-x: auto;
          scrollbar-width: none;
          padding-bottom: 4px;
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

        .sub {
          font-size: 13px;
        }

        .muted {
          color: #9ca3af;
        }

        .error {
          color: #f87171;
        }

        .noimg {
          height: 100%;
          display: grid;
          place-items: center;
          opacity: 0.5;
        }
      `}</style>
    </section>
  );
}
