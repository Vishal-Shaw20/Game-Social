import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useArtTint } from "../../hooks/useArtTint";
import { gameArt } from "../../utils/gameArt";
import { VERDICT_META } from "../game/format";
import { SHELVES, NUDGE_HOURS, hoursText } from "./libraryData";
import Select from "../Select";
import styles from "../Library.module.css";

/* Whether an element has come near the screen yet (then stays true), so a
   long library only works out colours for the cards you actually see. */
function useSeen(ref) {
  // (no IntersectionObserver: treat everything as seen)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

const SHELF_LABEL = Object.fromEntries(SHELVES);
const SHELF_OPTIONS = [["", "No shelf"], ...SHELVES];

/*
 * One game, art first like the homepage's cards: the cover (glowing in the
 * game's colour when hovered) with your hours and last-two-weeks time as
 * tags on it and your verdict in the corner; the name, its shelf and the
 * friends who own it under it. Achievements, the shelf picker and "Review"
 * show over the art on hover (or keyboard focus). Games we couldn't match
 * to RAWG get a plain tile with their name and "Find match".
 */
export default function LibraryCard({ g, onShelf, onFindMatch, onOpen }) {
  const navigate = useNavigate();
  const ref = useRef(null);
  const seen = useSeen(ref);
  const tint = useArtTint(seen && g.cover ? [g.cover] : []);
  const openPage = () => g.rawgId && navigate(`/game/${g.rawgId}`);
  // A click (or Enter) is a quick look where the page has one, else the game page.
  const open = () => g.rawgId && (onOpen ? onOpen(g) : openPage());
  const v = g.verdict ? VERDICT_META[g.verdict] : null;
  const a = g.achievements;
  const stop = (e) => e.stopPropagation();

  return (
    <article
      ref={ref}
      className={`${styles.card} ${g.matched ? "" : styles.cardUnmatched}`}
      style={tint ? { "--tint": tint } : undefined}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open()}
      tabIndex={g.matched ? 0 : -1}
      aria-label={`${g.name}, ${hoursText(g.hours)}`}
    >
      <div className={styles.cardArt}>
        {g.cover ? (
          <>
            <img src={gameArt(g.cover, 640)} alt="" loading="lazy" draggable="false" />
            <div className={styles.cardScrim} aria-hidden="true" />
          </>
        ) : (
          <div className={styles.cardEmpty}>
            <span>{g.name}</span>
            <button type="button" className={styles.findBtn} onClick={(e) => { stop(e); onFindMatch(g); }}>
              Find match
            </button>
          </div>
        )}

        <div className={styles.cardTags}>
          <span className={styles.tag}>{hoursText(g.hours)}</span>
          {g.recent > 0 && <span className={`${styles.tag} ${styles.tagRecent}`}>2 wk · {hoursText(g.recent)}</span>}
        </div>
        {v && <span className={styles.verdictTag} style={{ "--v": v.color }}>{v.label}</span>}

        {g.matched && (
          <div className={styles.cardActions} onClick={stop}>
            {a?.total > 0 && (
              <span className={styles.achPill} title={`${a.unlocked} of ${a.total} achievements`}>
                <span className={styles.achBar}><span style={{ width: `${(a.unlocked / a.total) * 100}%` }} /></span>
                {a.unlocked}/{a.total}
              </span>
            )}
            <span className={styles.actionsGap} />
            {!v && g.hours >= NUDGE_HOURS && (
              <button type="button" className={styles.reviewBtn} onClick={openPage}>Review</button>
            )}
            <Select
              size="sm"
              align="right"
              ariaLabel={`Shelf for ${g.name}`}
              value={g.shelf ?? ""}
              options={SHELF_OPTIONS}
              onChange={(v) => onShelf(g.appid, v || null)}
            />
          </div>
        )}
      </div>

      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle} title={g.name}>{g.name}</h3>
        {g.shelf && <span className={styles.shelfBadge}>{SHELF_LABEL[g.shelf]}</span>}
        {g.owners.length > 0 && (
          <span className={styles.faces} title={`Friends who own it: ${g.owners.map((o) => o.name).join(", ")}`}>
            {g.owners.slice(0, 3).map((o) =>
              o.avatar ? (
                <img key={o.id} className={styles.face} src={o.avatar} alt={o.name} />
              ) : (
                <span key={o.id} className={styles.face}>{o.name.charAt(0).toUpperCase()}</span>
              )
            )}
            {g.owners.length > 3 && <span className={styles.faceMore}>+{g.owners.length - 3}</span>}
          </span>
        )}
      </div>
    </article>
  );
}
