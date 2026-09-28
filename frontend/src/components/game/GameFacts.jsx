import { ExternalLink } from "lucide-react";
import { date, AGE_BOARDS } from "./format";
import styles from "./GamePanels.module.css";

// Age ratings: only the English-language rating systems, in this order
// (the US, Europe, Australia, New Zealand). Others, some with descriptors
// in other languages (Korea's GRAC, say), are left out.
const AGE_BOARD_ORDER = ["esrb", "pegi", "oflc", "nzoflc"];

/* The column beside "About": facts, where to buy, features, tags and age
   ratings, each a glass panel (GamePanels.module.css). Each is left out
   when there's nothing for it. */
export default function GameFacts({ game }) {

  const facts = [
    ["Developer", game.developers?.join(", ")],
    ["Publisher", game.publishers?.join(", ")],
    ["Released", game.comingSoon ? game.releaseText || "Coming soon" : date(game.released) || game.releaseText],
    ["Platforms", game.platforms?.join(", ")],
    ["Controller", game.controllerSupport ? `${game.controllerSupport === "full" ? "Full" : "Partial"} support` : null],
    ["Also known as", game.alternativeNames?.slice(0, 4).join(", ")],
  ].filter(([, v]) => v);

  // Steam's community tags (with votes) are more telling than RAWG's; fall
  // back to RAWG's when the game isn't on Steam.
  const tags = game.steamTags?.length ? game.steamTags.map((t) => t.name) : game.tags ?? [];
  const boards = AGE_BOARD_ORDER
    .filter((b) => game.age?.boards?.[b])
    .map((b) => [b, game.age.boards[b]]);

  return (
    <aside className={styles.stack}>
      {facts.length > 0 && (
        <div className={styles.panel}>
          <h3 className={styles.title}>Details</h3>
          <dl className={styles.factList}>
            {facts.map(([k, v]) => (
              <FactRow key={k} k={k} v={v} />
            ))}
          </dl>
        </div>
      )}

      {game.stores?.length > 0 && (
        <div className={styles.panel}>
          <h3 className={styles.title}>Where to get it</h3>
          <div className={styles.storeList}>
            {game.stores.map((s) => (
              <a key={s.url} className={styles.storeLink} href={s.url} target="_blank" rel="noreferrer">
                {s.name} <ExternalLink size={14} />
              </a>
            ))}
          </div>
        </div>
      )}

      {game.categories?.length > 0 && (
        <div className={styles.panel}>
          <h3 className={styles.title}>Features <span className={styles.count}>{game.categories.length}</span></h3>
          <div className={styles.chips}>
            {game.categories.map((c) => (
              <span key={c} className={styles.chip}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div className={styles.panel}>
          <h3 className={styles.title}>Tags <span className={styles.count}>{tags.length}</span></h3>
          <div className={styles.chips}>
            {tags.map((t) => (
              <span key={t} className={styles.chip}>{t}</span>
            ))}
          </div>
        </div>
      )}

      {(boards.length > 0 || game.age?.esrb || game.age?.contentNotes) && (
        <div className={styles.panel}>
          <h3 className={styles.title}>Age rating</h3>
          {boards.length === 0 && game.age?.esrb && (
            <div className={styles.ageRow}>
              <span className={styles.ageBox}>ESRB</span>
              <span className={styles.ageText}>{game.age.esrb}</span>
            </div>
          )}
          {boards.map(([board, r]) => (
            <div key={board} className={styles.ageRow}>
              <span className={styles.ageBox}>{AGE_BOARDS[board] ?? board} {String(r.rating ?? "").toUpperCase()}</span>
              <span className={styles.ageText}>{r.descriptors?.split(/\r?\n/).filter(Boolean).join(", ")}</span>
            </div>
          ))}
          {game.age?.contentNotes && (
            <p className={styles.ageNote}>
              {game.age.contentNotes}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

function FactRow({ k, v }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
