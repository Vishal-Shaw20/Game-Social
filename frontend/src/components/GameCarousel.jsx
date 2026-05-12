import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeGames } from "../utils/normalizeGames";
import { useCarouselScroll } from "../hooks/useCarouselScroll";
import styles from "./GameCarousel.module.css";

export default function GameCarousel({
  url,
  title,
  badgeText = null,
  showHero = false,
  renderSubtitle = null,
  limit = 10,
}) {
  const navigate = useNavigate();
  const { carouselRef, handleMouseMove, handleMouseLeave } = useCarouselScroll();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`${url}?limit=${limit}`);
        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
        const json = await resp.json();
        if (cancelled) return;
        setItems(normalizeGames(Array.isArray(json) ? json : json.data || []));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [url, limit]);

  const openGame = (item) => {
    const id = item.rawgId ?? item.id;
    if (id) navigate(`/game/${id}`);
  };

  const hero = showHero ? items[0] : null;
  const rest = showHero ? items.slice(1) : items;

  return (
    <section className={styles.section}>
      {loading && <div className={styles.muted}>Loading…</div>}
      {error && <div className={styles.error}>{error}</div>}

      {hero && (
        <div className={styles.heroWrap}>
          <div
            className={styles.hero}
            onClick={() => openGame(hero)}
            role="button"
            tabIndex={0}
          >
            <img src={hero.cover} alt={hero.title} className={styles.heroBg} />
            <div className={styles.heroOverlay} />
            <div className={styles.heroContent}>
              {badgeText && <span className={styles.badge}>{badgeText}</span>}
              <div className={styles.heroTitle}>{hero.title}</div>
              {renderSubtitle && (
                <div className={`${styles.heroSub} ${styles.muted}`}>
                  {renderSubtitle(hero)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          <div
            className={styles.carousel}
            ref={carouselRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {rest.map((item) => (
              <div
                key={item.id}
                className={styles.tile}
                onClick={() => openGame(item)}
              >
                <div className={styles.thumb}>
                  {item.cover ? (
                    <img src={item.cover} alt={item.title} />
                  ) : (
                    <div className={styles.noimg}>No image</div>
                  )}
                </div>
                <div className={styles.meta}>
                  <div className={styles.title}>{item.title}</div>
                  {renderSubtitle && (
                    <div className={`${styles.sub} ${styles.muted}`}>
                      {renderSubtitle(item)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
