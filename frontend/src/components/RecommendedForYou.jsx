import { useCallback, useState } from "react";
import GameCarousel from "./GameCarousel";
import { useAuth } from "../hooks/useAuth";
import styles from "./RecommendedForYou.module.css";

const API_URL = import.meta.env.VITE_API_URL;

/**
 * "Because you play …": games gamiq picks from the three titles you've put
 * the most hours into on Steam.
 *
 * gamiq takes tens of seconds when nothing is cached, so the endpoint
 * answers "pending" and starts the work in the background; the row polls
 * and fills itself in when the answer lands. It renders nothing at all
 * while there's nothing to show: signed out, no Steam account linked, or no
 * recommendations yet.
 */
export default function RecommendedForYou() {
  const { isAuthenticated, authChecked } = useAuth();
  const [seeds, setSeeds] = useState([]);
  const [status, setStatus] = useState(null);

  const onData = useCallback((json) => {
    setSeeds(json?.seeds ?? []);
    setStatus(json?.status ?? null);
  }, []);

  if (!authChecked || !isAuthenticated) return null;
  // No Steam library to work from, or the recommender is down.
  if (status === "unavailable") return null;

  const names = seeds.map((s) => s.name).filter(Boolean).slice(0, 2);
  const title = names.length ? `Because you play ${names.join(" and ")}` : "Recommended for you";

  return (
    <>
      {/* While the recommender is working (it takes a while on a first run)
          the row says so, rather than silently not existing. */}
      {status === "pending" && (
        <section className={styles.pending}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.note}>
            Finding games you'll like<span className={styles.dots} aria-hidden="true" />
          </p>
        </section>
      )}

      <GameCarousel
        url={`${API_URL}/api/recommended`}
        title={title}
        withCredentials
        pollPendingMs={5000}
        onData={onData}
      />
    </>
  );
}
