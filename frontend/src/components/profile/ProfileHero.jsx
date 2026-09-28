import { gameArt } from "../../utils/gameArt";
import { useQuickLook } from "../quicklook/quickLookContext";
import Avatar from "./Avatar";
import styles from "./Profile.module.css";

/*
 * The top of a profile, yours or someone else's (like the Library's): a
 * chosen banner game's art, or their most played games' art as a tilted
 * wall; their picture, name, @username, custom status, bio and favourite
 * game (a quick look); what you can do there (actions); and their reviews
 * and friends as stat blocks.
 */
export default function ProfileHero({ person, stats, wall = [], actions }) {
  const quickLook = useQuickLook();
  const since = person.createdAt
    ? new Date(person.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : null;
  const fav = person.favoriteGame;
  const banner = person.banner?.cover;

  return (
    <header className={styles.hero}>
      {banner ? (
        <div className={styles.heroBanner} aria-hidden="true">
          <img src={gameArt(banner, 1920)} alt="" draggable="false" />
        </div>
      ) : (
        wall.length > 0 && (
          <div className={styles.heroArt} aria-hidden="true">
            {wall.map((src, i) => <img key={i} src={gameArt(src, 640)} alt="" draggable="false" />)}
          </div>
        )
      )}
      <div className={styles.heroShade} aria-hidden="true" />

      <div className={styles.heroTop}>
        <div className={styles.identity}>
          <Avatar src={person.avatar} name={person.displayName} size={96} className={styles.heroAvatar} />
          <div className={styles.idText}>
            <h1 className={styles.heroName}>{person.displayName}</h1>
            <p className={styles.handle}>
              {person.username && `@${person.username}`}
              {since && <span> · Member since {since}</span>}
            </p>
            {person.status?.text && <p className={styles.status}>{person.status.text}</p>}
            {person.bio && <p className={styles.bio}>{person.bio}</p>}
            {fav && (
              <button type="button" className={styles.favGame} onClick={() => quickLook(fav)} title={`Quick look: ${fav.name}`}>
                {fav.cover && <img src={gameArt(fav.cover, 420)} alt="" />}
                <span><small>Favourite game</small>{fav.name}</span>
              </button>
            )}
          </div>
        </div>
        {actions && <div className={styles.heroActions}>{actions}</div>}
      </div>

      <dl className={styles.heroStats}>
        <div className={`${styles.stat} ${styles.statAccent}`}>
          <dt>Reviews</dt>
          <dd>{stats.reviews}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Friends</dt>
          <dd>{stats.friends}</dd>
        </div>
      </dl>
    </header>
  );
}
