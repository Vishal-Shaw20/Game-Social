import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search } from "lucide-react";
import { gameArt } from "../../utils/gameArt";
import styles from "../Library.module.css";

const API = import.meta.env.VITE_API_URL;

/* A dialog over the page, rendered at the top of the document (a portal):
   a fixed layer nested in the page's scroller is what made Chrome leave
   ghosted copies of the page (see GameDetails). Esc or the backdrop closes. */
function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <section
        className={`${styles.panel} ${styles.dialog}`}
        style={{ "--accent": "#d4956e" }}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.panelTitle}>
          {title}
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </h2>
        <div className={styles.dialogBody}>{children}</div>
      </section>
    </div>,
    document.body
  );
}

/** Find the RAWG game an unmatched Steam game is, and link them. */
export function FindMatchDialog({ game, onClose, onMatched }) {
  const [q, setQ] = useState(game.name);
  const [results, setResults] = useState(null);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`${API}/api/library/match-search?q=${encodeURIComponent(query)}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j) => !cancelled && setResults(j))
        .catch(() => !cancelled && setError("Couldn't search right now."));
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const pick = async (rawgId) => {
    setSaving(rawgId);
    setError(null);
    try {
      const r = await fetch(`${API}/api/library/match`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appid: game.appid, rawgId }),
      });
      if (!r.ok) throw new Error();
      onMatched();
    } catch {
      setError("Couldn't save that match.");
      setSaving(null);
    }
  };

  return (
    <Dialog title={`Find a match for ${game.name}`} onClose={onClose}>
      <label className={styles.search}>
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search games" aria-label="Search games" autoFocus />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.matchList}>
        {results?.length === 0 && <p className={styles.syncNote}>No games found. Try another name.</p>}
        {results?.map((r) => (
          <button key={r.id} type="button" className={styles.matchItem} onClick={() => pick(r.id)} disabled={saving != null}>
            <div className={styles.miniArt}>{r.cover && <img src={gameArt(r.cover, 420)} alt="" loading="lazy" />}</div>
            <span className={styles.miniName}>{r.name}</span>
            <span className={styles.miniHours}>{saving === r.id ? "Saving…" : r.released?.slice(0, 4) ?? ""}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
