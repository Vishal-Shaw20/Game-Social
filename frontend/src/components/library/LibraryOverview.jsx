import { hoursByGenre } from "./libraryData";
import styles from "../Library.module.css";

const SHOWN = 8;

/*
 * Where your hours go (a game's hours split evenly over its genres), as a
 * line of genre tabs, each with its share and a thin meter of it. Picking
 * one shows only its games in All games; picking it again clears it.
 */
export default function GenreStrip({ items, active, onPick }) {
  const genres = hoursByGenre(items, SHOWN);
  if (!genres.length) return null;
  const max = genres[0].share || 1;

  return (
    <div className={styles.genreChips} role="group" aria-label="Filter by genre">
      {genres.map((g) => {
        const on = g.genre === active;
        return (
          <button
            key={g.genre}
            type="button"
            className={`${styles.gChip} ${on ? styles.gChipOn : ""}`}
            style={{ "--w": `${(g.share / max) * 100}%` }}
            onClick={() => onPick(on ? "" : g.genre)}
            aria-pressed={on}
            title={on ? `Show all genres` : `${Math.round(g.share * 100)}% of your hours are in ${g.genre}`}
          >
            {g.genre}
            <b>{Math.round(g.share * 100)}%</b>
          </button>
        );
      })}
    </div>
  );
}
