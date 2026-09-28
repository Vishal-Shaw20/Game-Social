import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { normalizeGames } from "../utils/normalizeGames";
import { gameArt } from "../utils/gameArt";
import { scoreColor } from "../utils/scoreColor";
import PlatformIcon from "./PlatformIcon";
import ScrollRail from "./game/ScrollRail";
import rail from "./game/ScrollRail.module.css";
import styles from "./TrendingSpotlight.module.css";

const API_URL = import.meta.env.VITE_API_URL;

/* How many of the trending list to cycle through. One slide at a time, so
   the full 25 used by the old row is a lot of clicking. */
const COUNT = 10;

/* Deliberately NOT the hero's 1280. These images load without CORS (they
   are only displayed, never read), and RAWG only sends CORS headers when
   asked, so a plain copy cached at the hero's URL would get the hero's WebGL
   textures refused. A width nothing else requests (the hero uses 1280, cards
   640) keeps the two apart; it must also be one RAWG's resizer accepts (see
   utils/gameArt.js). */
const ART_WIDTH = 1920;

const SWIPE_PX = 50;

/* Auto-advance interval. Any change of slide, manual or automatic, restarts
   the count, as does resuming after a pause. */
const ADVANCE_MS = 6000;

// Users who ask for reduced motion don't get an auto-rotating carousel.
const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function preload(url) {
  if (!url) return;
  const img = new Image();
  img.src = url;
}

/* The homepage's corner label: the game's trending rank. */
const trendingKicker = (game) => ({ tag: `#${game.rank}`, text: "Trending on Steam" });

/**
 * Trending as a one-game-at-a-time spotlight: large art on the left, a
 * condensed version of the game page on the right. Data comes entirely from
 * /api/trending (already enriched server-side), so moving between slides
 * costs no requests beyond the images.
 *
 * Also the game page's related games: pass `games` (normalized, each with
 * the fields the slide shows) and nothing is fetched; `title`, `label` (for
 * screen readers) and `kicker(game, index, total)` -> { tag, text } set the
 * heading and each slide's corner label; `labelHeading` shows the heading
 * as a panel label (uppercase, a glowing edge, a count) like the game
 * page's panels, instead of the homepage's plain section title.
 */
export default function TrendingSpotlight({
  games = null,
  title = "Trending",
  label = "Trending games",
  kicker = trendingKicker,
  labelHeading = false,
  // Joy-Cons with a glowing edge in the game's colour (--tint), for the
  // game page.
  tintedJoyCons = false,
} = {}) {
  const navigate = useNavigate();
  const [fetched, setFetched] = useState([]);
  const slides = games ?? fetched;
  const given = Boolean(games);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const pointerStart = useRef(null);
  const sectionRef = useRef(null);

  // Auto-advance pauses while the user is engaged with it (hovering or
  // keyboard focus inside), while it's scrolled out of view, and while the
  // tab is hidden, so it never moves on under someone reading it.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(true);
  const [tabHidden, setTabHidden] = useState(
    typeof document !== "undefined" && document.hidden
  );
  const paused = hovered || focused || !inView || tabHidden;

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (given) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/trending?limit=${COUNT}`);
        if (!res.ok) return;
        const raw = await res.json();
        const games = normalizeGames(Array.isArray(raw) ? raw : []);

        // Keep each game's true trending position before filtering, so the
        // rank shown stays honest. Games with no RAWG match are skipped: they
        // have no art and no game page to open.
        const withRank = games
          .map((game, i) => ({ ...game, rank: i + 1 }))
          .filter((game) => game.rawgId && game.cover);

        if (!cancelled) setFetched(withRank);
      } catch (e) {
        console.error("trending load failed", e);
      }
    })();

    return () => { cancelled = true; };
  }, [given]);

  const go = useCallback((delta) => {
    setDirection(delta);
    setIndex((i) => (i + delta + slides.length) % slides.length);
  }, [slides.length]);

  const jump = useCallback((to) => {
    setDirection(to > index ? 1 : -1);
    setIndex(to);
  }, [index]);

  useEffect(() => {
    if (slides.length < 2 || paused || reducedMotion()) return;
    const id = setTimeout(() => go(1), ADVANCE_MS);
    return () => clearTimeout(id);
  }, [index, paused, slides.length, go]);

  // Warm the neighbours so an arrow press never shows a blank panel.
  useEffect(() => {
    if (slides.length < 2) return;
    const next = slides[(index + 1) % slides.length];
    const prev = slides[(index - 1 + slides.length) % slides.length];
    preload(gameArt(next.cover, ART_WIDTH));
    preload(gameArt(prev.cover, ART_WIDTH));
  }, [index, slides]);

  function onKeyDown(e) {
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse") return;
    pointerStart.current = e.clientX;
  }

  function onPointerUp(e) {
    if (pointerStart.current == null) return;
    const dx = e.clientX - pointerStart.current;
    pointerStart.current = null;
    if (Math.abs(dx) > SWIPE_PX) go(dx < 0 ? 1 : -1);
  }

  const game = slides[index] ?? slides[0];

  return (
    <section
      ref={sectionRef}
      className={styles.section}
      aria-roledescription="carousel"
      aria-label={label}
      onKeyDown={onKeyDown}
      // Keyboard focus only: a mouse click on a Joy-Con also leaves focus
      // on it, which would otherwise pause the carousel indefinitely after
      // the pointer has left.
      onFocus={(e) => setFocused(e.target.matches(":focus-visible"))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      {labelHeading ? (
        <h2 className={styles.sectionLabel}>
          {title}
          {slides.length > 0 && <span className={styles.sectionCount}>{slides.length}</span>}
        </h2>
      ) : (
        <h2 className={styles.sectionTitle}>{title}</h2>
      )}

      <div
        className={`${styles.stage} ${tintedJoyCons ? styles.stageTinted : ""}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {game ? (
          <>
            {/* Full-height side controls styled after Switch Joy-Cons: the
                whole strip is the hit area, the "stick" carries the same
                arrow glyph as the notification tab. */}
            <button
              type="button"
              className={`${styles.joy} ${styles.joyPrev}`}
              onClick={() => go(-1)}
              aria-label="Previous game"
            >
              <span className={styles.stick} aria-hidden="true">←</span>
            </button>

            <Slide
              key={game.rawgId}
              game={game}
              position={index + 1}
              total={slides.length}
              kicker={kicker(game, index, slides.length)}
              direction={direction}
              // Announcing every automatic change would be noise; only
              // announce while it's paused, i.e. the user is driving.
              live={paused}
              onOpen={() => navigate(`/game/${game.rawgId}`)}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
            />

            <button
              type="button"
              className={`${styles.joy} ${styles.joyNext}`}
              onClick={() => go(1)}
              aria-label="Next game"
            >
              <span className={styles.stick} aria-hidden="true">→</span>
            </button>
          </>
        ) : (
          <div className={`${styles.panel} ${styles.skeleton}`} aria-hidden="true" />
        )}

        {/* Inside the stage grid so it sits in the panel's column: exactly the
            panel's width, between the Joy-Cons. */}
        {slides.length > 1 && (
          <div className={styles.pager}>
            {slides.map((s, i) => (
              <button
                key={s.rawgId}
                type="button"
                className={`${styles.dash} ${i === index ? styles.dashActive : ""}`}
                onClick={() => jump(i)}
                aria-label={`Show ${s.title}`}
                aria-current={i === index ? "true" : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Slide({ game, position, total, kicker, direction, live, onOpen, onPointerDown, onPointerUp }) {
  const {
    title, cover, year, developer, genres, platforms,
    metacritic, rating, summary, players, steamPositive, steamNegative,
  } = game;
  // The title and description scroll with the game page's scrollbar
  // (ScrollRail), shown while hovered or focused.
  const titleRef = useRef(null);
  const summaryRef = useRef(null);

  const art = gameArt(cover, ART_WIDTH);

  const score = metacritic ?? (rating ? Math.round(rating * 20) : null);
  const scoreLabel = metacritic ? "Metacritic" : "User score";

  const reviewTotal = (steamPositive ?? 0) + (steamNegative ?? 0);
  const steamPct = reviewTotal > 0 ? Math.round((steamPositive / reviewTotal) * 100) : null;

  return (
    <div
      className={styles.panel}
      style={{ "--dir": direction }}
      role="group"
      aria-roledescription="slide"
      aria-label={`${position} of ${total}: ${title}`}
      aria-live={live ? "polite" : "off"}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <img
        className={styles.ambient}
        src={art}
        alt=""
        draggable="false"
        aria-hidden="true"
      />

      <button type="button" className={styles.art} onClick={onOpen} tabIndex={-1} aria-hidden="true">
        <img src={art} alt="" draggable="false" />
      </button>

      <div className={styles.details}>
        <div className={styles.kicker}>
          <span className={styles.rank}>{kicker.tag}</span>
          <span>{kicker.text}</span>
        </div>

        <div className={styles.scrollBox}>
          <h3 ref={titleRef} className={`${styles.title} ${rail.scroller}`} tabIndex={0} title={title}>{title}</h3>
          <ScrollRail targetRef={titleRef} className={styles.boxRail} />
        </div>

        {(developer || year) && (
          <div className={styles.byline}>
            {[developer, year].filter(Boolean).join(" · ")}
          </div>
        )}

        <dl className={styles.stats}>
          {score != null && (
            <div className={styles.stat}>
              <dt>{scoreLabel}</dt>
              <dd style={{ color: scoreColor(score) }}>
                {score}<span className={styles.unit}>%</span>
              </dd>
            </div>
          )}
          {steamPct != null && (
            <div className={styles.stat}>
              <dt>Steam reviews · {compact.format(reviewTotal)}</dt>
              <dd style={{ color: scoreColor(steamPct) }}>
                {steamPct}<span className={styles.unit}>%</span>
              </dd>
            </div>
          )}
          {players != null && (
            <div className={styles.stat}>
              {/* SteamSpy's ccu is the peak concurrent player count for the
                  previous day, not a live figure — label it as such. */}
              <dt>Peak players · 24h</dt>
              <dd>{compact.format(players)}</dd>
            </div>
          )}
        </dl>

        {summary && (
          <div className={`${styles.scrollBox} ${styles.summaryBox}`}>
            <p ref={summaryRef} className={`${styles.summary} ${rail.scroller}`} tabIndex={0}>{summary}</p>
            <ScrollRail targetRef={summaryRef} className={styles.boxRail} />
          </div>
        )}

        <div className={styles.footer}>
          <div className={styles.tags}>
            {genres.map((g) => (
              <span key={g} className={styles.tag}>{g}</span>
            ))}
            {platforms.length > 0 && (
              <ul
                className={styles.platforms}
                aria-label={`Available on ${platforms.map((p) => p.label).join(", ")}`}
              >
                {platforms.map((p) => (
                  <li key={p.key} title={p.label}>
                    <PlatformIcon platform={p.key} size={16} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button type="button" className={styles.cta} onClick={onOpen}>
            View game
            <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

