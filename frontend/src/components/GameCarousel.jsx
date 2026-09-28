import { useEffect, useRef, useState } from "react";
import { normalizeGames } from "../utils/normalizeGames";
import { gameArt } from "../utils/gameArt";
import { useCarouselScroll } from "../hooks/useCarouselScroll";
import GameCard from "./GameCard";
import { useQuickLook } from "./quicklook/quickLookContext";
import styles from "./GameCarousel.module.css";

export default function GameCarousel({
  url,
  // A list the page already has (a game's DLC, its series): shown as is,
  // nothing is fetched.
  games = null,
  title,
  badgeText = null,
  showHero = false,
  renderSubtitle = null,
  renderDateTag = null,
  limit = 10,
  // An endpoint that answers { status: "pending" } while it prepares the
  // list (see /api/recommended) is re-checked this often, up to
  // pendingTimeoutMs. 0 disables it.
  pollPendingMs = 0,
  pendingTimeoutMs = 120000,
  // Called with each response, so a parent can title the row from it.
  onData = null,
  withCredentials = false,
  // The left edge under the sidebar: "blur" (a progressive backdrop blur)
  // or "fade" (a mask; cheaper, for pages that stack many rows).
  edge = "blur",
}) {
  const quickLook = useQuickLook();
  const { carouselRef, handleMouseMove, handleMouseLeave } = useCarouselScroll();

  const [items, setItems] = useState([]);
  // Held in a ref so a new callback each render doesn't restart the fetch.
  const onDataRef = useRef(onData);
  useEffect(() => { onDataRef.current = onData; }, [onData]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (games) return;
    let cancelled = false;
    let timer = null;
    const startedAt = Date.now();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`${url}?limit=${limit}`, {
          credentials: withCredentials ? "include" : "same-origin"
        });
        if (!resp.ok && resp.status !== 202) throw new Error(`Fetch failed: ${resp.status}`);
        const json = await resp.json();
        if (cancelled) return;

        onDataRef.current?.(json);

        const list = Array.isArray(json) ? json : json.data ?? json.games ?? [];
        setItems(normalizeGames(list));

        // Still being prepared: check back until it's ready or we give up.
        if (pollPendingMs && json.status === "pending") {
          if (Date.now() - startedAt < pendingTimeoutMs) {
            timer = setTimeout(load, pollPendingMs);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [games, url, limit, pollPendingMs, pendingTimeoutMs, withCredentials]);

  // A quick look, stepping through this row's games.
  const openGame = (item) => quickLook(item, { list: shown });

  const shown = games ? normalizeGames(games) : items;
  const hero = showHero ? shown[0] : null;
  const rest = showHero ? shown.slice(1) : shown;

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
            <img src={gameArt(hero.cover, 1920)} alt={hero.title} className={styles.heroBg} />
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
          <div className={styles.rowWrap}>
            <div
              className={`${styles.carousel} ${edge === "fade" ? styles.carouselFade : ""}`}
              ref={carouselRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {rest.map((item) => (
                <GameCard
                  key={item.id}
                  game={item}
                  subtitle={renderSubtitle ? renderSubtitle(item) : null}
                  dateTag={renderDateTag ? renderDateTag(item) : null}
                  onOpen={() => openGame(item)}
                />
              ))}
            </div>

            {/* Progressive blur under the left sidebar only. Four stacked
                layers of increasing radius: a single layer can only fade its
                own opacity, which blends a full-strength blur with the sharp
                image underneath and reads as ghosting, not as a ramp. */}
            {edge === "blur" && (
              <div className={styles.edge} aria-hidden="true">
                <span className={styles.blur1} />
                <span className={styles.blur2} />
                <span className={styles.blur3} />
                <span className={styles.blur4} />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
