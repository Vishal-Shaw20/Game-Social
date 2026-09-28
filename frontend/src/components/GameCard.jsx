import { gameArt } from "../utils/gameArt";
import PlatformIcon from "./PlatformIcon";
import { scoreColor } from "../utils/scoreColor";
import styles from "./GameCard.module.css";

/* Genres that fit on the card's art beside the platform icons; the rest
   collapse into a "+N" tag that lists them on hover. */
const MAX_GENRES = 2;

// dateTag replaces the year in the top-left tag (New Releases shows the full
// release date there).
export default function GameCard({ game, subtitle = null, dateTag = null, onOpen }) {
  const { title, cover, year, genres, platforms, metacritic, rating } = game;
  const shownGenres = genres.slice(0, MAX_GENRES);
  const moreGenres = genres.slice(MAX_GENRES);

  // Metacritic is the stronger signal but is missing for most of the
  // catalogue; fall back to RAWG's user rating rendered out of 10.
  const score = metacritic ?? (rating ? Math.round(rating * 20) : null);
  const scoreLabel = metacritic ? "Metacritic" : "User score";

  return (
    <button type="button" className={styles.card} onClick={onOpen}>
      <div className={styles.art}>
        {cover ? (
          <img src={gameArt(cover)} alt="" loading="lazy" draggable="false" />
        ) : (
          <div className={styles.noArt} aria-hidden="true" />
        )}

        <div className={styles.artScrim} aria-hidden="true" />

        {score != null && (
          <span
            className={styles.score}
            style={{ color: scoreColor(score) }}
            title={`${scoreLabel}: ${score}%`}
          >
            {score}
            <span className={styles.pct}>%</span>
          </span>
        )}

        {(dateTag || year) && <span className={styles.year}>{dateTag || year}</span>}

        {genres.length > 0 && (
          <ul className={styles.genres} aria-label={`Genres: ${genres.join(", ")}`}>
            {shownGenres.map((genre) => (
              <li key={genre} className={styles.genre} title={genre}>
                {genre}
              </li>
            ))}
            {moreGenres.length > 0 && (
              <li className={`${styles.genre} ${styles.genreMore}`}>
                +{moreGenres.length}
                <span className={styles.genrePopover} role="tooltip">
                  {moreGenres.map((genre) => (
                    <span key={genre} className={styles.genre}>
                      {genre}
                    </span>
                  ))}
                </span>
              </li>
            )}
          </ul>
        )}

        {platforms.length > 0 && (
          <ul
            className={styles.platforms}
            aria-label={`Available on ${platforms.map((p) => p.label).join(", ")}`}
          >
            {platforms.map((p) => (
              <li key={p.key} className={styles.platform} title={p.label}>
                <PlatformIcon platform={p.key} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.body}>
        <h3 className={styles.title}>{title}</h3>

        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </div>
    </button>
  );
}
