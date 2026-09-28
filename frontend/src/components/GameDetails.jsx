import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import GameCarousel from "./GameCarousel";
import TrendingSpotlight from "./TrendingSpotlight";
import { relatedGames, relatedKicker } from "./game/related";
import GameHero from "./game/GameHero";
import GameFacts from "./game/GameFacts";
import GameMedia from "./game/GameMedia";
import EvenColumns from "./game/EvenColumns";
import panels from "./game/GamePanels.module.css";
import { useArtTint } from "../hooks/useArtTint";
import { useAutoAdvance } from "../hooks/useAutoAdvance";
import GameNews from "./game/GameNews";
import GameRequirements from "./game/GameRequirements";
import GameDock from "./game/GameDock";
import { hasMultiplayer } from "../shared/reviewTags";
import { API } from "./game/format";
import { Dashes } from "./ScrollPager";
import { useAuth } from "../hooks/useAuth";
import { gameArt } from "../utils/gameArt";
import styles from "./GameDetails.module.css";
import g from "./game/Game.module.css";

/*
 * /game/:id (RAWG id). Four requests, so nothing slow blocks the first paint:
 *   /api/gamepage/:id            everything public (DB + Steam + RAWG), cached
 *   /api/gamepage/:id/community  the dock's chat numbers, friends tied to it
 *   /api/gamepage/:id/me         your playtime + achievement progress (signed in)
 *   /api/gamepage/:id/similar    gamiq "games like this" (polls while pending)
 * Every section hides itself when its data is missing.
 */
// Keyed by id, so moving from one game to another (a DLC, a series entry)
// starts from fresh state instead of resetting each piece by hand.
export default function GameDetails() {
  const { id } = useParams();
  return <GamePage key={id} id={id} />;
}

function GamePage({ id }) {
  const auth = useAuth();
  const { isAuthenticated } = auth;
  // Reviews and chat need an account: the dock only exists once signed in
  // (like the right sidebar).
  const showDock = auth.authChecked && isAuthenticated;

  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [community, setCommunity] = useState(null);
  const [me, setMe] = useState(null);

  const [reviews, setReviews] = useState([]);
  const [heroIndex, setHeroIndex] = useState(0);

  // The dock's unsaved review; null until something is typed or picked, so the
  // composer shows your published review (or a blank form) as it is.
  const [myReview, setMyReview] = useState(null);


  /* public game data */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/gamepage/${id}`)
      .then(async (r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("Couldn't load this game. Try again in a moment.");
        return r.json();
      })
      .then((j) => !cancelled && setGame(j))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));

    // (Opening at the top is handled by Layout, which owns the scroller.)
    return () => { cancelled = true; };
  }, [id]);

  /* your stats */
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    fetch(`${API}/api/gamepage/${id}/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && setMe(j))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id, isAuthenticated]);

  /* GameSocial numbers; refreshed when a review is added or removed */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/gamepage/${id}/community`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && setCommunity(j))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id, isAuthenticated, reviews.length]);

  /* reviews */
  useEffect(() => {
    fetch(`${API}/api/reviews/game/${id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => Array.isArray(j) && setReviews(j));
  }, [id]);

  /* The banner goes through the screenshots like the homepage's Trending
     carousel (hooks/useAutoAdvance.js): every 6s, restarting on any change,
     paused while hovered, keyboard-focused, scrolled away or in a hidden
     tab; ← / → on its dashes, and a swipe on the image. */
  const heroShots = game?.screenshots?.slice(0, 10) ?? [];
  const heroRef = useRef(null);
  const heroCount = heroShots.length;
  const { bind: heroBind, swipe: heroSwipe } = useAutoAdvance({
    rootRef: heroRef,
    index: heroIndex,
    count: heroCount,
    onStep: (d) => setHeroIndex((i) => (i + d + heroCount) % heroCount),
  });

  /* The hero's height: every image is shown whole at the full width, so the
     banner is as tall as the tallest of them at that width (height/width of
     the tallest), fixed for the game, and never changes between slides.
     Shorter images sit centred in it. Measured from the 420px copies (the
     Media strip's thumbnails, so they're usually cached already). Until
     then it assumes 16:9, which nearly every game's screenshots are. */
  const heroSources = heroShots.length
    ? heroShots.map((s) => s.full)
    : [game?.images?.hero || game?.images?.header].filter(Boolean);
  const heroKey = heroSources.join("|");
  const [heroTall, setHeroTall] = useState(null); // max height / width
  useEffect(() => {
    if (!heroKey) return;
    let cancelled = false;
    const measure = (src) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth ? img.naturalHeight / img.naturalWidth : null);
        img.onerror = () => resolve(null);
        img.src = gameArt(src, 420);
      });
    Promise.all(heroKey.split("|").map(measure)).then((ratios) => {
      // + one pixel of the 420px copy: its height is rounded, which could
      // otherwise leave the tallest image a pixel taller than the banner.
      const tallest = Math.max(...ratios.filter(Boolean)) + 1 / 420;
      if (!cancelled && Number.isFinite(tallest)) setHeroTall(tallest);
    });
    return () => { cancelled = true; };
  }, [heroKey]);

  /* Once the page has loaded (and the banner has its final height), glide
     down so the game's name and numbers sit just above the dock: the
     screenshot first, then the rest. Once per game, and not if you've
     already scrolled yourself. */
  const heroBarRef = useRef(null);
  const glidedFor = useRef(null);
  useEffect(() => {
    // Wait for the sign-in check (it decides whether there's a dock to clear).
    if (loading || !game || !auth.authChecked || glidedFor.current === id) return;
    // Wait for the banner's height; if the images can't be measured, go anyway.
    const t = setTimeout(() => {
      const bar = heroBarRef.current;
      let scroller = bar?.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      if (!bar || !scroller || scroller.scrollTop > 10) return;
      glidedFor.current = id;
      const view = scroller.getBoundingClientRect();
      // Where the dock's bar starts (measured, so it's right whatever its
      // size); the screen's bottom when there's no dock.
      const dock = document.querySelector("[data-game-dock-bar]");
      const floor = dock ? Math.min(view.bottom, dock.getBoundingClientRect().top) : view.bottom;
      const r = bar.getBoundingClientRect();
      // The bar's bottom just above the dock, but never its top off-screen.
      const byBottom = r.bottom - (floor - 16);
      const byTop = r.top - view.top - 16;
      const by = Math.min(byBottom, byTop);
      if (by <= 0) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollBy({ top: by, behavior: reduce ? "auto" : "smooth" });
    }, heroTall ? 500 : 1500);
    return () => clearTimeout(t);
  }, [id, loading, game, heroTall, auth.authChecked]);

  // The game's colour, for the title panel and the glass panels below it
  // (--tint on the page; see hooks/useArtTint.js): from the cover art (the
  // homepage's image), else the first screenshots that can be read.
  const tint = useArtTint([
    game?.images?.hero,
    ...(game?.screenshots ?? []).slice(0, 3).map((s) => s.full),
    game?.images?.header,
  ]);

  if (loading) return <div className={styles.section}>Loading…</div>;
  if (error) return <div className={styles.section}>{error}</div>;
  if (!game) return <div className={styles.section}>Game not found</div>;

  // The next slide, fetched ahead so switching doesn't flash the bare page.
  const nextShot = heroShots.length > 1 ? heroShots[(heroIndex + 1) % heroShots.length]?.full : null;
  // A 1920px copy, not the 2560px original (see utils/gameArt.js).
  const heroSrc = gameArt(heroShots[heroIndex]?.full || heroSources[0], 1920);
  const description = game.description || game.shortDescription || "";
  const related = relatedGames(game);

  return (
    <div className={styles.container} // --game-dock-h is set by GameDock to its measured height.
      style={{
        paddingBottom: showDock ? "calc(var(--game-dock-h, 240px) + 40px)" : 40,
        ...(tint ? { "--tint": tint } : {}),
      }}>
      <div ref={heroRef} className={styles.hero} style={{ aspectRatio: `1 / ${heroTall ?? 9 / 16}` }} {...heroBind} {...heroSwipe}>
        {heroSrc && <img className={styles.heroImg} src={heroSrc} alt="" />}
        {nextShot && <link rel="preload" as="image" href={gameArt(nextShot, 1920)} />}
      </div>

      {/* The game's info, in a full-width band under the screenshot; the
          screenshot pager sits at its top, just below the image. */}
      <section ref={heroBarRef} className={g.heroBar}>
        {heroShots.length > 1 && (
          <div {...heroBind}>
            <Dashes
              count={heroShots.length}
              active={heroIndex}
              onSelect={setHeroIndex}
              label={(i) => `Screenshot ${i + 1}`}
              className={styles.heroDashes}
            />
          </div>
        )}
        <GameHero game={game} me={me} />
      </section>

      {/* About + media, with the facts sidebar: one section as tall as the
          shorter side, the taller side scrolling inside it */}
      <section className={g.section}>
        <EvenColumns
          left={
            <div className={panels.stack}>
              {description && (
                <section className={panels.panel}>
                  <h2 className={panels.title}>About</h2>
                  <div
                    className={panels.desc}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(description) }}
                  />
                </section>
              )}

              <GameMedia
                trailers={game.trailers}
                screenshots={game.screenshots}
                steamUrl={game.links?.steam}
                name={game.name}
              />
            </div>
          }
          right={<GameFacts game={game} />}
        />
      </section>

      {/* The base game, DLC and editions and the series, merged into one
          spotlight like the homepage's Trending (one game at a time, so a
          single DLC fills the width too); then games like this one, a card
          row like the homepage's GameSocial Picks. */}
      <section className={g.rows}>
        {related.length > 0 && (
          <TrendingSpotlight
            games={related}
            title="Related games"
            label={`Games related to ${game.name}`}
            kicker={relatedKicker}
            labelHeading
            tintedJoyCons
          />
        )}
        <GameCarousel
          url={`${API}/api/gamepage/${id}/similar`}
          title="Games like this"
          pollPendingMs={5000}
        />
      </section>

      {game.news && (
        <Section><GameNews key={id} news={game.news} gameId={id} /></Section>
      )}

      {game.requirements && (
        <Section><GameRequirements requirements={game.requirements} legalNotice={game.legalNotice} /></Section>
      )}

      {/* Reviews and the chat room live in the fixed bottom dock. Fixed on
          screen, so rendered at the top of the page (a portal), not inside
          the page's scrolling container: Chrome leaves stale, doubled copies
          of the scrolled content around fixed layers nested in a scroller
          (the "ghosted text" bug). */}
      {showDock && createPortal(<GameDock
        gameId={id}
        gameName={game.name}
        auth={auth}
        reviews={reviews}
        setReviews={setReviews}
        myReview={myReview}
        setMyReview={setMyReview}
        community={community}
        // Which review tags to offer: generic + this game's genre packs.
        tagContext={{
          genres: game.genres,
          multiplayer: hasMultiplayer({ genres: game.genres, categories: game.categories, tags: game.tags }),
        }}
      />, document.body)}
    </div>
  );
}

function Section({ children }) {
  return <section className={g.section}>{children}</section>;
}
