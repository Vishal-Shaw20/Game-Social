import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

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

  if (loading) return <div className="library-state">Loading your library…</div>;
  if (error) return <div className="library-state error">{error}</div>;

  if (!data?.linked) {
    return (
      <div className="library-state">
        <h2>No Steam Library</h2>
        <p>Link your Steam account to see your games here.</p>
      </div>
    );
  }

  return (
    <div className="library">
      <div className="library-header">
        <h2>My Library</h2>
        <span>
          {data.gameCount} games • Last synced{" "}
          {new Date(data.lastSyncedAt).toLocaleString()}
        </span>
      </div>

      <div className="library-grid">
        {data.games.map(({ steam, rawg }) => {
          const rawgId = rawg?.id;
          const clickable = Boolean(rawgId);

          return (
            <div
              key={steam.appid}
              className={`game-card ${clickable ? "clickable" : "disabled"}`}
              onClick={() => rawgId && navigate(`/game/${rawgId}`)}
            >
              <img
  src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${steam.appid}/header.jpg`}
  alt={steam.name}
  loading="lazy"
/>


              <div className="game-name">{steam.name}</div>

              <div className="game-time">
                {(steam.playtimeForever / 60).toFixed(1)} hrs played
              </div>

              {!rawgId && (
                <div className="rawg-missing">No RAWG data</div>
              )}
            </div>
          );
        })}
      </div>

<style jsx>{`
  :root {
    --glass-bg: rgba(255,255,255,0.04);
    --glass-bg-strong: rgba(255,255,255,0.08);
    --glass-border: rgba(255,255,255,0.12);
    --glass-hover: rgba(255,255,255,0.12);
    --blur: blur(14px);
  }

  /* ================= PAGE ================= */

  .library {
    padding: 48px 64px;
    color: #e6edf3;
  }

  /* ================= HEADER ================= */

  .library-header {
    margin-bottom: 32px;
  }

  .library-header h2 {
    margin: 0 0 6px;
    font-size: 26px;
    font-weight: 700;
  }

  .library-header span {
    font-size: 13px;
    opacity: 0.65;
  }

  /* ================= GRID ================= */

  .library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 24px;
  }

  /* ================= GAME CARD ================= */

  .game-card {
    background: var(--glass-bg);
    backdrop-filter: var(--blur);
    border: 1px solid var(--glass-border);
    border-radius: 28px;
    padding: 20px;

    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 14px;

    transition: all 0.25s ease;
  }

  /* ================= IMAGE ================= */

  .game-card img {
    width: 100%;
    height: 140px;
    border-radius: 22px;
    object-fit: cover;
    box-shadow: 0 10px 32px rgba(0,0,0,0.45);
    transition: transform 0.25s ease;
  }

  /* ================= INTERACTIVE ================= */

  .game-card.clickable {
    cursor: pointer;
  }

  .game-card.clickable:hover {
    background: var(--glass-hover);
    transform: translateY(-3px);
    box-shadow: 0 14px 40px rgba(0,0,0,0.35);
  }

  .game-card.clickable:hover img {
    transform: scale(1.06);
  }

  .game-card.clickable:active {
    transform: translateY(-1px);
  }

  /* ================= DISABLED ================= */

  .game-card.disabled {
    opacity: 0.45;
    cursor: not-allowed;
    filter: grayscale(0.4);
  }

  .game-card.disabled:hover {
    transform: none;
    background: var(--glass-bg);
    box-shadow: none;
  }

  /* ================= TEXT ================= */

  .game-name {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
    margin-top: 4px;
  }

  .game-time {
    font-size: 12px;
    opacity: 0.6;
  }

  /* ================= RAWG BADGE ================= */

  .rawg-missing {
    margin-top: 6px;
    font-size: 11px;
    color: #f85149;
    background: rgba(248,81,73,0.12);
    border: 1px solid rgba(248,81,73,0.35);
    border-radius: 999px;
    padding: 4px 10px;
    width: fit-content;
    backdrop-filter: blur(6px);
  }

  /* ================= STATES ================= */

  .library-state {
    padding: 80px 24px;
    text-align: center;
    opacity: 0.8;
  }

  .library-state h2 {
    font-size: 26px;
    margin-bottom: 10px;
  }

  .library-state p {
    font-size: 15px;
    opacity: 0.7;
  }

  .library-state.error {
    max-width: 420px;
    margin: 80px auto;
    background: rgba(248,81,73,0.1);
    border: 1px solid rgba(248,81,73,0.35);
    border-radius: 24px;
    padding: 32px;
    backdrop-filter: blur(12px);
    color: #f85149;
  }
`}</style>

    </div>
  );
}
