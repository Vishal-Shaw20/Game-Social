import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./Library.module.css";

export default function Library() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/api/me/library`, { credentials: "include" })
      .then(res => res.json())
      .then(json => {
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load library");
        setLoading(false);
      });
  }, []);

  if (loading) return <div className={styles.libraryState}>Loading your library…</div>;
  if (error) return <div className={`${styles.libraryState} ${styles.libraryStateError}`}>{error}</div>;

  if (!data?.linked) {
    return (
      <div className={styles.libraryState}>
        <h2>No Steam Library</h2>
        <p>Link your Steam account to see your games here.</p>
      </div>
    );
  }

  return (
    <div className={styles.library}>
      <div className={styles.libraryHeader}>
        <h2>My Library</h2>
        <span>
          {data.gameCount} games • Last synced{" "}
          {new Date(data.lastSyncedAt).toLocaleString()}
        </span>
      </div>

      <div className={styles.libraryGrid}>
        {data.games.map(({ steam, rawg }) => {
          const rawgId = rawg?.id;
          const clickable = Boolean(rawgId);

          return (
            <div
              key={steam.appid}
              className={`${styles.gameCard} ${clickable ? styles.clickable : styles.disabled}`}
              onClick={() => rawgId && navigate(`/game/${rawgId}`)}
            >
              <img
  src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${steam.appid}/header.jpg`}
  alt={steam.name}
  loading="lazy"
/>


              <div className={styles.gameName}>{steam.name}</div>

              <div className={styles.gameTime}>
                {(steam.playtimeForever / 60).toFixed(1)} hrs played
              </div>

              {!rawgId && (
                <div className={styles.rawgMissing}>No RAWG data</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
