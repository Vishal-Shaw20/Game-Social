import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DOMPurify from "dompurify";
import GameChat from "../components/GameChat";
import GameReviews from "../components/GameReviews";
import styles from "./GameDetails.module.css";

export default function GameDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [game, setGame] = useState(null);
  const [owned, setOwned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [reviews, setReviews] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);

  const [myReview, setMyReview] = useState({
    verdict: null,
    title: "",
    body: "",
    pros: [],
    cons: [],
    completed: false
  });

  const heroIntervalRef = useRef(null);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/auth/user`, {
      credentials: "include"
    })
      .then(r => (r.ok ? r.json() : null))
      .then(me => me?._id && setCurrentUserId(String(me._id)));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const r = await fetch(
          `${import.meta.env.VITE_API_URL}/api/gameLookup/${id}`
        );
        let j = null;
        if (r.ok) {
          j = await r.json();
          const steam = j.steam;
          if (steam) {
            if (!cancelled) {
              setGame({
                name: steam.name || "Unknown Game",
                description:
                  steam.detailed_description ||
                  steam.short_description ||
                  "",
                heroImage: steam.header_image || "",
                release: steam.release_date?.date || null,
                metacritic: steam.metacritic || null,
                price: steam.price_overview || null,
                genres: (steam.genres || []).map(g => g.description),
                categories: (steam.categories || []).map(c => c.description),
                screenshots: steam.screenshots || []
              });
            }
          } else {
            // Fallback to RAWG when Steam data unavailable
            const r2 = await fetch(
              `${import.meta.env.VITE_API_URL}/api/rawg/game/${id}`
            );
            const rawg = await r2.json().catch(() => null);
            if (r2.ok && rawg && !cancelled) {
              setGame({
                name: rawg.name || "Unknown Game",
                description: rawg.description || rawg.description_raw || "",
                heroImage: rawg.background_image || "",
                release: rawg.released || null,
                metacritic: rawg.metacritic ? { score: rawg.metacritic } : null,
                price: null,
                genres: (rawg.genres || []).map(g => g.name),
                categories: (rawg.tags || []).map(t => t.name),
                screenshots: (rawg.short_screenshots || []).map(s => ({ path_full: s.image }))
              });
            } else {
              if (!cancelled) setError("Steam data unavailable");
            }
          }
        } else {
          // Fallback to RAWG when Steam lookup fails
          const r2 = await fetch(
            `${import.meta.env.VITE_API_URL}/api/rawg/game/${id}`
          );
          const rawg = await r2.json().catch(() => null);
          if (r2.ok && rawg && !cancelled) {
            setGame({
              name: rawg.name || "Unknown Game",
              description: rawg.description || rawg.description_raw || "",
              heroImage: rawg.background_image || "",
              release: rawg.released || null,
              metacritic: rawg.metacritic ? { score: rawg.metacritic } : null,
              price: null,
              genres: (rawg.genres || []).map(g => g.name),
              categories: (rawg.tags || []).map(t => t.name),
              screenshots: (rawg.short_screenshots || []).map(s => ({ path_full: s.image }))
            });
          } else {
            if (!cancelled) setError("Failed to load game");
          }
        }

        const owns = await fetch(
          `${import.meta.env.VITE_API_URL}/api/me/owns/${id}`,
          { credentials: "include" }
        );
        const ownsJson = owns.ok ? await owns.json() : {};
        if (!cancelled) setOwned(Boolean(ownsJson.owned));
      } catch (e) {
        if (!cancelled) setError(e.message || "Something went wrong");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => (cancelled = true);
  }, [id]);

  const heroScreenshots = game?.screenshots?.slice(0, 10) || [];

  useEffect(() => {
    if (!heroScreenshots.length) {
      setHeroIndex(0);
      return;
    }

    heroIntervalRef.current = setInterval(() => {
      setHeroIndex(i => (i + 1) % heroScreenshots.length);
    }, 5000);

    return () => {
      if (heroIntervalRef.current) clearInterval(heroIntervalRef.current);
    };
  }, [heroScreenshots.length]);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/api/reviews/game/${id}`, {
      credentials: "include"
    })
      .then(r => (r.ok ? r.json() : []))
      .then(j => Array.isArray(j) && setReviews(j));
  }, [id]);

  if (loading) return <div className={styles.section}>Loading…</div>;
  if (error) return <div className={styles.section}>{error}</div>;
  if (!game) return <div className={styles.section}>Game not found</div>;

  const heroBg =
    heroScreenshots.length > 0
      ? heroScreenshots[heroIndex]?.path_full || game.heroImage
      : game.heroImage;

  const shouldTruncate = game.description.length > 600;

  return (
    <div className={styles.container}>
      <button className={styles.backButton} onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className={styles.hero} style={{ backgroundImage: `url(${heroBg})` }}>
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <h1>{game.name}</h1>
          <div className={styles.heroMeta}>
            {game.release && <span>{game.release}</span>}
            {game.metacritic && (
              <span>
                Metacritic <strong>{game.metacritic.score}</strong>
              </span>
            )}
            {game.price && (
              <span>
                {game.price.final_formatted}
              </span>
            )}
          </div>
          <div className={styles.tags}>
            {game.genres.map(g => (
              <span key={g}>{g}</span>
            ))}
            {game.categories.map(c => (
              <span key={c} className={styles.soft}>
                {c}
              </span>
            ))}
          </div>
        </div>

        {heroScreenshots.length > 1 && (
          <div className={styles.heroDashes}>
            {heroScreenshots.map((_, i) => (
              <button
                key={i}
                className={`${styles.dash} ${i === heroIndex ? styles.dashActive : ""}`}
                onClick={() => setHeroIndex(i)}
              />
            ))}
          </div>
        )}
      </div>

      <section className={styles.section}>
        <div className={styles.descWrap}>
          <div
            className={`${styles.desc} ${
              showFullDesc || !shouldTruncate ? styles.descOpen : ""
            }`}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(game.description) }}
          />

          {!showFullDesc && shouldTruncate && (
            <div className={styles.descVignette} />
          )}
        </div>

        {shouldTruncate && (
          <button
            className={styles.toggle}
            onClick={() => setShowFullDesc(v => !v)}
          >
            {showFullDesc ? "Less" : "More"}
          </button>
        )}
      </section>

      <section className={styles.section}>
        <GameReviews
          gameId={id}
          reviews={reviews}
          setReviews={setReviews}
          owned={owned}
          setOwned={setOwned}
          myReview={myReview}
          setMyReview={setMyReview}
          currentUserId={currentUserId}
        />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionInner}>
          <GameChat gameId={id} />
        </div>
      </section>
    </div>
  );
}
