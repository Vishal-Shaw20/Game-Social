import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { gameArt } from "../../utils/gameArt";
import styles from "./Profile.module.css";

const API = import.meta.env.VITE_API_URL;

/*
 * Pick one game by name (the favourite game, the banner): the picked game
 * with a ✕ to clear it, or a search box with results as you type (a moment
 * after you stop). value / onChange: { rawgId, name, cover } or null.
 */
export default function GamePicker({ value, onChange, placeholder = "Search for a game", clearLabel = "Remove" }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState({ q: "", list: [] });

  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`${API}/api/library/match-search?q=${encodeURIComponent(q)}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((list) => !cancelled && setResults({ q, list: Array.isArray(list) ? list.slice(0, 8) : [] }))
        .catch(() => {});
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  const shown = q.length >= 2 && results.q === q ? results.list : [];

  if (value) {
    return (
      <div className={styles.pick}>
        {value.cover ? <img src={gameArt(value.cover, 420)} alt="" /> : <span className={styles.thumbEmpty} />}
        <span className={styles.pickName}>{value.name}</span>
        <button type="button" className={styles.iconBtn} onClick={() => onChange(null)} aria-label={clearLabel} title={clearLabel}>
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <>
      <input className={styles.input} value={query} placeholder={placeholder} onChange={(e) => setQuery(e.target.value)} />
      {shown.length > 0 && (
        <div className={styles.results}>
          {shown.map((g) => (
            <button
              key={g.id}
              type="button"
              className={styles.result}
              onClick={() => {
                onChange({ rawgId: String(g.id), name: g.name, cover: g.cover || null });
                setQuery("");
              }}
            >
              {g.cover ? <img src={gameArt(g.cover, 420)} alt="" /> : <span className={styles.thumbEmpty} />}
              <span>{g.name}</span>
              {g.released && <small>{String(g.released).slice(0, 4)}</small>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
