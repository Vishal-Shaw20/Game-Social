import { RefreshCw } from "lucide-react";
import { gameArt } from "../../utils/gameArt";
import { hoursText } from "./libraryData";
import styles from "../Library.module.css";

// Covers in the art wall: your most played games (matched ones have art).
const WALL = 12;

/*
 * The top of the Library page, in the homepage's and game page's language:
 * your most played games' covers as a tilted wall of art on the right
 * (like the homepage's hero), fading into the dark behind the title; the
 * whole hero in your most played game's colour (like a game page takes its
 * game's); "My Library" with a quiet sync button; and your numbers as stat
 * blocks along the bottom, over the art.
 */
export default function LibraryHero({ items, stats, lastSyncedAt, syncing, onSync, note, tint }) {
  const covers = [...items]
    .filter((g) => g.cover)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, WALL);
  const top = stats.mostPlayed;
  const synced = new Date(lastSyncedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <header className={styles.hero} style={tint ? { "--accent": tint } : undefined}>
      {covers.length > 0 && (
        <div className={styles.heroArt} aria-hidden="true">
          {covers.map((g) => (
            <img key={g.appid} src={gameArt(g.cover, 640)} alt="" draggable="false" />
          ))}
        </div>
      )}
      <div className={styles.heroShade} aria-hidden="true" />

      <div className={styles.heroMain}>
        <div className={styles.heroTitleRow}>
          <h1 className={styles.heroTitle}>My Library</h1>
          <button
            type="button"
            className={`${styles.syncIcon} ${syncing ? styles.syncIconBusy : ""}`}
            onClick={onSync}
            disabled={syncing}
            aria-label={syncing ? "Syncing with Steam" : "Sync with Steam"}
            title={`${syncing ? "Syncing with Steam…" : "Sync with Steam"} · last synced ${synced}`}
          >
            <RefreshCw size={15} />
          </button>
        </div>
        {note && <p className={styles.syncNote}>{note}</p>}
      </div>

      <dl className={styles.heroStats}>
        <div className={`${styles.heroStat} ${styles.heroStatAccent}`}>
          <dt>Hours played</dt>
          <dd>{Math.round(stats.total).toLocaleString()}</dd>
        </div>
        <div className={styles.heroStat}>
          <dt>{stats.never ? `${stats.never} never launched` : "All played"}</dt>
          <dd>{stats.played}<span className={styles.heroUnit}>/{stats.count}</span></dd>
        </div>
        <div className={styles.heroStat}>
          <dt>Last 2 weeks</dt>
          <dd>{stats.recent > 0 ? hoursText(stats.recent) : "0 h"}</dd>
        </div>
        {top && (
          <div className={`${styles.heroStat} ${styles.heroStatTop}`}>
            {top.cover && <img className={styles.heroStatThumb} src={gameArt(top.cover, 420)} alt="" />}
            <dt>Most played · {hoursText(top.hours)}</dt>
            <dd title={top.name}>{top.name}</dd>
          </div>
        )}
      </dl>
    </header>
  );
}
